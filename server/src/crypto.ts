import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = {
  session: 'sss',
  developer: 'ssd',
  repository: 'ssr',
  invite: 'ssi',
  state: 'sst',
} as const;

export function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/** Tokens are high-entropy random values, so a fast hash is enough to store them safely. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The part of a token that is safe to display so people can tell their tokens apart. */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, 12);
}

/** Authenticated encryption (AES-256-GCM) for secrets at rest. */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  open(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognized secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  sealJson(value: unknown): string {
    return this.seal(JSON.stringify(value));
  }

  openJson<T>(sealed: string): T {
    return JSON.parse(this.open(sealed)) as T;
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keyLength, { N, r, p }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !N || !r || !p || !salt || !expected) return false;
  const key = await deriveKey(password, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p));
  const expectedKey = Buffer.from(expected, 'base64');
  return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
}
