import { readMedia } from '@/services/media';

export const runtime = 'nodejs';
/** Public address for website images and downloads. Only files uploaded to the media library are reachable here. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const f = await readMedia((await params).id).catch(() => null);
  if (!f) return new Response('Not found', { status: 404 });
  const image = f.mime.startsWith('image/');
  return new Response(new Uint8Array(f.data), { headers: {
    'Content-Type': f.mime, 'Content-Length': String(f.data.length), 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="${f.filename.replace(/"/g, '')}"`,
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', 'Content-Security-Policy': "default-src 'none'; sandbox"
  } });
}
