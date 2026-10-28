import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
export const GET = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  params.then(({ id }) =>
    forwardApi(req, `/youtube-publications/${encodeURIComponent(id)}`),
  );
