import { createFormosaHandler } from '../../../lib/formosa.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

export const GET = createFormosaHandler();
