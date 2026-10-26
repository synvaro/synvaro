import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../lib/api-proxy';
export const POST = (req: NextRequest) => forwardApi(req, '/organizations');
