import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Renders Markdown for preview. The HTML is sanitized, so a pasted or uploaded file cannot run scripts. */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }));
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

function titleFromSlug(slug: string): string {
  const words = slug.split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Reads simple `key: value` frontmatter, as used by SKILL.md and similar files. */
function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = text.match(FRONTMATTER);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (field) fields[field[1]!.toLowerCase()] = field[2]!.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fields, body: text.slice(match[0].length) };
}

export interface ParsedStandard {
  fileName: string;
  slug: string;
  name: string;
  description: string;
  content: string;
}

/**
 * Turns an uploaded Markdown file into a standard. Frontmatter `name` and `description` win (so skill
 * files keep their identity), then the first heading, then the file name.
 */
export function parseStandardFile(fileName: string, text: string): ParsedStandard {
  const { fields, body } = parseFrontmatter(text.replace(/^﻿/, ''));
  const baseName = fileName.replace(/\.(md|markdown)$/i, '');
  const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  const slug = slugify(fields.name ?? (baseName.toUpperCase() === 'SKILL' ? (heading ?? baseName) : baseName));
  return {
    fileName,
    slug,
    name: fields.title ?? heading ?? titleFromSlug(slug),
    description: fields.description ?? '',
    content: body.trim() ? `${body.trim()}\n` : '',
  };
}
