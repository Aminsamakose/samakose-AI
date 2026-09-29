import '@/api/routes';
import { dispatch } from '@/api/framework';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const h = (req: Request) => dispatch(req);
export { h as GET, h as POST, h as PATCH, h as PUT, h as DELETE };
