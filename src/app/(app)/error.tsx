'use client';
/** A failure inside the signed-in area keeps the navigation, so the person can go somewhere else instead of being stranded. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="card" role="alert"><h1>Something went wrong</h1><p className="muted">We could not show this page. Your work is safe. {error.digest && <span className="mono small">Ref {error.digest}</span>}</p><div className="row"><button className="btn primary" onClick={reset}>Try again</button><a className="btn" href="/dashboard">Go to the dashboard</a></div></div>;
}
