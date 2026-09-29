import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Samakose | The Business Doctor', template: '%s | Samakose' }, description: 'Diagnose, prescribe and track the health of enterprises.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GH"><body>{children}</body></html>;
}
