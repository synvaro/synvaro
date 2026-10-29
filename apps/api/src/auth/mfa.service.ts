import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from './database.service.js';
import { SESSION_TTL_MS } from './auth.config.js';
import { tokenHash } from './auth-security.js';
import {
  decryptMfa,
  encryptMfa,
  newRecoveryCodes,
  newTotpSecret,
  recoveryHash,
  totp,
  validTotpCounter,
} from './mfa-crypto.js';

@Injectable()
export class MfaService {
  constructor(private readonly db: DatabaseService) {}
  private async pending(token?: string) {
    if (!token) throw new UnauthorizedException('MFA session required');
    const session = await this.db.client.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.stage !== 'PENDING_MFA' ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException('MFA session required');
    return session;
  }
  async status(token?: string) {
    const session = await this.pending(token);
    return {
      setupRequired: !(await this.db.client.userMfa.findUnique({
        where: { userId: session.userId },
        select: { userId: true },
      })),
    };
  }
  async setup(token?: string) {
    const session = await this.pending(token);
    if (
      await this.db.client.userMfa.findUnique({
        where: { userId: session.userId },
      })
    )
      throw new ForbiddenException('MFA is already configured');
    const secret = session.pendingMfaSecret
      ? decryptMfa(session.pendingMfaSecret, session.userId)
      : newTotpSecret();
    if (!session.pendingMfaSecret)
      await this.db.client.session.update({
        where: { id: session.id },
        data: { pendingMfaSecret: encryptMfa(secret, session.userId) },
      });
    return {
      secret,
      provisioningUri: totp(secret, session.user.email).toString(),
    };
  }
  private async consume(token?: string) {
    const session = await this.pending(token);
    const admitted = await this.db.client.session.updateMany({
      where: { id: session.id, mfaAttempts: { lt: 5 }, revokedAt: null },
      data: { mfaAttempts: { increment: 1 } },
    });
    if (!admitted.count)
      throw new ForbiddenException('MFA attempts exhausted. Sign in again.');
    return session;
  }
  private async fullSession(
    tx: Parameters<Parameters<DatabaseService['client']['$transaction']>[0]>[0],
    session: { id: string; userId: string },
  ) {
    const revoked = await tx.session.updateMany({
      where: {
        id: session.id,
        stage: 'PENDING_MFA',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date(), pendingMfaSecret: null },
    });
    if (revoked.count !== 1)
      throw new UnauthorizedException('MFA session required');
    const token = randomBytes(32).toString('base64url');
    await tx.session.create({
      data: {
        userId: session.userId,
        tokenHash: tokenHash(token),
        stage: 'FULL',
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }
  async activate(token: string | undefined, code: string) {
    const session = await this.consume(token);
    if (!session.pendingMfaSecret)
      throw new ForbiddenException('Start MFA setup first');
    const secret = decryptMfa(session.pendingMfaSecret, session.userId);
    const counter = validTotpCounter(secret, session.user.email, code);
    if (counter === null)
      throw new UnauthorizedException('Invalid verification code');
    const recoveryCodes = newRecoveryCodes();
    const fullToken = await this.db.client.$transaction(async (tx) => {
      await tx.userMfa.create({
        data: {
          userId: session.userId,
          secretEncrypted: encryptMfa(secret, session.userId),
          lastCounter: counter,
        },
      });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((value) => ({
          userId: session.userId,
          codeHash: recoveryHash(value),
        })),
      });
      return this.fullSession(tx, session);
    });
    return { token: fullToken, recoveryCodes };
  }
  async verify(token: string | undefined, code: string) {
    const session = await this.consume(token);
    const credential = await this.db.client.userMfa.findUnique({
      where: { userId: session.userId },
    });
    if (!credential) throw new ForbiddenException('MFA setup required');
    const counter = validTotpCounter(
      decryptMfa(credential.secretEncrypted, session.userId),
      session.user.email,
      code,
    );
    const recovery = /^[0-9a-f]{32}$/.test(code) ? recoveryHash(code) : null;
    const fullToken = await this.db.client.$transaction(async (tx) => {
      let accepted = false;
      if (counter !== null) {
        const updated = await tx.userMfa.updateMany({
          where: { userId: session.userId, lastCounter: { lt: counter } },
          data: { lastCounter: counter },
        });
        accepted = updated.count === 1;
      } else if (recovery) {
        const deleted = await tx.mfaRecoveryCode.deleteMany({
          where: { userId: session.userId, codeHash: recovery },
        });
        accepted = deleted.count === 1;
      }
      if (!accepted)
        throw new UnauthorizedException('Invalid verification code');
      return this.fullSession(tx, session);
    });
    return { token: fullToken };
  }
}
