import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
export const GET = (req: NextRequest) => forwardApi(req, '/ai/models');
