import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';

const MAX_CONTENT_LENGTH = 200_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(SLUG_PATTERN, 'Use lowercase letters, digits and single dashes, e.g. backend-standards');

const text = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  content: z.string().max(MAX_CONTENT_LENGTH, 'Keep a standard under 200,000 characters').refine((value) => value.trim(), 'Content is empty'),
};

const standardSchema = z
  .object({
    slug,
    ...text,
    enabled: z.boolean().default(true),
    appliesToAll: z.boolean().default(true),
    repositoryIds: z.array(z.uuid()).default([]),
  })
  .refine((input) => input.appliesToAll || input.repositoryIds.length > 0, {
    message: 'Choose at least one repository, or apply the standard to all of them',
    path: ['repositoryIds'],
  });

const importSchema = z.object({
  items: z.array(z.object({ slug, ...text })).min(1).max(100),
  /** Standards whose slug already exists are replaced (text only) when true, and skipped otherwise. */
  replaceExisting: z.boolean().default(false),
});

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23503';
}

export function standardRoutes({ stores }: AppDeps): Router {
  const router = Router();
  router.use('/admin/standards', requireAdmin);

  const id = (value: unknown) => z.uuid().parse(value);

  async function save(work: () => Promise<unknown>, slugValue: string) {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `A standard with the identifier "${slugValue}" already exists`);
      if (isForeignKeyViolation(error)) throw new HttpError(400, 'One of the selected repositories no longer exists');
      throw error;
    }
  }

  router.get('/admin/standards', async (_req, res) => {
    res.json({ standards: await stores.standards.list() });
  });

  router.get('/admin/standards/:id', async (req, res) => {
    const standard = await stores.standards.findById(id(req.params.id));
    if (!standard) throw new HttpError(404, 'Standard not found');
    res.json({ standard });
  });

  router.post('/admin/standards', async (req, res) => {
    const input = standardSchema.parse(req.body);
    const standard = await save(() => stores.standards.create(input, req.user!.id), input.slug);
    res.status(201).json({ standard });
  });

  router.put('/admin/standards/:id', async (req, res) => {
    const input = standardSchema.parse(req.body);
    const standard = await save(() => stores.standards.update(id(req.params.id), input, req.user!.id), input.slug);
    if (!standard) throw new HttpError(404, 'Standard not found');
    res.json({ standard });
  });

  router.patch('/admin/standards/:id', async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (!(await stores.standards.setEnabled(id(req.params.id), enabled, req.user!.id))) {
      throw new HttpError(404, 'Standard not found');
    }
    res.status(204).end();
  });

  router.delete('/admin/standards/:id', async (req, res) => {
    if (!(await stores.standards.delete(id(req.params.id)))) throw new HttpError(404, 'Standard not found');
    res.status(204).end();
  });

  /** Creates several standards at once, typically from uploaded Markdown files. */
  router.post('/admin/standards/import', async (req, res) => {
    const { items, replaceExisting } = importSchema.parse(req.body);
    const slugs = items.map((item) => item.slug);
    const duplicate = slugs.find((value, index) => slugs.indexOf(value) !== index);
    if (duplicate) throw new HttpError(400, `Two files would both become "${duplicate}". Rename one before importing.`);

    const existing = await stores.standards.findIdsBySlug(slugs);
    const created: string[] = [];
    const replaced: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const existingId = existing.get(item.slug);
      if (existingId && !replaceExisting) {
        skipped.push(item.slug);
      } else if (existingId) {
        await stores.standards.replaceContent(existingId, item, req.user!.id);
        replaced.push(item.slug);
      } else {
        await save(
          () =>
            stores.standards.create({ ...item, enabled: true, appliesToAll: true, repositoryIds: [] }, req.user!.id),
          item.slug,
        );
        created.push(item.slug);
      }
    }
    res.json({ created, replaced, skipped });
  });

  return router;
}
