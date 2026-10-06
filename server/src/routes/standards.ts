import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';
import { INTAKE_SECTIONS, INTAKE_TARGETS, intakeSection } from '../intake.js';
import type { GuidanceKind, StandardSummary } from '../store/standards.js';

const MAX_CONTENT_LENGTH = 200_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KIND_LABEL: Record<GuidanceKind, string> = {
  standard: 'engineering standard',
  intake: 'intake rule',
  context: 'product context document',
};

const kind = z.enum(['standard', 'intake', 'context']);

const slug = z
  .string()
  .trim()
  .min(1)
  // Every document becomes an agent skill, and skill names are limited to 64 characters.
  .max(64)
  .regex(SLUG_PATTERN, 'Use lowercase letters, digits and single dashes, e.g. backend-standards');

const text = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  content: z
    .string()
    .max(MAX_CONTENT_LENGTH, 'Keep a document under 200,000 characters')
    .refine((value) => value.trim(), 'Content is empty'),
};

const scope = {
  enabled: z.boolean().default(true),
  appliesToAll: z.boolean().default(true),
  repositoryIds: z.array(z.uuid()).default([]),
};

const hasScope = (input: { appliesToAll: boolean; repositoryIds: string[] }) =>
  input.appliesToAll || input.repositoryIds.length > 0;
const scopeError = { message: 'Choose at least one repository, or apply it to all of them', path: ['repositoryIds'] };

/** Built-in intake sections have a fixed name and ID, so those fields are optional when one is chosen. */
const createSchema = z
  .object({
    kind: kind.default('standard'),
    target: z.enum(INTAKE_TARGETS).nullable().default(null),
    slug: slug.optional(),
    name: text.name.optional(),
    description: text.description,
    content: text.content,
    ...scope,
  })
  .refine(hasScope, scopeError)
  .refine((input) => input.target === null || input.kind === 'intake', {
    message: 'Only intake rules can fill an intake section',
    path: ['target'],
  })
  .transform((input, context) => {
    if (input.target) {
      const section = intakeSection(input.target);
      return { ...input, slug: section.slug, name: section.name, description: input.description || section.description };
    }
    if (!input.slug || !input.name) {
      context.addIssue({ code: 'custom', message: 'A name and an ID are required' });
      return z.NEVER;
    }
    return { ...input, slug: input.slug, name: input.name };
  });

const updateSchema = z.object({ slug, ...text, ...scope }).refine(hasScope, scopeError);

const importSchema = z.object({
  kind: kind.default('standard'),
  items: z.array(z.object({ slug, ...text })).min(1).max(100),
  /** Documents whose ID already exists are replaced (text only) when true, and skipped otherwise. */
  replaceExisting: z.boolean().default(false),
});

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23503';
}

/**
 * Admin API for everything agents receive as skills: engineering standards, intake rules and product
 * context. They differ only in `kind` (and intake rules may fill one of the built-in sections).
 */
export function standardRoutes({ stores }: AppDeps): Router {
  const router = Router();
  router.use(['/admin/standards', '/admin/intake'], requireAdmin);

  const id = (value: unknown) => z.uuid().parse(value);

  async function save<T>(work: () => Promise<T>, slugValue: string): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, `The ID "${slugValue}" is already used by another standard, intake rule or context document`);
      }
      if (isForeignKeyViolation(error)) throw new HttpError(400, 'One of the selected repositories no longer exists');
      throw error;
    }
  }

  router.get('/admin/standards', async (req, res) => {
    res.json({ standards: await stores.standards.list(kind.parse(req.query.kind ?? 'standard')) });
  });

  router.get('/admin/standards/:id', async (req, res) => {
    const standard = await stores.standards.findById(id(req.params.id));
    if (!standard) throw new HttpError(404, 'Not found');
    res.json({ standard });
  });

  router.post('/admin/standards', async (req, res) => {
    const input = createSchema.parse(req.body);
    if (input.target && (await stores.standards.list('intake')).some((rule) => rule.target === input.target)) {
      throw new HttpError(409, `The "${intakeSection(input.target).name}" section already exists. Edit it instead.`);
    }
    const standard = await save(() => stores.standards.create(input, req.user!.id), input.slug);
    res.status(201).json({ standard });
  });

  router.put('/admin/standards/:id', async (req, res) => {
    const existing = await stores.standards.findById(id(req.params.id));
    if (!existing) throw new HttpError(404, 'Not found');
    const input = updateSchema.parse(req.body);
    // A built-in section keeps its name and ID, which agents and the gateway rely on.
    const fixed = existing.target ? { slug: existing.slug, name: existing.name } : {};
    const standard = await save(() => stores.standards.update(existing.id, { ...input, ...fixed }, req.user!.id), input.slug);
    res.json({ standard });
  });

  router.patch('/admin/standards/:id', async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (!(await stores.standards.setEnabled(id(req.params.id), enabled, req.user!.id))) {
      throw new HttpError(404, 'Not found');
    }
    res.status(204).end();
  });

  router.delete('/admin/standards/:id', async (req, res) => {
    if (!(await stores.standards.delete(id(req.params.id)))) throw new HttpError(404, 'Not found');
    res.status(204).end();
  });

  /** Creates several documents of one kind at once, typically from uploaded Markdown files. */
  router.post('/admin/standards/import', async (req, res) => {
    const { kind: importKind, items, replaceExisting } = importSchema.parse(req.body);
    const slugs = items.map((item) => item.slug);
    const duplicate = slugs.find((value, index) => slugs.indexOf(value) !== index);
    if (duplicate) throw new HttpError(400, `Two files would both become "${duplicate}". Rename one before importing.`);

    const existing = await stores.standards.findBySlug(slugs);
    const reserved = new Set<string>(INTAKE_SECTIONS.map((section) => section.slug));
    for (const item of items) {
      const other = existing.get(item.slug);
      if (other && (other.kind !== importKind || other.target)) {
        throw new HttpError(409, `"${item.slug}" is already used by an ${KIND_LABEL[other.kind]}. Rename the file's ID.`);
      }
      if (!other && reserved.has(item.slug)) {
        throw new HttpError(409, `"${item.slug}" is reserved for a built-in intake section. Rename the file's ID.`);
      }
    }

    const created: string[] = [];
    const replaced: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const other = existing.get(item.slug);
      if (other && !replaceExisting) {
        skipped.push(item.slug);
      } else if (other) {
        await stores.standards.replaceContent(other.id, item, req.user!.id);
        replaced.push(item.slug);
      } else {
        await save(
          () =>
            stores.standards.create(
              { ...item, kind: importKind, target: null, enabled: true, appliesToAll: true, repositoryIds: [] },
              req.user!.id,
            ),
          item.slug,
        );
        created.push(item.slug);
      }
    }
    res.json({ created, replaced, skipped });
  });

  /** The built-in intake sections, each with the rule that fills it (if any). */
  router.get('/admin/intake/sections', async (_req, res) => {
    const rules = await stores.standards.list('intake');
    const byTarget = new Map<string, StandardSummary>(rules.filter((r) => r.target).map((r) => [r.target!, r]));
    res.json({
      sections: INTAKE_SECTIONS.map((section) => ({ ...section, rule: byTarget.get(section.target) ?? null })),
    });
  });

  return router;
}
