import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../../../lib/api-proxy';
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid ID' }, { status: 400 });
  return forwardApi(req, `/contents/${id}/speech-generations/latest`);
};
