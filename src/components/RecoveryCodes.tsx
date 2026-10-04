'use client';
import { useState } from 'react';
import { Button } from './ui';

/** Shown once, straight after codes are made. The server keeps only hashes, so a lost list cannot be shown again. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'I have saved these codes' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  return <div className="stack">
    <h2 style={{ margin: 0 }}>Save your recovery codes</h2>
    <p className="muted">If you lose your phone, each of these codes lets you sign in once without the authenticator app. They are shown only now. Keep them somewhere safe and private, such as a password manager or a locked drawer.</p>
    <ul className="mono" style={{ listStyle: 'none', margin: 0, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6, border: '1px solid var(--line, #d6d6d6)', borderRadius: 8 }} aria-label="Recovery codes">
      {codes.map((c) => <li key={c}>{c}</li>)}
    </ul>
    <div className="form-actions">
      <Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy codes'}</Button>
    </div>
    <label className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have stored these codes safely</label>
    <div className="form-actions"><Button variant="primary" disabled={!saved} onClick={onDone}>{doneLabel}</Button></div>
  </div>;
}
