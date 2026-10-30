import type { NextRequest } from 'next/server';
import { apiBase, webOrigin } from '../../../../../../lib/auth';

function safeRedirect(destination: URL) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const destination = new URL('/social/oauth/return', webOrigin());
  if (!['meta', 'linkedin', 'google'].includes(provider))
    return safeRedirect(destination);
  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || (!code && !error))
    return safeRedirect(destination);
  try {
    const response = await fetch(
      `${apiBase()}/social/oauth/${provider}/callback`,
      {
        method: 'POST',
        headers: { origin: webOrigin(), 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          ...(code ? { code } : {}),
          ...(error ? { error } : {}),
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (response.ok) {
      const result = (await response.json()) as {
        brandId?: string;
        attemptId?: string;
      };
      if (
        result.brandId &&
        result.attemptId &&
        /^[0-9a-f-]{36}$/i.test(result.brandId) &&
        /^[0-9a-f-]{36}$/i.test(result.attemptId)
      ) {
        // A Strict session cookie is omitted on the provider's cross-site
        // return. Land on a public same-origin page before loading the Studio.
        destination.search = `?brand=${result.brandId}&attempt=${result.attemptId}`;
      }
    }
  } catch {
    // The browser sees only a fixed, safe destination.
  }
  return safeRedirect(destination);
}
