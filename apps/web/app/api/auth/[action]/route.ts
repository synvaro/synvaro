import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
export const dynamic = 'force-dynamic';
async function proxy(
  req: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  const method =
    action === 'me'
      ? 'GET'
      : ['register', 'login', 'logout'].includes(action)
        ? 'POST'
        : null;
  if (!method || req.method !== method)
    return Response.json({ message: 'Not found' }, { status: 404 });
  return forwardApi(req, `/auth/${action}`);
}
export const GET = proxy;
export const POST = proxy;
