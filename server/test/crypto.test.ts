import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, SecretBox, verifyPassword } from '../src/crypto.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('round-trips a value', () => {
    expect(box.openJson(box.sealJson({ token: 'abc' }))).toEqual({ token: 'abc' });
  });

  it('produces a different ciphertext each time', () => {
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('rejects tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = box.seal('secret').split(':');
    const flipped = Buffer.from(ciphertext!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => box.open([version, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('rejects a different key', () => {
    expect(() => new SecretBox(randomBytes(32)).open(box.seal('secret'))).toThrow();
  });
});

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong horse battery', stored)).toBe(false);
  });
});

describe('generateToken', () => {
  it('prefixes tokens so their kind is recognizable', () => {
    expect(generateToken('hsd')).toMatch(/^hsd_[A-Za-z0-9_-]{43}$/);
  });
});
