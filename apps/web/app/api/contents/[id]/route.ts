import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
async function content(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json(
      { message: 'Content ID must be a UUID' },
      { status: 400 },
    );
  return forwardApi(req, `/contents/${encodeURIComponent(id)}`);
}
export const GET = content;
export const PATCH = content;
