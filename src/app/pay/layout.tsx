import { ToastProvider } from '@/components/ui';
export default function PayLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><main className="auth" id="main"><div className="auth-card" style={{ maxWidth: 560 }}><div className="brand"><b>Business Doctor</b><span>by Samakose Accelerator Lab</span></div>{children}</div></main></ToastProvider>;
}
