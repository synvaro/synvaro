import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';

export function GET(req: NextRequest) {
  return forwardApi(req, '/social/providers');
}
