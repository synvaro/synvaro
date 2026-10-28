import { Injectable } from '@nestjs/common';
import { META_VERSION } from './providers.js';
import type { PublishErrorCode } from './facebook-publisher.js';

const graph = `https://graph.facebook.com/${META_VERSION}`;
const identifier = (id: string) => {
  if (!/^\d{1,32}$/.test(id))
    throw new InstagramPublishError('MALFORMED', false);
  return id;
};
export class InstagramPublishError extends Error {
  constructor(
    public readonly code: PublishErrorCode,
    public readonly uncertain: boolean,
  ) {
    super('Instagram publication failed');
  }
}
function classify(status: number, write: boolean) {
  return new InstagramPublishError(
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
async function responseJson(
  response: Response,
  write: boolean,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw classify(response.status, write);
  const reader = response.body?.getReader();
  if (!reader) throw new InstagramPublishError('MALFORMED', write);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 64_000) {
      await reader.cancel();
      throw new InstagramPublishError('MALFORMED', write);
    }
    chunks.push(part.value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new InstagramPublishError('MALFORMED', write);
  }
}
async function request(url: string, token: string, body?: URLSearchParams) {
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    return responseJson(response, !!body);
  } catch (error) {
    if (error instanceof InstagramPublishError) throw error;
    throw new InstagramPublishError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'TIMEOUT'
        : 'NETWORK',
      !!body,
    );
  }
}
@Injectable()
export class InstagramPublisher {
  async readiness(
    igId: string,
    userToken: string,
    pageToken: string,
    expectedPageId?: string,
  ) {
    if (!userToken || !pageToken)
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    try {
      identifier(igId);
      const grants = await request(`${graph}/me/permissions`, userToken);
      if (
        !Array.isArray(grants.data) ||
        ![
          'pages_show_list',
          'pages_read_engagement',
          'instagram_basic',
          'instagram_content_publish',
        ].every((permission) =>
          (grants.data as unknown[]).some(
            (entry) =>
              entry &&
              typeof entry === 'object' &&
              (entry as Record<string, unknown>).permission === permission &&
              (entry as Record<string, unknown>).status === 'granted',
          ),
        )
      )
        return {
          eligible: false,
          reason: 'PUBLISH_PERMISSION_MISSING',
        } as const;
      const url = new URL(`${graph}/me/accounts`);
      url.searchParams.set('fields', 'id,tasks,instagram_business_account{id}');
      url.searchParams.set('limit', '100');
      const pages = await request(url.toString(), userToken);
      if (!Array.isArray(pages.data))
        return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' } as const;
      const linked = pages.data.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const page = item as Record<string, unknown>;
        const ig = page.instagram_business_account;
        return (
          (!expectedPageId || page.id === expectedPageId) &&
          ig &&
          typeof ig === 'object' &&
          (ig as Record<string, unknown>).id === igId &&
          Array.isArray(page.tasks) &&
          page.tasks.some(
            (task: unknown) =>
              task === 'CREATE_CONTENT' ||
              task === 'PROFILE_PLUS_CREATE_CONTENT',
          )
        );
      });
      if (!linked)
        return {
          eligible: false,
          reason: 'PAGE_LINK_OR_TASK_MISSING',
        } as const;
      const account = await request(`${graph}/${igId}?fields=id`, pageToken);
      return account.id === igId
        ? ({ eligible: true, reason: null } as const)
        : ({ eligible: false, reason: 'REAUTHORIZE' } as const);
    } catch {
      return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' } as const;
    }
  }
  async createContainer(
    igId: string,
    pageToken: string,
    imageUrl: string,
    caption: string,
  ) {
    const result = await request(
      `${graph}/${identifier(igId)}/media`,
      pageToken,
      new URLSearchParams({ image_url: imageUrl, caption }),
    );
    if (typeof result.id !== 'string' || !/^\d{1,32}$/.test(result.id))
      throw new InstagramPublishError('MALFORMED', true);
    return result.id;
  }
  async containerStatus(containerId: string, pageToken: string) {
    const result = await request(
      `${graph}/${identifier(containerId)}?fields=id,status_code`,
      pageToken,
    );
    if (
      result.id !== containerId ||
      !['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED'].includes(
        String(result.status_code),
      )
    )
      throw new InstagramPublishError('MALFORMED', false);
    return result.status_code as
      'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
  }
  async publish(igId: string, containerId: string, pageToken: string) {
    const result = await request(
      `${graph}/${identifier(igId)}/media_publish`,
      pageToken,
      new URLSearchParams({ creation_id: identifier(containerId) }),
    );
    if (typeof result.id !== 'string' || !/^\d{1,32}$/.test(result.id))
      throw new InstagramPublishError('MALFORMED', true);
    return result.id;
  }
}
