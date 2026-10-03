import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ToastProvider } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LogoMark } from '@/components/site/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>
    <a href="#main" className="skip">Skip to content</a>
    <header className="auth-top"><Link href="/" className="back-link"><ArrowLeft width={16} height={16} aria-hidden="true" />Back to website</Link><ThemeToggle /></header>
    <main className="auth" id="main"><div className="auth-card"><div className="brand" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><LogoMark /><div style={{ display: 'flex', flexDirection: 'column' }}><b>Business Doctor</b><span>by Samakose Accelerator Lab</span></div></div>{children}</div></main>
  </ToastProvider>;
}
