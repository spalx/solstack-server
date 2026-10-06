import type { GuidanceKind } from './types';

export interface GuidanceKindInfo {
  kind: GuidanceKind;
  /** Base path of its admin pages. */
  path: string;
  title: string;
  /** Lowercase, for sentences: "Delete this engineering standard?" */
  singular: string;
  plural: string;
  intro: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  contentPlaceholder: string;
}

export const GUIDANCE: Record<GuidanceKind, GuidanceKindInfo> = {
  standard: {
    kind: 'standard',
    path: '/admin/standards',
    title: 'Engineering standards',
    singular: 'engineering standard',
    plural: 'engineering standards',
    intro:
      'Conventions your agents follow when writing code: structure, naming, testing. Write them here or upload Markdown files.',
    namePlaceholder: 'Backend standards',
    descriptionPlaceholder: 'Use when writing or reviewing backend code: services, controllers, migrations and tests.',
    contentPlaceholder: '# Backend standards\n\nWrite the standard in Markdown…',
  },
  intake: {
    kind: 'intake',
    path: '/admin/intake',
    title: 'Intake',
    singular: 'intake rule',
    plural: 'intake rules',
    intro:
      'How agents write everything that is not code: opening tasks, comments, pull requests, commit messages. Agents also see these rules at the moment they create an issue, card, comment or pull request.',
    namePlaceholder: 'Release notes',
    descriptionPlaceholder: 'Use when writing release notes for a deployment.',
    contentPlaceholder: '# Release notes\n\nWrite the rule in Markdown…',
  },
  context: {
    kind: 'context',
    path: '/admin/context',
    title: 'Product context',
    singular: 'product context document',
    plural: 'product context documents',
    intro:
      'What the business and product are about: what it does, who uses it, its terms and business rules. Agents read it before planning a change, so specs and code use your language.',
    namePlaceholder: 'Billing domain',
    descriptionPlaceholder: 'Read when working on billing: plans, invoices, refunds and how customers are charged.',
    contentPlaceholder: '# Billing domain\n\nDescribe the product area in Markdown…',
  },
};
