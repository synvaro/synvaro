import { Injectable } from '@nestjs/common';
import { META_VERSION } from './providers.js';

export type PublishErrorCode =
  | 'AUTH'
  | 'PERMISSION'
  | 'RATE_LIMIT'
  | 'REJECTED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'MALFORMED';

export class FacebookPublishError extends Error {
  constructor(
    public readonly code: PublishErrorCode,
    public readonly uncertain: boolean,
  ) {
    super('Facebook publication failed');
  }
}

const graph = `https://graph.facebook.com/${META_VERSION}`;
const pageId = (value: string) => {
  if (!/^\d{1,32}$/.test(value))
    throw new FacebookPublishError('MALFORMED', false);
  return value;
};
async function json(response: Response): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get('content-length'));
  if (length > 64_000) throw new FacebookPublishError('MALFORMED', true);
  const reader = response.body?.getReader();
  if (!reader) throw new FacebookPublishError('MALFORMED', true);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 64_000) {
      await reader.cancel();
      throw new FacebookPublishError('MALFORMED', true);
    }
    chunks.push(chunk.value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new FacebookPublishError('MALFORMED', true);
  }
}
function classify(status: number): FacebookPublishError {
  return new FacebookPublishError(
    status === 401
      ? 'AUTH'
      : status === 403
        ? 'PERMISSION'
        : status === 429
          ? 'RATE_LIMIT'
          : status >= 500
            ? 'PROVIDER_ERROR'
            : 'REJECTED',
    status >= 500,
  );
}

@Injectable()
export class FacebookPublisher {
  // These reads are authorization checks, never publication requests.
  async readiness(externalId: string, userToken: string, pageToken: string) {
    if (!userToken || !pageToken)
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    try {
      const id = pageId(externalId);
      const permissions = await fetch(`${graph}/me/permissions`, {
        headers: { Authorization: `Bearer ${userToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!permissions.ok)
        return { eligible: false, reason: 'REAUTHORIZE' } as const;
      const granted = (await json(permissions)).data;
      if (
        !Array.isArray(granted) ||
        ![
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
        ].every((permission) =>
          granted.some(
            (entry) =>
              entry &&
              typeof entry === 'object' &&
              entry.permission === permission &&
              entry.status === 'granted',
          ),
        )
      )
        return {
          eligible: false,
          reason: 'PUBLISH_PERMISSION_MISSING',
        } as const;
      const url = new URL(`${graph}/me/accounts`);
      url.searchParams.set('fields', 'id,tasks');
      url.searchParams.set('limit', '100');
      const pages = await fetch(url, {
        headers: { Authorization: `Bearer ${userToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!pages.ok) return { eligible: false, reason: 'REAUTHORIZE' } as const;
      const accounts = (await json(pages)).data;
      if (!Array.isArray(accounts))
        return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' } as const;
      const match = accounts.find(
        (entry) => entry && typeof entry === 'object' && entry.id === id,
      );
      if (!match)
        return { eligible: false, reason: 'PAGE_ACCESS_MISSING' } as const;
      if (
        !Array.isArray(match.tasks) ||
        !match.tasks.some(
          (task: unknown) =>
            task === 'CREATE_CONTENT' || task === 'PROFILE_PLUS_CREATE_CONTENT',
        )
      )
        return { eligible: false, reason: 'PAGE_TASK_MISSING' } as const;
      const pageUrl = new URL(`${graph}/${id}`);
      pageUrl.searchParams.set('fields', 'id');
      const page = await fetch(pageUrl, {
        headers: { Authorization: `Bearer ${pageToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!page.ok) return { eligible: false, reason: 'REAUTHORIZE' } as const;
      if ((await json(page)).id !== id)
        return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' } as const;
      return { eligible: true, reason: null } as const;
    } catch {
      return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' } as const;
    }
  }

  async publish(
    externalId: string,
    pageToken: string,
    text: string,
  ): Promise<string> {
    const id = pageId(externalId);
    let response: Response;
    try {
      response = await fetch(`${graph}/${id}/feed`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pageToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ message: text }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new FacebookPublishError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'NETWORK',
        true,
      );
    }
    if (!response.ok) throw classify(response.status);
    const result = await json(response);
    if (typeof result.id !== 'string' || !/^\d{1,32}_\d{1,32}$/.test(result.id))
      throw new FacebookPublishError('MALFORMED', true);
    return result.id;
  }

  async publishPhoto(
    externalId: string,
    pageToken: string,
    caption: string,
    bytes: Buffer,
    mimeType: 'image/jpeg' | 'image/png',
  ): Promise<string> {
    const id = pageId(externalId);
    const form = new FormData();
    form.set(
      'source',
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      'photo',
    );
    form.set('caption', caption);
    form.set('published', 'true');
    let response: Response;
    try {
      response = await fetch(`${graph}/${id}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pageToken}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new FacebookPublishError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'NETWORK',
        true,
      );
    }
    if (!response.ok) throw classify(response.status);
    const result = await json(response);
    // A photo ID alone does not prove that the Page feed post was published.
    if (
      typeof result.post_id !== 'string' ||
      !/^\d{1,32}_\d{1,32}$/.test(result.post_id)
    )
      throw new FacebookPublishError('MALFORMED', true);
    return result.post_id;
  }
}
