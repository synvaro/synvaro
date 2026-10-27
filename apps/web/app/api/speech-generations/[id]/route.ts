import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid ID' }, { status: 400 });
  return forwardApi(req, `/speech-generations/${id}`);
}
export const GET = handle;
export const DELETE = handle;
