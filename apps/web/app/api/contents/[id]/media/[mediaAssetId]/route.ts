import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../../../lib/api-proxy';
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaAssetId: string }> },
) {
  const { id, mediaAssetId } = await params;
  if (![id, mediaAssetId].every((value) => /^[0-9a-f-]{36}$/i.test(value)))
    return Response.json({ message: 'Invalid attachment ID' }, { status: 400 });
  return forwardApi(req, `/contents/${id}/media/${mediaAssetId}`);
}
