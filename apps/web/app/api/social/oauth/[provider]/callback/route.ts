import type { NextRequest } from 'next/server';
import { apiBase, webOrigin } from '../../../../../../lib/auth';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const destination = new URL('/brands?social=error', webOrigin());
  if (!['meta', 'linkedin', 'google'].includes(provider))
    return Response.redirect(destination, 303);
  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || (!code && !error))
    return Response.redirect(destination, 303);
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
        destination.pathname = `/brands/${result.brandId}/social-accounts`;
        destination.search = `?attempt=${result.attemptId}`;
      }
    }
  } catch {
    // The browser sees only a fixed, safe destination.
  }
  const redirect = Response.redirect(destination, 303);
  redirect.headers.set('Cache-Control', 'no-store');
  redirect.headers.set('Referrer-Policy', 'no-referrer');
  return redirect;
}
