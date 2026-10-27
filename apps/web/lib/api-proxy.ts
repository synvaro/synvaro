import 'server-only';
import type { NextRequest } from 'next/server';
import { apiBase, sessionCookieHeader, webOrigin } from './auth';

// Called only with paths selected by the explicit route handlers. No arbitrary proxy.
export async function forwardApi(req: NextRequest, path: string) {
  const headers = new Headers({ cookie: await sessionCookieHeader() });
  let body: string | undefined;
  if (req.method !== 'GET') {
    if (
      req.headers.get('origin') !== webOrigin() ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return Response.json(
        { message: 'Request origin rejected' },
        { status: 403 },
      );
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        req.headers.get('content-type') ?? '',
      )
    ) {
      return Response.json({ message: 'JSON body required' }, { status: 400 });
    }
    // Bound streamed bodies too, rather than trusting Content-Length.
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (
          length >
          (/^\/contents(?:\/[0-9a-f-]{36}(?:\/media(?:\/order)?)?)?$/i.test(
            path,
          )
            ? 131072
            : /^\/brands\/[0-9a-f-]{36}\/profile$/i.test(path)
              ? 65536
              : 8192)
        ) {
          await reader.cancel();
          return Response.json(
            { message: 'Request too large' },
            { status: 413 },
          );
        }
        chunks.push(chunk.value);
      }
    }
    body = Buffer.concat(chunks).toString('utf8');
    headers.set('content-type', 'application/json');
    headers.set('origin', req.headers.get('origin')!);
    const site = req.headers.get('sec-fetch-site');
    if (site) headers.set('sec-fetch-site', site);
  }
  try {
    const upstream = await fetch(`${apiBase()}${path}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(
        /^\/contents\/[0-9a-f-]{36}\/image-generations$/i.test(path)
          ? 150_000
          : /^\/contents\/[0-9a-f-]{36}\/ai-generations$/i.test(path)
            ? 105_000
            : 10_000,
      ),
    });
    const outgoing = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const cookie of upstream.headers.getSetCookie())
      outgoing.append('set-cookie', cookie);
    const retry = upstream.headers.get('retry-after');
    if (retry) outgoing.set('retry-after', retry);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { message: 'Authentication service unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
