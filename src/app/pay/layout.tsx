import { ToastProvider } from '@/components/ui';
export default function PayLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><main className="auth" id="main"><div className="auth-card" style={{ maxWidth: 560 }}><div className="brand"><b>Samakose</b><span>The Business Doctor</span></div>{children}</div></main></ToastProvider>;
}
