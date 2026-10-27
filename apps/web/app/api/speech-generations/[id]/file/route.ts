import type { NextRequest } from 'next/server';
import { forwardMedia } from '../../../../../lib/media-proxy';
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid ID' }, { status: 400 });
  return forwardMedia(req, `/speech-generations/${id}/file`);
};
