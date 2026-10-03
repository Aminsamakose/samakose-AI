'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api, dateFmt, errText, titleCase } from '@/lib/client/api';
import { AnimatedValue, Badge, BarList, Button, Empty, Field, FormError, Modal, useApi, useForm, useToast } from '@/components/ui';

export type Me = { user: { id: string; name: string; email: string; role: string; roleLabel: string; orgId: string | null; mfaEnabled: boolean }; permissions: Record<string, string[]> };

export function useTitle(t: string) { useEffect(() => { document.title = `${t} | Business Doctor`; }, [t]); }
export function useMe() { return useApi<Me>('/auth/me'); }
export const canDo = (me: Me | null, resource: string, action: string) => !!me?.permissions?.[resource]?.includes(action);

/** A metric that is a link, with a plain sentence saying what it counts. */
export function LinkTile({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint: string; href?: string; tone?: string }) {
  const inner = <><span className="l">{label}</span><span className="v" style={tone ? { color: `var(--${tone})` } : undefined}><AnimatedValue value={value} /></span><span className="small muted">{hint}</span></>;
  return href
    ? <Link href={href} className="tile" style={{ textDecoration: 'none', color: 'inherit' }} aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}. ${hint}. Open details`}>{inner}</Link>
    : <div className="tile">{inner}</div>;
}

/** Bars plus the same numbers as a table for anyone who cannot use the picture. */
export function BarsWithTable({ data, label, format, hrefFor }: { data: { label: string; value: number }[]; label: string; format?: (n: number) => string; hrefFor?: (label: string) => string }) {
  if (!data.length) return <Empty title="No data yet" />;
  return <div className="stack">
    <BarList data={data} format={format} />
    <details className="small muted"><summary>View {label} as a table</summary>
      <div className="table-wrap"><table><thead><tr><th>Item</th><th className="r">Value</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{hrefFor ? <Link href={hrefFor(d.label)}>{titleCase(d.label)}</Link> : titleCase(d.label)}</td><td className="r num">{format ? format(d.value) : d.value}</td></tr>)}</tbody></table></div>
    </details>
  </div>;
}

export const daysLabel = (d: string | null | undefined) => dateFmt(d);

/**
 * Status control for an action. Completing needs a short note on what was done (the API requires it).
 * Only shows the choices the API allows from the current status.
 */
export const ACTION_NEXT: Record<string, string[]> = { Open: ['In progress', 'Done'], 'In progress': ['Open', 'Done'], Done: [] };
export function ActionStatus({ action, onChanged, compact }: { action: { id: string; status: string; code?: string; text: string; evidenceNote?: string | null }; onChanged: () => void; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const opts = ACTION_NEXT[action.status] ?? [];
  const change = async (status: string, evidenceNote?: string) => {
    setBusy(true);
    try { await api.patch(`/actions/${action.id}`, { status, ...(evidenceNote ? { evidenceNote } : {}) }); toast(`Marked ${status.toLowerCase()}`); onChanged(); }
    catch (e) { toast(errText(e), 'bad'); throw e; }
    finally { setBusy(false); }
  };
  if (!opts.length) return <Badge>{action.status}</Badge>;
  return <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
    <Badge>{action.status}</Badge>
    {opts.map((s) => <Button key={s} size="sm" disabled={busy} aria-label={`Mark ${action.code ?? 'action'} ${s.toLowerCase()}: ${action.text.slice(0, 60)}`} onClick={() => s === 'Done' ? setNoteOpen(true) : change(s).catch(() => {})}>{compact ? s : `Mark ${s.toLowerCase()}`}</Button>)}
    <DoneModal open={noteOpen} onClose={() => setNoteOpen(false)} initial={action.evidenceNote ?? ''} onSubmit={async (note) => { await change('Done', note); setNoteOpen(false); }} />
  </span>;
}
function DoneModal({ open, onClose, initial, onSubmit }: { open: boolean; onClose: () => void; initial: string; onSubmit: (note: string) => Promise<void> }) {
  const f = useForm({ evidenceNote: initial }, async (v) => {
    await onSubmit(v.evidenceNote.trim());
  });
  const [err, setErr] = useState<string | null>(null);
  return <Modal open={open} onClose={onClose} title="Complete this action">
    <form onSubmit={(e) => { e.preventDefault(); if (f.values.evidenceNote.trim().length < 3) { setErr('Say what was done or attach proof before marking this complete'); return; } setErr(null); f.onSubmit(); }} className="stack" noValidate>
      <FormError message={f.formError} />
      <Field label="What was done" name="evidenceNote" required error={err ?? f.errors.evidenceNote} hint="A short note, for example what you did or where the proof is kept.">
        {(p) => <textarea {...p} {...f.input('evidenceNote')} maxLength={1000} />}
      </Field>
      <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Mark done</Button><Button type="button" onClick={onClose}>Cancel</Button></div>
    </form>
  </Modal>;
}
