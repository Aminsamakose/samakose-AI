import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/public-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Samakose | The Business Doctor', template: '%s | Samakose' }, description: 'Diagnose, prescribe and track the health of enterprises.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

const NO_FLASH = "try{var t=localStorage.getItem('sk-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GH" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head><body>{children}</body></html>;
}
