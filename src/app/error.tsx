'use client';
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="auth"><div className="auth-card" role="alert"><h1>Something went wrong</h1><p className="muted">We could not show this page. {error.digest && <span className="mono small">Ref {error.digest}</span>}</p><button className="btn primary" onClick={reset}>Try again</button></div></div>;
}
