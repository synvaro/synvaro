import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../lib/api-proxy';
export const POST = (req: NextRequest) => forwardApi(req, '/contents');
export function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams;
  const id = query.get('brandId');
  if (
    !id ||
    query.getAll('brandId').length !== 1 ||
    [...query.keys()].some((key) => key !== 'brandId')
  )
    return Response.json({ message: 'Select one brand' }, { status: 400 });
  return forwardApi(req, `/contents?brandId=${encodeURIComponent(id)}`);
}
