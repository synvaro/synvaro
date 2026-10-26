import type { NextRequest } from 'next/server';
import { forwardApi } from '../../../../lib/api-proxy';
const preferences = (req: NextRequest) => forwardApi(req, '/ai/preferences');
export const GET = preferences;
export const PUT = preferences;
