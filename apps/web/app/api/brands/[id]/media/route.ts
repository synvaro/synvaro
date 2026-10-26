import type { NextRequest } from 'next/server';
import { forwardMedia } from '../../../../../lib/media-proxy';
export const runtime = 'nodejs';
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid brand ID' }, { status: 400 });
  return forwardMedia(req, `/brands/${id}/media`);
}
export { handle as GET, handle as POST };
