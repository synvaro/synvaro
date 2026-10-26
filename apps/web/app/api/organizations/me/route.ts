import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
export const dynamic = 'force-dynamic';
export const GET = (req: NextRequest) => forwardApi(req, '/organizations/me');
