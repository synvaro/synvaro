import { Injectable } from '@nestjs/common';

// Verified against LinkedIn's versioned Posts and Images API documentation on 2026-10-28.
export const LINKEDIN_VERSION = '202610';
// Posts commentary uses LinkedIn's little-text grammar. Escape reserved
// characters so the rendered post is the plain text the owner reviewed.
export const escapeLinkedInText = (value: string) =>
  Array.from(value, (character) =>
    '|{}@[]()<>#\\*_~'.includes(character) ? `\\${character}` : character,
  ).join('');
const api = 'https://api.linkedin.com';
const person = (id: string) => /^[-_A-Za-z0-9]{1,120}$/.test(id);
const imageUrn = (id: string) => /^urn:li:image:[-_A-Za-z0-9]{1,120}$/.test(id);
const postUrn = (id: string) =>
  /^urn:li:(?:share|ugcPost):[0-9]{1,32}$/.test(id);

export class LinkedInPublishError extends Error {
  constructor(
    public readonly code:
      | 'AUTH'
      | 'PERMISSION'
      | 'RATE_LIMIT'
      | 'REJECTED'
      | 'PROVIDER_ERROR'
      | 'TIMEOUT'
      | 'NETWORK'
      | 'MALFORMED',
    public readonly uncertain: boolean,
  ) {
    super('LinkedIn request failed');
  }
}
function classify(status: number, write: boolean) {
  return new LinkedInPublishError(
    status === 401
      ? 'AUTH'
      : status === 403
        ? 'PERMISSION'
        : status === 429
          ? 'RATE_LIMIT'
          : status >= 500
            ? 'PROVIDER_ERROR'
            : 'REJECTED',
    write && status >= 500,
  );
}
async function boundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (Number(response.headers.get('content-length')) > 64_000)
    throw new LinkedInPublishError('MALFORMED', false);
  const reader = response.body?.getReader();
  if (!reader) throw new LinkedInPublishError('MALFORMED', false);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 64_000) {
      await reader.cancel();
      throw new LinkedInPublishError('MALFORMED', false);
    }
    chunks.push(part.value);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new LinkedInPublishError('MALFORMED', false);
  }
}

@Injectable()
export class LinkedInPublisher {
  private headers(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'Linkedin-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }
  private async call(url: string, init: RequestInit, write: boolean) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new LinkedInPublishError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'NETWORK',
        write,
      );
    }
    if (!response.ok) throw classify(response.status, write);
    return response;
  }
  async readiness(externalId: string, token: string) {
    if (!person(externalId) || !token)
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    try {
      const response = await this.call(
        `${api}/v2/userinfo`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        false,
      );
      const user = await boundedJson(response);
      if (user.sub !== externalId)
        return { eligible: false, reason: 'MEMBER_MISMATCH' } as const;
      // Product entitlement cannot be proven by OIDC read. A denied Posts API write
      // is recorded as PERMISSION; never infer entitlement from a configured key.
      return {
        eligible: true,
        reason: null,
        productAccessVerified: false,
      } as const;
    } catch (error) {
      return {
        eligible: false,
        reason:
          error instanceof LinkedInPublishError && error.code === 'PERMISSION'
            ? 'PRODUCT_ACCESS_REQUIRED'
            : 'REAUTHORIZE',
      } as const;
    }
  }
  async initializeImage(author: string, token: string) {
    if (!/^urn:li:person:[-_A-Za-z0-9]{1,120}$/.test(author))
      throw new LinkedInPublishError('MALFORMED', false);
    const response = await this.call(
      `${api}/rest/images?action=initializeUpload`,
      {
        method: 'POST',
        headers: { ...this.headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      },
      true,
    );
    const value = (await boundedJson(response)).value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new LinkedInPublishError('MALFORMED', true);
    const record = value as Record<string, unknown>;
    if (
      typeof record.image !== 'string' ||
      !imageUrn(record.image) ||
      typeof record.uploadUrl !== 'string'
    )
      throw new LinkedInPublishError('MALFORMED', true);
    let upload: URL;
    try {
      upload = new URL(record.uploadUrl);
    } catch {
      throw new LinkedInPublishError('MALFORMED', true);
    }
    if (
      upload.protocol !== 'https:' ||
      upload.hostname !== 'www.linkedin.com' ||
      upload.port ||
      upload.username ||
      upload.password ||
      !upload.pathname.startsWith('/dms-uploads/')
    )
      throw new LinkedInPublishError('MALFORMED', true);
    if (
      typeof record.uploadUrlExpiresAt === 'number' &&
      record.uploadUrlExpiresAt <= Date.now()
    )
      throw new LinkedInPublishError('MALFORMED', true);
    return { urn: record.image, url: upload.toString() };
  }
  async uploadImage(
    url: string,
    token: string,
    bytes: Buffer,
    mime: 'image/jpeg' | 'image/png',
  ) {
    // Revalidate even though the URL came from initializeImage; no redirects or
    // arbitrary hostnames may receive a member token or private image bytes.
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      target.hostname !== 'www.linkedin.com' ||
      target.port ||
      target.username ||
      target.password ||
      !target.pathname.startsWith('/dms-uploads/')
    )
      throw new LinkedInPublishError('MALFORMED', false);
    await this.call(
      target.toString(),
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
        body: new Uint8Array(bytes),
      },
      true,
    );
  }
  async imageReady(urn: string, token: string, author: string) {
    if (!imageUrn(urn)) throw new LinkedInPublishError('MALFORMED', false);
    let response: Response;
    try {
      response = await this.call(
        `${api}/rest/images/${encodeURIComponent(urn)}`,
        {
          headers: this.headers(token),
        },
        false,
      );
    } catch (error) {
      // LinkedIn documents versioned Images GET as unavailable to write-only
      // w_member_social tokens, while the same resource's legacy GET remains
      // readable. This is a read-only fallback, never an older posting API.
      if (
        !(error instanceof LinkedInPublishError) ||
        error.code !== 'PERMISSION'
      )
        throw error;
      response = await this.call(
        `${api}/rest/images/${encodeURIComponent(urn)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
        },
        false,
      );
    }
    const result = await boundedJson(response);
    if (
      result.id !== urn ||
      result.owner !== author ||
      result.status !== 'AVAILABLE'
    )
      throw new LinkedInPublishError('MALFORMED', false);
  }
  async publish(
    author: string,
    token: string,
    commentary: string,
    image?: string,
  ) {
    if (
      !/^urn:li:person:[-_A-Za-z0-9]{1,120}$/.test(author) ||
      (image && !imageUrn(image))
    )
      throw new LinkedInPublishError('MALFORMED', false);
    const response = await this.call(
      `${api}/rest/posts`,
      {
        method: 'POST',
        headers: { ...this.headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author,
          commentary: escapeLinkedInText(commentary),
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
          ...(image ? { content: { media: { id: image } } } : {}),
        }),
      },
      true,
    );
    const id = response.headers.get('x-restli-id');
    if (response.status !== 201 || !id || !postUrn(id))
      throw new LinkedInPublishError('MALFORMED', true);
    return id;
  }
}
