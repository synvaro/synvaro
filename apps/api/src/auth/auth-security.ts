import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { parse, serialize } from 'cookie';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { AuthConfig } from './auth.config.js';
import { SESSION_TTL_MS } from './auth.config.js';

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function sessionToken(req: Request, config: AuthConfig) {
  const token = parse(req.headers.cookie ?? '')[config.cookieName];
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function sessionCookie(
  res: Response,
  config: AuthConfig,
  token: string | null,
) {
  res.setHeader(
    'Set-Cookie',
    serialize(config.cookieName, token ?? '', {
      httpOnly: true,
      secure: config.secure,
      sameSite: 'strict',
      path: '/',
      maxAge: token ? SESSION_TTL_MS / 1000 : 0,
    }),
  );
}
export function requireSameOrigin(
  req: Request,
  config: AuthConfig,
  multipart = false,
) {
  if (
    req.headers.origin !== config.origin ||
    req.headers['sec-fetch-site'] === 'cross-site'
  ) {
    throw new ForbiddenException('Request origin rejected');
  }
  if (multipart ? !req.is('multipart/form-data') : !req.is('application/json'))
    throw new BadRequestException(
      multipart ? 'Multipart body required' : 'JSON body required',
    );
}
const credentials = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email(),
    password: z.string().min(12).max(128),
  })
  .strict();
export function parseCredentials(body: unknown) {
  const parsed = credentials.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException(
      'Provide a valid email and a password of 12–128 characters',
    );
  return parsed.data;
}

// Intentionally process-local for this spike. Fixed windows; bounded storage.
@Injectable()
export class AuthRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  private readonly windowMs = 15 * 60 * 1000;
  consume(key: string, limit: number, res: Response, now = Date.now()) {
    for (const [k, value] of this.buckets)
      if (value.until <= now) this.buckets.delete(k);
    const existing = this.buckets.get(key);
    if (
      (!existing && this.buckets.size >= 10_000) ||
      (existing && existing.count >= limit)
    ) {
      res.setHeader(
        'Retry-After',
        Math.ceil(((existing?.until ?? now + this.windowMs) - now) / 1000),
      );
      throw new HttpException('Too many attempts. Try again later.', 429);
    }
    this.buckets.set(key, {
      count: (existing?.count ?? 0) + 1,
      until: existing?.until ?? now + this.windowMs,
    });
  }
  ip(req: Request, res: Response) {
    // Never trust client-supplied forwarding headers. Shared proxy IP is conservative.
    this.consume('ip:' + (req.socket.remoteAddress ?? 'unknown'), 60, res);
  }
  account(email: string, res: Response) {
    this.consume('account:' + tokenHash(email), 5, res);
  }
}
