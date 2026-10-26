import 'server-only';
import type { NextRequest } from 'next/server';
import { apiBase, sessionCookieHeader, webOrigin } from './auth';

// Only explicit media routes call this streaming proxy.
export async function forwardMedia(req: NextRequest, path: string) {
  const headers = new Headers({ cookie: await sessionCookieHeader() });
  let exceeded = false;
  let body: ReadableStream<Uint8Array> | undefined;
  if (req.method === 'POST') {
    if (
      req.headers.get('origin') !== webOrigin() ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      return Response.json(
        { message: 'Request origin rejected' },
        { status: 403 },
      );
    const type = req.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data\s*;/i.test(type))
      return Response.json(
        { message: 'Multipart upload required' },
        { status: 400 },
      );
    const limit = 20 * 1024 * 1024 + 65536;
    if (Number(req.headers.get('content-length') ?? 0) > limit)
      return Response.json(
        { message: 'Maximum file size is 20 MiB' },
        { status: 413 },
      );
    let bytes = 0;
    body = req.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > limit) {
            exceeded = true;
            controller.error(new Error('Upload too large'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    headers.set('content-type', type);
    headers.set('origin', webOrigin());
  } else {
    const range = req.headers.get('range');
    if (range) headers.set('range', range);
  }
  try {
    const options: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(120000)]),
    };
    if (body) options.duplex = 'half';
    const upstream = await fetch(`${apiBase()}${path}`, options);
    const outgoing = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition',
      'content-security-policy',
      'cross-origin-resource-policy',
    ]) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        message: exceeded
          ? 'Maximum file size is 20 MiB'
          : 'Media service unavailable',
      },
      {
        status: exceeded ? 413 : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
