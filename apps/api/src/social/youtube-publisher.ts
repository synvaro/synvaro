import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';

const api = 'https://www.googleapis.com';
const maxResponse = 64 * 1024;
const channelId = (value: string) => /^UC[A-Za-z0-9_-]{8,60}$/.test(value);
export const videoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value);

export class YouTubePublishError extends Error {
  constructor(
    public readonly category:
      | 'AUTH'
      | 'PERMISSION'
      | 'RATE_LIMIT'
      | 'REJECTED'
      | 'PROVIDER_ERROR'
      | 'TIMEOUT'
      | 'NETWORK'
      | 'MALFORMED'
      | 'EXPIRED',
    public readonly uncertain: boolean,
  ) {
    super('YouTube request failed');
  }
}
function classified(status: number, write: boolean) {
  return new YouTubePublishError(
    status === 401
      ? 'AUTH'
      : status === 403
        ? 'PERMISSION'
        : status === 429
          ? 'RATE_LIMIT'
          : status === 404
            ? 'EXPIRED'
            : status >= 500
              ? 'PROVIDER_ERROR'
              : 'REJECTED',
    write && status >= 500,
  );
}
async function json(response: Response): Promise<Record<string, unknown>> {
  if (Number(response.headers.get('content-length')) > maxResponse)
    throw new YouTubePublishError('MALFORMED', true);
  const reader = response.body?.getReader();
  if (!reader) throw new YouTubePublishError('MALFORMED', true);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxResponse) {
      await reader.cancel();
      throw new YouTubePublishError('MALFORMED', true);
    }
    chunks.push(part.value);
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new YouTubePublishError('MALFORMED', true);
  }
}

// A session Location is a bearer-like capability and never leaves the API or
// encryption boundary. No redirects, credentials, fragments or other hosts.
export function validateYouTubeSession(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new YouTubePublishError('MALFORMED', true);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.googleapis.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/upload/youtube/v3/videos' ||
    url.searchParams.get('uploadType') !== 'resumable' ||
    url.searchParams.getAll('uploadType').length !== 1 ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(url.searchParams.get('upload_id') ?? '') ||
    url.searchParams.getAll('upload_id').length !== 1 ||
    (url.searchParams.has('part') &&
      (url.searchParams.getAll('part').length !== 1 ||
        url.searchParams.get('part') !== 'snippet,status')) ||
    [...url.searchParams.keys()].some(
      (key) => !['uploadType', 'upload_id', 'part'].includes(key),
    )
  )
    throw new YouTubePublishError('MALFORMED', true);
  return url.toString();
}

@Injectable()
export class YouTubePublisher {
  private async request(url: string, init: RequestInit, write: boolean) {
    try {
      return await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(write ? 45_000 : 15_000),
      });
    } catch (error) {
      throw new YouTubePublishError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'NETWORK',
        write,
      );
    }
  }
  async readiness(expectedChannel: string, token: string) {
    if (!channelId(expectedChannel) || !token) return false;
    const response = await this.request(
      `${api}/youtube/v3/channels?part=id&mine=true&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    );
    if (!response.ok) throw classified(response.status, false);
    const result = await json(response);
    return (
      Array.isArray(result.items) &&
      result.items.some(
        (value) =>
          value &&
          typeof value === 'object' &&
          'id' in value &&
          value.id === expectedChannel,
      )
    );
  }
  async initiate(
    token: string,
    metadata: { title: string; description: string; privacy: string },
    size: number,
  ) {
    const body = JSON.stringify({
      snippet: { title: metadata.title, description: metadata.description },
      status: { privacyStatus: metadata.privacy },
    });
    const response = await this.request(
      `${api}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'Content-Length': String(Buffer.byteLength(body)),
          'X-Upload-Content-Length': String(size),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body,
      },
      true,
    );
    if (!response.ok) throw classified(response.status, true);
    const location = response.headers.get('location');
    if (response.status !== 200 || !location)
      throw new YouTubePublishError('MALFORMED', true);
    return validateYouTubeSession(location);
  }
  private async progress(response: Response, size: number) {
    if (response.status === 308) {
      const range = response.headers.get('range');
      if (!range) return { kind: 'INCOMPLETE' as const, offset: 0 };
      const match = /^bytes=0-(\d+)$/.exec(range);
      const end = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(end) || end < 0 || end >= size)
        throw new YouTubePublishError('MALFORMED', true);
      return { kind: 'INCOMPLETE' as const, offset: end + 1 };
    }
    if (!response.ok) throw classified(response.status, true);
    if (![200, 201].includes(response.status))
      throw new YouTubePublishError('MALFORMED', true);
    const result = await json(response);
    if (typeof result.id !== 'string' || !videoId(result.id))
      throw new YouTubePublishError('MALFORMED', true);
    return { kind: 'COMPLETE' as const, videoId: result.id };
  }
  async probe(session: string, token: string, size: number) {
    const response = await this.request(
      validateYouTubeSession(session),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Length': '0',
          'Content-Range': `bytes */${size}`,
        },
      },
      false,
    );
    return this.progress(response, size);
  }
  async upload(
    session: string,
    token: string,
    stream: Readable,
    start: number,
    end: number,
    size: number,
  ) {
    const response = await this.request(
      validateYouTubeSession(session),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
        body: stream as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit,
      true,
    );
    return this.progress(response, size);
  }
  async verify(video: string, channel: string, privacy: string, token: string) {
    if (!videoId(video) || !channelId(channel))
      throw new YouTubePublishError('MALFORMED', false);
    const response = await this.request(
      `${api}/youtube/v3/videos?part=snippet,status,processingDetails&id=${video}`,
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    );
    if (!response.ok) throw classified(response.status, false);
    const result = await json(response);
    const items = result.items;
    if (!Array.isArray(items) || items.length !== 1)
      throw new YouTubePublishError('MALFORMED', false);
    const item = items[0] as Record<string, unknown>;
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const status = item.status as Record<string, unknown> | undefined;
    const processing = item.processingDetails as
      Record<string, unknown> | undefined;
    if (
      item.id !== video ||
      snippet?.channelId !== channel ||
      status?.privacyStatus !== privacy
    )
      throw new YouTubePublishError('MALFORMED', false);
    const state = processing?.processingStatus;
    if (!['processing', 'succeeded', 'failed'].includes(String(state)))
      throw new YouTubePublishError('MALFORMED', false);
    return state as 'processing' | 'succeeded' | 'failed';
  }
}
