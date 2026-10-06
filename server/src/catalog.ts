/** Coding agents a repository can be set up for. The client app will generate files for each one. */
export const AGENTS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'OpenAI Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'copilot-vscode', name: 'GitHub Copilot (VS Code)' },
  { id: 'devin', name: 'Devin Desktop (formerly Windsurf)' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
] as const;

export const AGENT_IDS = AGENTS.map((agent) => agent.id) as [string, ...string[]];
