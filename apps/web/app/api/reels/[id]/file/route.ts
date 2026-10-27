import type { NextRequest } from 'next/server';
import { forwardMedia } from '../../../../../lib/media-proxy';
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid ID' }, { status: 400 });
  return forwardMedia(req, `/reels/${id}/file`);
}
