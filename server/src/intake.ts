/** The built-in intake sections. Each is one rule document with a fixed skill name. */
export const INTAKE_SECTIONS = [
  {
    target: 'tasks',
    slug: 'intake-tasks',
    name: 'Opening tasks',
    description:
      'Use when opening a task, issue or card, or when the developer asks to create one: what it must contain and how it is labeled.',
    help: 'How a task, GitHub issue or Trello card is opened: title, description template, labels, assignees.',
  },
  {
    target: 'comments',
    slug: 'intake-comments',
    name: 'Comments',
    description: 'Use when commenting on a task, issue, card or pull request.',
    help: 'Tone, structure and what to include when commenting on tasks, issues, cards and pull requests.',
  },
  {
    target: 'pull_requests',
    slug: 'intake-pull-requests',
    name: 'Pull requests',
    description: 'Use when opening a pull request or writing its title and description.',
    help: 'Pull request titles, description template, linking the task, reviewers.',
  },
  {
    target: 'commits',
    slug: 'intake-commits',
    name: 'Commit messages',
    description: 'Use when writing a commit message.',
    help: 'Commit message format, what the subject and body must say, references to tasks.',
  },
] as const;

export type IntakeTarget = (typeof INTAKE_SECTIONS)[number]['target'];

export const INTAKE_TARGETS = INTAKE_SECTIONS.map((section) => section.target) as [IntakeTarget, ...IntakeTarget[]];

export function intakeSection(target: IntakeTarget) {
  return INTAKE_SECTIONS.find((section) => section.target === target)!;
}
