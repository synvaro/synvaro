import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import * as OTPAuth from 'otpauth';

function key() {
  const encoded = process.env.AUTH_TOTP_KEY;
  if (!encoded) throw new Error('AUTH_TOTP_KEY is required');
  const value = Buffer.from(encoded, 'base64');
  if (value.length !== 32 || value.toString('base64') !== encoded)
    throw new Error('AUTH_TOTP_KEY must be 32-byte base64');
  return value;
}
export function encryptMfa(secret: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join(':');
}
export function decryptMfa(value: string, userId: string) {
  const [version, iv, ciphertext, tag, extra] = value.split(':');
  if (version !== 'v1' || !iv || !ciphertext || !tag || extra)
    throw new Error('Invalid MFA credential');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
export const recoveryHash = (code: string) =>
  createHash('sha256').update(code).digest('hex');
export function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
}
export function newTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}
export function totp(secret: string, label: string) {
  return new OTPAuth.TOTP({
    issuer: 'SYNVARO',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function validTotpCounter(secret: string, label: string, code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const timestamp = Date.now();
  const delta = totp(secret, label).validate({
    token: code,
    window: 1,
    timestamp,
  });
  return delta === null ? null : BigInt(Math.floor(timestamp / 30000) + delta);
}
