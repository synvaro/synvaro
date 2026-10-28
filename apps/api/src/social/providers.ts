import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SocialPlatform, SocialProvider } from '@synvaro/database';

export type SocialCredential = {
  accessToken: string;
  refreshToken?: string;
  userToken?: string;
  pageId?: string;
};
export type DiscoveredAccount = {
  platform: SocialPlatform;
  externalId: string;
  displayName: string;
  accountType: string;
  scopes: string[];
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  credential: SocialCredential;
};
type Token = SocialCredential & { expiresIn?: number; scope?: string };
export const META_VERSION = 'v26.0';
const requestedScopes = (
  provider: SocialProvider,
  platform: SocialPlatform,
  publishing = false,
) => {
  if (provider === 'META')
    return platform === 'INSTAGRAM'
      ? [
          'pages_show_list',
          'pages_read_engagement',
          'instagram_basic',
          ...(publishing ? ['instagram_content_publish'] : []),
        ]
      : publishing
        ? ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
        : ['pages_show_list'];
  return provider === 'LINKEDIN'
    ? ['openid', 'profile']
    : ['https://www.googleapis.com/auth/youtube.readonly'];
};
const settings = {
  META: ['META_APP_ID', 'META_APP_SECRET'],
  LINKEDIN: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  GOOGLE: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
} as const;

export class SocialProviderError extends Error {
  constructor(
    public readonly category:
      'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'UNAVAILABLE' | 'MALFORMED',
    public readonly status?: number,
  ) {
    super('Social provider request failed');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SocialProviderError('MALFORMED');
  return value as Record<string, unknown>;
}
function string(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096)
    throw new SocialProviderError('MALFORMED');
  return value;
}
function identifier(value: unknown) {
  const id = string(value);
  if (id.length > 160) throw new SocialProviderError('MALFORMED');
  return id;
}
function optionalString(value: unknown) {
  return typeof value === 'string' && value.length <= 4096 ? value : undefined;
}
function expiresIn(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(Date.now() + value * 1000).toISOString()
    : null;
}

@Injectable()
export class SocialProviders {
  configured(provider: SocialProvider) {
    return settings[provider].every((key) => !!process.env[key]);
  }
  callback(provider: SocialProvider) {
    const origin = new URL(process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000');
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      (origin.protocol !== 'https:' &&
        !(
          origin.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(origin.hostname)
        ))
    )
      throw new Error('Invalid WEB_ORIGIN for OAuth');
    return `${origin.origin}/api/social/oauth/${provider.toLowerCase()}/callback`;
  }
  authorize(
    provider: SocialProvider,
    platform: SocialPlatform,
    state: string,
    verifier?: string,
    publishing = false,
  ) {
    if (!this.configured(provider))
      throw new Error('Provider is not configured');
    const url = new URL(
      provider === 'META'
        ? `https://www.facebook.com/${META_VERSION}/dialog/oauth`
        : provider === 'LINKEDIN'
          ? 'https://www.linkedin.com/oauth/v2/authorization'
          : 'https://accounts.google.com/o/oauth2/v2/auth',
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', process.env[settings[provider][0]]!);
    url.searchParams.set('redirect_uri', this.callback(provider));
    url.searchParams.set('state', state);
    url.searchParams.set(
      'scope',
      requestedScopes(provider, platform, publishing).join(' '),
    );
    if (publishing && provider === 'META')
      url.searchParams.set('auth_type', 'rerequest');
    if (provider === 'GOOGLE') {
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      if (!verifier) throw new Error('PKCE verifier missing');
      url.searchParams.set(
        'code_challenge',
        createHash('sha256').update(verifier).digest('base64url'),
      );
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async request(url: string, options: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new SocialProviderError('UNAVAILABLE');
    }
    if (!response.ok)
      throw new SocialProviderError(
        response.status === 401
          ? 'AUTH'
          : response.status === 403
            ? 'PERMISSION'
            : response.status === 429
              ? 'RATE_LIMIT'
              : 'UNAVAILABLE',
        response.status,
      );
    const length = Number(response.headers.get('content-length'));
    if (length > 64 * 1024) throw new SocialProviderError('MALFORMED');
    const reader = response.body?.getReader();
    if (!reader) throw new SocialProviderError('MALFORMED');
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new SocialProviderError('MALFORMED');
      }
      chunks.push(part.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new SocialProviderError('MALFORMED');
    }
  }

  private async token(
    provider: SocialProvider,
    code: string,
    verifier?: string,
  ): Promise<Token> {
    const endpoint =
      provider === 'META'
        ? `https://graph.facebook.com/${META_VERSION}/oauth/access_token`
        : provider === 'LINKEDIN'
          ? 'https://www.linkedin.com/oauth/v2/accessToken'
          : 'https://oauth2.googleapis.com/token';
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env[settings[provider][0]]!,
      client_secret: process.env[settings[provider][1]]!,
      redirect_uri: this.callback(provider),
    });
    if (verifier) form.set('code_verifier', verifier);
    const result = object(
      await this.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      }),
    );
    return {
      accessToken: string(result.access_token),
      refreshToken: optionalString(result.refresh_token),
      expiresIn:
        typeof result.expires_in === 'number' ? result.expires_in : undefined,
      scope: optionalString(result.scope),
    };
  }

  async complete(
    provider: SocialProvider,
    platform: SocialPlatform,
    code: string,
    verifier?: string,
  ): Promise<DiscoveredAccount[]> {
    const token = await this.token(provider, code, verifier);
    const granted = token.scope?.split(/[ ,]+/).filter(Boolean) ?? [];
    const expiry = expiresIn(token.expiresIn);
    if (provider === 'META') {
      const url = new URL(
        `https://graph.facebook.com/${META_VERSION}/me/accounts`,
      );
      url.searchParams.set(
        'fields',
        'id,name,access_token,instagram_business_account{id,username}',
      );
      url.searchParams.set('limit', '100');
      const response = object(
        await this.request(url.toString(), {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        }),
      );
      if (!Array.isArray(response.data))
        throw new SocialProviderError('MALFORMED');
      const candidates: DiscoveredAccount[] = [];
      for (const item of response.data.slice(0, 100)) {
        const page = object(item);
        const pageId = identifier(page.id);
        const pageName = string(page.name).slice(0, 200);
        const pageToken = string(page.access_token);
        if (platform === 'FACEBOOK')
          candidates.push({
            platform,
            externalId: pageId,
            displayName: pageName,
            accountType: 'PAGE',
            scopes: granted,
            accessExpiresAt: expiry,
            refreshExpiresAt: null,
            credential: {
              accessToken: pageToken,
              userToken: token.accessToken,
            },
          });
        if (platform === 'INSTAGRAM' && page.instagram_business_account) {
          const ig = object(page.instagram_business_account);
          candidates.push({
            platform,
            externalId: identifier(ig.id),
            displayName: (optionalString(ig.username) ?? pageName).slice(
              0,
              200,
            ),
            accountType: 'PROFESSIONAL',
            scopes: granted,
            accessExpiresAt: expiry,
            refreshExpiresAt: null,
            credential: {
              accessToken: pageToken,
              userToken: token.accessToken,
              pageId,
            },
          });
        }
      }
      return candidates;
    }
    if (provider === 'LINKEDIN') {
      const member = object(
        await this.request('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        }),
      );
      return [
        {
          platform: 'LINKEDIN',
          externalId: identifier(member.sub),
          displayName: (optionalString(member.name) ?? 'LinkedIn member').slice(
            0,
            200,
          ),
          accountType: 'MEMBER',
          scopes: granted,
          accessExpiresAt: expiry,
          refreshExpiresAt: null,
          credential: { accessToken: token.accessToken },
        },
      ];
    }
    const channels = object(
      await this.request(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50',
        {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        },
      ),
    );
    if (!Array.isArray(channels.items))
      throw new SocialProviderError('MALFORMED');
    return channels.items.slice(0, 50).map((item) => {
      const channel = object(item);
      const snippet = object(channel.snippet);
      return {
        platform: 'YOUTUBE' as const,
        externalId: identifier(channel.id),
        displayName: string(snippet.title).slice(0, 200),
        accountType: 'CHANNEL',
        scopes: granted,
        accessExpiresAt: expiry,
        refreshExpiresAt: null,
        credential: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
        },
      };
    });
  }

  async refreshGoogle(refreshToken: string) {
    if (!this.configured('GOOGLE'))
      throw new SocialProviderError('UNAVAILABLE');
    let response: unknown;
    try {
      response = await this.request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        }),
      });
    } catch (error) {
      if (error instanceof SocialProviderError && error.status === 400)
        throw new SocialProviderError('AUTH', 400);
      throw error;
    }
    const result = object(response);
    const expiry = expiresIn(result.expires_in);
    if (!expiry) throw new SocialProviderError('MALFORMED');
    return {
      accessToken: string(result.access_token),
      accessExpiresAt: expiry,
    };
  }

  async revoke(provider: SocialProvider, credential: SocialCredential) {
    if (provider === 'GOOGLE') {
      const form = new URLSearchParams({
        token: credential.refreshToken ?? credential.accessToken,
      });
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok)
        throw new SocialProviderError('UNAVAILABLE', response.status);
    } else if (provider === 'META' && credential.userToken) {
      await this.request(
        `https://graph.facebook.com/${META_VERSION}/me/permissions`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${credential.userToken}` },
        },
      );
    }
    // LinkedIn consumer grants have no verified programmatic revocation API.
  }
}
