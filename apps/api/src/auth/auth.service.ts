import { randomBytes } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@synvaro/database';
import { DatabaseService } from './database.service.js';
import { SESSION_TTL_MS } from './auth.config.js';
import { tokenHash } from './auth-security.js';

export const hashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const REGISTRATION_MESSAGE =
  'Registration received. You can now try signing in.';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  private activeHashes = 0;
  constructor(private readonly db: DatabaseService) {}
  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(32), hashOptions);
  }
  private async boundedHash<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeHashes >= 4)
      throw new ServiceUnavailableException('Please try again later');
    this.activeHashes++;
    try {
      return await operation();
    } finally {
      this.activeHashes--;
    }
  }
  async register(email: string, password: string) {
    const passwordHash = await this.boundedHash(() =>
      argon2.hash(password, hashOptions),
    );
    try {
      await this.db.client.user.create({ data: { email, passwordHash } });
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ))
        throw error;
    }
    // Same status/body for duplicates; never update the existing password.
    return { message: REGISTRATION_MESSAGE };
  }
  async login(email: string, password: string, previousToken?: string) {
    const user = await this.db.client.user.findUnique({ where: { email } });
    const valid = await this.boundedHash(() =>
      argon2.verify(user?.passwordHash ?? this.dummyHash, password),
    );
    if (!user || !valid)
      throw new UnauthorizedException('Invalid email or password');
    const token = randomBytes(32).toString('base64url');
    await this.db.client.$transaction(async (tx) => {
      if (previousToken)
        await tx.session.updateMany({
          where: { tokenHash: tokenHash(previousToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
    });
    return { token, user: { id: user.id, email: user.email } };
  }
  async authenticate(token?: string) {
    if (!token) throw new UnauthorizedException('Authentication required');
    const session = await this.db.client.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException('Authentication required');
    return session.user;
  }
  async logout(token?: string) {
    if (token)
      await this.db.client.session.updateMany({
        where: { tokenHash: tokenHash(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
}
