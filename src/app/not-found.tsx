import Link from 'next/link';
export default function NotFound() {
  return <div className="auth"><div className="auth-card"><h1>Page not found</h1><p className="muted">The page may have moved, or you may not have access to it.</p><Link className="btn primary" href="/dashboard">Go to dashboard</Link></div></div>;
}
