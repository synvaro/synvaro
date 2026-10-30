import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { SocialPlatform, SocialProvider } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { decryptSocial, encryptSocial, encryptionReady } from './crypto.js';
import {
  SocialProviderError,
  SocialProviders,
  type DiscoveredAccount,
  type SocialCredential,
} from './providers.js';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const providerFor = (platform: SocialPlatform): SocialProvider =>
  platform === 'FACEBOOK' || platform === 'INSTAGRAM'
    ? 'META'
    : platform === 'LINKEDIN'
      ? 'LINKEDIN'
      : 'GOOGLE';
const missing = () => new NotFoundException('Social connection not found');
const safeAccount = {
  id: true,
  brandId: true,
  platform: true,
  externalId: true,
  displayName: true,
  accountType: true,
  status: true,
  scopes: true,
  accessExpiresAt: true,
  refreshExpiresAt: true,
  lastValidatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
const safeCandidate = (account: DiscoveredAccount) => ({
  platform: account.platform,
  externalId: account.externalId,
  displayName: account.displayName,
  accountType: account.accountType,
  scopes: account.scopes,
  accessExpiresAt: account.accessExpiresAt,
});

@Injectable()
export class SocialService {
  now = () => new Date();
  constructor(
    private readonly db: DatabaseService,
    private readonly providers: SocialProviders,
  ) {}

  catalog() {
    return {
      providers: (
        ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'YOUTUBE'] as const
      ).map((platform) => {
        const provider = providerFor(platform);
        const configured =
          this.providers.configured(provider) && encryptionReady();
        return {
          platform,
          provider,
          status: configured ? 'AVAILABLE' : 'NOT_CONFIGURED',
          accountType:
            platform === 'FACEBOOK'
              ? 'PAGE'
              : platform === 'INSTAGRAM'
                ? 'PROFESSIONAL'
                : platform === 'LINKEDIN'
                  ? 'MEMBER'
                  : 'CHANNEL',
          publishingEligible: false,
        };
      }),
    };
  }

  private async ownedBrand(userId: string, brandId: string) {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organization: { ownerUserId: userId } },
      select: { id: true },
    });
    if (!brand) throw missing();
    return brand;
  }
  private async attemptFor(userId: string, sessionToken: string, id: string) {
    const attempt = await this.db.client.socialOauthAttempt.findFirst({
      where: {
        id,
        userId,
        sessionHash: digest(sessionToken),
        brand: { organization: { ownerUserId: userId } },
      },
    });
    if (!attempt) throw missing();
    return attempt;
  }

  async start(
    userId: string,
    sessionToken: string,
    brandId: string,
    platform: SocialPlatform,
    publishing = false,
  ) {
    if (
      publishing &&
      !['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'YOUTUBE'].includes(platform)
    )
      throw new BadRequestException(
        'Publishing authorization is unavailable for this platform',
      );
    await this.ownedBrand(userId, brandId);
    const provider = providerFor(platform);
    if (!this.providers.configured(provider) || !encryptionReady())
      throw new ServiceUnavailableException(
        'Social provider is not configured',
      );
    const state = randomBytes(32).toString('base64url');
    const verifier =
      provider === 'GOOGLE' ? randomBytes(32).toString('base64url') : undefined;
    const url = this.providers.authorize(
      provider,
      platform,
      state,
      verifier,
      publishing,
    );
    await this.db.client.socialOauthAttempt.deleteMany({
      where: { expiresAt: { lt: this.now() } },
    });
    await this.db.client.socialOauthAttempt.create({
      data: {
        userId,
        brandId,
        provider,
        platform,
        publishing,
        stateHash: digest(state),
        sessionHash: digest(sessionToken),
        verifierEncrypted: verifier ? encryptSocial({ verifier }) : null,
        expiresAt: new Date(this.now().getTime() + 10 * 60_000),
      },
    });
    return { authorizationUrl: url };
  }

  async callback(
    provider: SocialProvider,
    state: string,
    code?: string,
    denied?: string,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      throw new BadRequestException('Invalid OAuth state');
    const attempt = await this.db.client.socialOauthAttempt.findUnique({
      where: { stateHash: digest(state) },
    });
    if (
      !attempt ||
      attempt.provider !== provider ||
      attempt.status !== 'STARTED' ||
      attempt.expiresAt <= this.now()
    )
      throw new BadRequestException('OAuth request expired or already used');
    const consumed = await this.db.client.socialOauthAttempt.updateMany({
      where: {
        id: attempt.id,
        status: 'STARTED',
        expiresAt: { gt: this.now() },
      },
      data: { status: 'USED', consumedAt: this.now() },
    });
    if (consumed.count !== 1)
      throw new BadRequestException('OAuth request expired or already used');
    if (denied || !code || code.length > 2048) {
      await this.db.client.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          verifierEncrypted: null,
          errorCode: denied ? 'CONSENT_DENIED' : 'CODE_MISSING',
        },
      });
      return { attemptId: attempt.id, brandId: attempt.brandId };
    }
    try {
      const verifier = attempt.verifierEncrypted
        ? decryptSocial<{ verifier: string }>(attempt.verifierEncrypted)
            .verifier
        : undefined;
      const accounts = await this.providers.complete(
        provider,
        attempt.platform,
        code,
        verifier,
      );
      if (accounts.length > 100) throw new SocialProviderError('MALFORMED');
      await this.db.client.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'READY',
          verifierEncrypted: null,
          credentialsEncrypted: encryptSocial(accounts),
          discovered: accounts.map(safeCandidate),
        },
      });
    } catch (error) {
      const category =
        error instanceof SocialProviderError ? error.category : 'UNAVAILABLE';
      await this.db.client.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          verifierEncrypted: null,
          errorCode: `PROVIDER_${category}`,
        },
      });
    }
    return { attemptId: attempt.id, brandId: attempt.brandId };
  }

  async discovery(userId: string, sessionToken: string, attemptId: string) {
    const attempt = await this.attemptFor(userId, sessionToken, attemptId);
    return {
      id: attempt.id,
      brandId: attempt.brandId,
      platform: attempt.platform,
      publishing: attempt.publishing,
      status: attempt.expiresAt <= this.now() ? 'EXPIRED' : attempt.status,
      errorCode: attempt.errorCode,
      accounts:
        attempt.status === 'READY' && attempt.expiresAt > this.now()
          ? attempt.discovered
          : [],
    };
  }

  async associate(
    userId: string,
    sessionToken: string,
    attemptId: string,
    externalId: string,
  ) {
    const attempt = await this.attemptFor(userId, sessionToken, attemptId);
    if (
      attempt.status !== 'READY' ||
      attempt.expiresAt <= this.now() ||
      !attempt.credentialsEncrypted
    )
      throw new ConflictException('Authorization is not ready');
    const candidates = decryptSocial<DiscoveredAccount[]>(
      attempt.credentialsEncrypted,
    );
    const candidate = candidates.find(
      (item) =>
        item.externalId === externalId && item.platform === attempt.platform,
    );
    if (!candidate) throw missing();
    try {
      return await this.db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.socialOauthAttempt.findUnique({
          where: { id: attemptId },
        });
        if (current?.status !== 'READY' || current.expiresAt <= this.now())
          throw new ConflictException('Authorization expired');
        const existing = await tx.socialAccount.findUnique({
          where: {
            platform_externalId: { platform: candidate.platform, externalId },
          },
          include: { brand: { include: { organization: true } } },
        });
        if (existing) {
          if (
            existing.brand.organization.ownerUserId !== userId ||
            existing.brandId !== attempt.brandId
          )
            throw new ConflictException(
              'Account is already connected elsewhere',
            );
          // Google can omit refresh_token on a later consent. Preserve only
          // the same channel's already encrypted credential; never infer a
          // grant scope from the earlier token.
          const credential =
            candidate.platform === 'YOUTUBE' &&
            !candidate.credential.refreshToken
              ? {
                  ...candidate.credential,
                  refreshToken: decryptSocial<SocialCredential>(
                    existing.credentialsEncrypted,
                  ).refreshToken,
                }
              : candidate.credential;
          const account = await tx.socialAccount.update({
            where: { id: existing.id },
            data: {
              grantId: attempt.id,
              displayName: candidate.displayName,
              accountType: candidate.accountType,
              scopes: candidate.scopes,
              credentialsEncrypted: encryptSocial(credential),
              accessExpiresAt: candidate.accessExpiresAt
                ? new Date(candidate.accessExpiresAt)
                : null,
              refreshExpiresAt: candidate.refreshExpiresAt
                ? new Date(candidate.refreshExpiresAt)
                : candidate.platform === 'YOUTUBE' &&
                    !candidate.credential.refreshToken
                  ? existing.refreshExpiresAt
                  : null,
              status: 'CONNECTED',
              lastValidatedAt: this.now(),
            },
            select: safeAccount,
          });
          return { account };
        }
        const account = await tx.socialAccount.create({
          data: {
            grantId: attempt.id,
            brandId: attempt.brandId,
            platform: candidate.platform,
            externalId: candidate.externalId,
            displayName: candidate.displayName,
            accountType: candidate.accountType,
            scopes: candidate.scopes,
            credentialsEncrypted: encryptSocial(candidate.credential),
            accessExpiresAt: candidate.accessExpiresAt
              ? new Date(candidate.accessExpiresAt)
              : null,
            refreshExpiresAt: candidate.refreshExpiresAt
              ? new Date(candidate.refreshExpiresAt)
              : null,
            lastValidatedAt: this.now(),
          },
          select: safeAccount,
        });
        return { account };
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException('Account is already connected');
      throw error;
    }
  }

  async list(userId: string, brandId: string) {
    await this.ownedBrand(userId, brandId);
    const rows = await this.db.client.socialAccount.findMany({
      where: { brandId, brand: { organization: { ownerUserId: userId } } },
      select: safeAccount,
      orderBy: { createdAt: 'desc' },
    });
    return {
      accounts: rows.map((row) => ({
        ...row,
        status:
          row.status === 'CONNECTED' &&
          row.accessExpiresAt &&
          row.accessExpiresAt <= this.now()
            ? 'EXPIRED'
            : row.status,
        publishingEligible: false,
      })),
    };
  }

  async checkMetaPermissions(userId: string, accountId: string) {
    const row = await this.db.client.socialAccount.findFirst({
      where: {
        id: accountId,
        platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
        status: 'CONNECTED',
        brand: { organization: { ownerUserId: userId } },
      },
    });
    if (!row) throw missing();
    const credential = decryptSocial<SocialCredential>(
      row.credentialsEncrypted,
    );
    if (!credential.userToken)
      throw new ConflictException('Reauthorization required');
    let scopes: string[];
    try {
      scopes = await this.providers.metaGrantedScopes(credential.userToken);
    } catch (error) {
      if (
        error instanceof SocialProviderError &&
        ['AUTH', 'PERMISSION'].includes(error.category)
      )
        throw new ConflictException('Reauthorization required');
      throw new ServiceUnavailableException(
        'Provider permissions could not be checked',
      );
    }
    const updated = await this.db.client.socialAccount.updateMany({
      where: { id: row.id, status: 'CONNECTED', grantId: row.grantId },
      data: { scopes },
    });
    if (updated.count !== 1)
      throw new ConflictException('Connection changed; check again');
    const account = await this.db.client.socialAccount.findUniqueOrThrow({
      where: { id: row.id },
      select: safeAccount,
    });
    return { account };
  }

  async disconnect(userId: string, accountId: string) {
    const item = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const row = await tx.socialAccount.findFirst({
        where: {
          id: accountId,
          brand: { organization: { ownerUserId: userId } },
        },
      });
      if (!row) throw missing();
      if (
        await tx.publication.count({
          where: {
            socialAccountId: row.id,
            status: { in: ['PROCESSING', 'PUBLISHING'] },
          },
        })
      )
        throw new ConflictException('A publication is still in progress');
      const others = await tx.socialAccount.count({
        where: { grantId: row.grantId, id: { not: row.id } },
      });
      const hasHistory = await tx.publication.count({
        where: { socialAccountId: row.id },
      });
      if (hasHistory) {
        await tx.socialAccount.update({
          where: { id: row.id },
          data: {
            status: 'DISCONNECTED',
            scopes: [],
            credentialsEncrypted: encryptSocial({ accessToken: '' }),
            accessExpiresAt: null,
            refreshExpiresAt: null,
          },
        });
      } else {
        await tx.socialAccount.delete({ where: { id: row.id } });
      }
      const otherMeta =
        row.platform === 'FACEBOOK' || row.platform === 'INSTAGRAM'
          ? await tx.socialAccount.count({
              where: {
                platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
                id: { not: row.id },
                status: 'CONNECTED',
                brand: { organization: { ownerUserId: userId } },
              },
            })
          : 0;
      return { row, revoke: others === 0 && otherMeta === 0 };
    });
    let revocationConfirmed = false;
    if (item.revoke && item.row.platform !== 'LINKEDIN') {
      try {
        await this.providers.revoke(
          providerFor(item.row.platform),
          decryptSocial<SocialCredential>(item.row.credentialsEncrypted),
        );
        revocationConfirmed = true;
      } catch {
        // Local credentials are already removed; the user must revoke at the provider.
      }
    }
    return {
      disconnected: true,
      providerRevocationConfirmed: revocationConfirmed,
    };
  }

  async refresh(userId: string, accountId: string) {
    const row = await this.db.client.socialAccount.findFirst({
      where: {
        id: accountId,
        brand: { organization: { ownerUserId: userId } },
      },
    });
    if (!row) throw missing();
    if (row.platform !== 'YOUTUBE')
      throw new ConflictException('Reauthorization required');
    const credential = decryptSocial<SocialCredential>(
      row.credentialsEncrypted,
    );
    if (!credential.refreshToken) {
      await this.db.client.socialAccount.update({
        where: { id: row.id },
        data: { status: 'REAUTH_REQUIRED' },
      });
      throw new ConflictException('Reauthorization required');
    }
    try {
      const renewed = await this.providers.refreshGoogle(
        credential.refreshToken,
      );
      return {
        account: await this.db.client.socialAccount.update({
          where: { id: row.id },
          data: {
            credentialsEncrypted: encryptSocial({
              ...credential,
              accessToken: renewed.accessToken,
            }),
            accessExpiresAt: renewed.accessExpiresAt
              ? new Date(renewed.accessExpiresAt)
              : null,
            lastValidatedAt: this.now(),
            status: 'CONNECTED',
          },
          select: safeAccount,
        }),
      };
    } catch (error) {
      const reauthorize =
        error instanceof SocialProviderError &&
        ['AUTH', 'PERMISSION'].includes(error.category);
      await this.db.client.socialAccount.update({
        where: { id: row.id },
        data: { status: reauthorize ? 'REAUTH_REQUIRED' : 'ERROR' },
      });
      if (reauthorize) throw new ConflictException('Reauthorization required');
      throw new ServiceUnavailableException(
        'Social connection could not be refreshed',
      );
    }
  }
}
