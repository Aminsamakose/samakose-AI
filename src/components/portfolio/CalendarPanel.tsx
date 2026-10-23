'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';
import { usePerms } from '@/components/portfolio/shared';

export type Connection = { id: string; provider: string; externalCalendarId: string | null; accountLabel: string | null; status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'; connectedAt: string; disconnectedAt: string | null };
export type CalendarEvent = {
  id: string; sessionId: string | null; provider: string; title: string; startsAt: string; endsAt: string; timezone: string;
  location: string | null; meetingUrl: string | null; status: 'SCHEDULED' | 'UPDATED' | 'CANCELLED' | 'SYNC_ERROR'; syncError: string | null;
};

const PROVIDERS = [{ value: 'GOOGLE', label: 'Google Calendar' }, { value: 'MICROSOFT', label: 'Microsoft 365' }, { value: 'ICS', label: 'ICS feed' }, { value: 'INTERNAL', label: 'Internal only (no sync)' }];
const eventTone = (s: CalendarEvent['status']) => (s === 'CANCELLED' ? '' : s === 'SYNC_ERROR' ? 'bad' : s === 'UPDATED' ? 'pending' : 'ok');

function ConnectForm({ base, onDone, onCancel }: { base?: Connection; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ provider: base?.provider ?? 'GOOGLE', externalCalendarId: base?.externalCalendarId ?? '', accountLabel: base?.accountLabel ?? '' },
    (v) => api.post('/calendar/connections', { provider: v.provider, externalCalendarId: v.externalCalendarId.trim() || null, accountLabel: v.accountLabel.trim() || null }),
    { onDone, success: base ? 'Calendar connection updated' : 'Calendar connected' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Connect a calendar"><FormError message={f.formError} />
    <p className="small muted">Secrets and sign-in tokens are handled outside this form; this just records which provider and calendar your scheduled sessions should go to.</p>
    <div className="form-grid">
      <Field label="Provider" name="provider">{() => <select value={f.values.provider} onChange={(e) => f.set('provider', e.target.value)}>
        {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>}</Field>
      <Field label="Account label (optional)" name="accountLabel" hint="For example, your work email.">{(p) => <input {...p} {...f.input('accountLabel')} maxLength={200} />}</Field>
      <Field label="Calendar ID (optional)" name="externalCalendarId" hint="Leave blank to use the default calendar for this account.">{(p) => <input {...p} {...f.input('externalCalendarId')} maxLength={500} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{base ? 'Save changes' : 'Connect'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Personal calendar connection, for the profile page. One connection per provider per user; no OAuth tokens are stored here. */
export function CalendarConnectionCard() {
  const st = useApi<Connection[]>('/calendar/connections');
  const { can } = usePerms();
  const canManage = can('programme_workspaces', 'edit');
  const toast = useToast();
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const done = () => { setMode(null); st.reload(); };
  const rows = st.data ?? [];
  const active = rows.filter((c) => c.status === 'CONNECTED');
  return <Card title="Calendar" actions={canManage && mode !== 'new' ? <Button onClick={() => setMode('new')}>Connect a calendar</Button> : undefined}>
    <p className="small muted">Connect a calendar so sessions you schedule on programmes show up on it.</p>
    {mode === 'new' && <ConnectForm onDone={done} onCancel={() => setMode(null)} />}
    <Async state={st}>{() => active.length === 0 ? <Empty title="No calendar connected" /> :
      <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Account</th><th>Connected</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
        {active.map((c) => <tr key={c.id}>
          <td>{PROVIDERS.find((p) => p.value === c.provider)?.label ?? c.provider}</td>
          <td>{c.accountLabel ?? '-'}</td>
          <td>{new Date(c.connectedAt).toLocaleDateString()}</td>
          {canManage && <td><ConfirmButton size="sm" label="Disconnect" message="Disconnect this calendar? Already-scheduled sessions keep their event, but new ones will not sync here." onConfirm={async () => { try { await api.post(`/calendar/connections/${c.id}/disconnect`, {}); toast('Calendar disconnected'); st.reload(); } catch (e) { toast(errText(e)); } }} /></td>}
        </tr>)}
      </tbody></table></div>}
    </Async>
  </Card>;
}

function RescheduleForm({ event, onDone, onCancel }: { event: CalendarEvent; onDone: () => void; onCancel: () => void }) {
  const toLocal = (iso: string) => new Date(iso).toISOString().slice(0, 16);
  const f = useForm({ startsAt: toLocal(event.startsAt), endsAt: toLocal(event.endsAt) },
    (v) => api.post(`/calendar-events/${event.id}/reschedule`, { startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() }),
    { onDone, success: 'Calendar event moved' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Reschedule calendar event"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Starts" name="startsAt" error={f.errors.startsAt}>{(p) => <input {...p} {...f.input('startsAt')} type="datetime-local" />}</Field>
      <Field label="Ends" name="endsAt" error={f.errors.endsAt}>{(p) => <input {...p} {...f.input('endsAt')} type="datetime-local" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Move</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Scheduling for one delivery session: schedule it onto the calendar, or reschedule/cancel an existing event. Meant to sit inside a session row in DeliveryPanel. */
export function SessionCalendarSection({ sessionId, event, canManage, onChanged }: { sessionId: string; event: CalendarEvent | null; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const schedule = async () => {
    setBusy(true);
    try { await api.post(`/delivery-sessions/${sessionId}/calendar`, {}); toast('Session scheduled on the calendar'); onChanged(); }
    catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!event) return;
    setBusy(true);
    try { await api.post(`/calendar-events/${event.id}/cancel`, {}); toast('Calendar event cancelled'); onChanged(); }
    catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  if (!event || event.status === 'CANCELLED') {
    return canManage ? <Button size="sm" loading={busy} onClick={schedule}>Schedule on calendar</Button> : <span className="small muted">Not scheduled</span>;
  }
  return <div className="stack" style={{ gap: 6 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge tone={eventTone(event.status)}>{event.status.replace('_', ' ')}</Badge>
      <span className="small">{new Date(event.startsAt).toLocaleString()}</span>
      {event.meetingUrl && <a href={event.meetingUrl} target="_blank" rel="noreferrer">Join link</a>}
      {canManage && !rescheduling && <><Button size="sm" onClick={() => setRescheduling(true)}>Reschedule</Button><Button size="sm" variant="danger" loading={busy} onClick={cancel}>Cancel</Button></>}
    </div>
    {event.syncError && <p className="small" style={{ color: 'var(--bad)' }}>{event.syncError}</p>}
    {rescheduling && <RescheduleForm event={event} onDone={() => { setRescheduling(false); onChanged(); }} onCancel={() => setRescheduling(false)} />}
  </div>;
}
