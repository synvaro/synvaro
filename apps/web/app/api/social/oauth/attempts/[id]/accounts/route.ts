import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../../../../lib/api-proxy';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ message: 'Invalid attempt ID' }, { status: 400 });
  return forwardApi(req, `/social/oauth/attempts/${id}/accounts`);
}
