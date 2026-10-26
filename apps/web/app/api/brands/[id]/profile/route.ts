import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../../lib/api-proxy';
async function profile(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json(
      { message: 'Brand ID must be a UUID' },
      { status: 400 },
    );
  return forwardApi(req, `/brands/${encodeURIComponent(id)}/profile`);
}
export const GET = profile;
export const PUT = profile;
