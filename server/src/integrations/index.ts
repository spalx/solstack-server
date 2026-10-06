import { githubIntegration } from './github.js';
import { trelloIntegration } from './trello.js';
import type { Integration } from './types.js';

/** Every integration the server knows about. Adding one means writing a module and listing it here. */
export const INTEGRATIONS: Integration[] = [githubIntegration, trelloIntegration];
