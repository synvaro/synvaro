import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keys() {
  const raw = process.env.SOCIAL_TOKEN_KEYS_JSON;
  const active = process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID;
  if (!raw || !active || !/^[A-Za-z0-9_-]{1,32}$/.test(active))
    throw new Error('Social token encryption is not configured');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid social token keyring');
  const result = new Map<string, Buffer>();
  for (const [id, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof encoded !== 'string')
      throw new Error('Invalid social token keyring');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded)
      throw new Error('Social token keys must be 32-byte base64');
    result.set(id, key);
  }
  if (!result.has(active)) throw new Error('Active social key is missing');
  return { active, result };
}

export function encryptionReady() {
  try {
    keys();
    return true;
  } catch {
    return false;
  }
}

export function encryptSocial(value: unknown) {
  const { active, result } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', result.get(active)!, iv);
  const bytes = Buffer.from(JSON.stringify(value));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return [
    'v1',
    active,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join(':');
}

export function decryptSocial<T>(value: string): T {
  const [version, id, iv, encrypted, tag, extra] = value.split(':');
  if (version !== 'v1' || !id || !iv || !encrypted || !tag || extra)
    throw new Error('Invalid encrypted social credential');
  const key = keys().result.get(id);
  if (!key) throw new Error('Social credential key is unavailable');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}
