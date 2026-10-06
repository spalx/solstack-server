import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 random bytes, base64-encoded'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24 * 7),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  WEB_DIST_DIR: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /** Public origin of the server, without a trailing slash. Used for OAuth callbacks and links. */
  baseUrl: string;
  databaseUrl: string;
  encryptionKey: Buffer;
  sessionTtlMs: number;
  secureCookies: boolean;
  /** Number of reverse proxies in front of the app (0 = none). */
  trustProxy: number;
  webDistDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const values = parsed.data;
  const baseUrl = new URL(values.BASE_URL).origin;
  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    baseUrl,
    databaseUrl: values.DATABASE_URL,
    encryptionKey: Buffer.from(values.ENCRYPTION_KEY, 'base64'),
    sessionTtlMs: values.SESSION_TTL_HOURS * 60 * 60 * 1000,
    secureCookies: baseUrl.startsWith('https://'),
    trustProxy: values.TRUST_PROXY,
    webDistDir: values.WEB_DIST_DIR,
  };
}
