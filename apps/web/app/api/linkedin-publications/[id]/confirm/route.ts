import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../../lib/api-proxy';
export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  params.then(({ id }) =>
    forwardApi(req, `/linkedin-publications/${encodeURIComponent(id)}/confirm`),
  );
