import { ToastProvider } from '@/components/ui';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><main className="auth" id="main"><div className="auth-card"><div className="brand"><b>Samakose</b><span>The Business Doctor</span></div>{children}</div></main></ToastProvider>;
}
