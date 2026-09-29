import type { Metadata, Viewport } from 'next';
import '@fontsource/fira-sans/400.css';
import '@fontsource/fira-sans/500.css';
import '@fontsource/fira-sans/600.css';
import '@fontsource/fira-sans/700.css';
import '@fontsource/fira-code/400.css';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Samakose | The Business Doctor', template: '%s | Samakose' }, description: 'Diagnose, prescribe and track the health of enterprises.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

const NO_FLASH = "try{var t=localStorage.getItem('sk-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GH" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head><body>{children}</body></html>;
}
