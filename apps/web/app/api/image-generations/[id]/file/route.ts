import type { NextRequest } from 'next/server';
import { forwardMedia } from '../../../../../lib/media-proxy';
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid ID' }, { status: 400 });
  return forwardMedia(req, `/image-generations/${id}/file`);
}
export const GET = handle;
