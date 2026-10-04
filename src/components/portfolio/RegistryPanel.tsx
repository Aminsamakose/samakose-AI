'use client';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, useApi, useToast } from '@/components/ui';
import { useState } from 'react';

type Row = { id: string; code: string; name: string; region: string | null; caseCount: number };
type Group = { reason: string; strength: 'certain' | 'likely' | 'possible'; ids: string[]; rows: Row[] };
const WHY: Record<string, string> = { tin: 'Same TIN', registration: 'Same registration number', name: 'Same name in the same region', email: 'Same contact email', phone: 'Same contact phone' };

/** Administrator view: possible duplicates to merge, and archived organisations to restore. */
export function RegistryPanel() {
  const toast = useToast();
  const dup = useApi<{ groups: Group[] }>('/organisations/duplicates');
  const arch = useApi<{ items: { id: string; code: string; name: string; region: string | null }[] }>('/organisations?status=Archived&pageSize=100');
  const [reason, setReason] = useState('Registered twice');
  const merge = async (from: string, into: string) => { try { await api.post(`/organisations/${from}/merge`, { intoId: into, reason, confirm: true }); toast('Merged'); dup.reload(); } catch (e: any) { toast(e?.message ?? 'Merge failed'); } };
  const restore = async (id: string) => { try { await api.post(`/organisations/${id}/unarchive`, {}); toast('Restored'); arch.reload(); } catch (e: any) { toast(e?.message ?? 'Could not restore'); } };
  return <div className="stack">
    <Card title="Possible duplicates">
      <label className="field"><span>Reason recorded with a merge</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <Async state={dup}>{(d) => d.groups.length === 0 ? <Empty title="No duplicates found" hint="Records are compared by TIN, registration number, name and contact details." /> :
        <div className="stack">{d.groups.map((g) => <div key={g.reason + g.ids.join()} className="stack"><div><Badge tone={g.strength === 'certain' ? 'bad' : 'warn'}>{g.strength}</Badge> {WHY[g.reason]}</div>
          <div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Region</th><th>Cases</th><th>Merge</th></tr></thead><tbody>{g.rows.map((r) => <tr key={r.id}><td><span className="mono">{r.code}</span> {r.name}</td><td>{r.region}</td><td>{r.caseCount}</td>
            <td>{g.rows.filter((x) => x.id !== r.id).map((t) => <ConfirmButton key={t.id} label={`Into ${t.code}`} message={`Merge ${r.name} into ${t.name}? Cases, users and documents move to ${t.name}. ${r.name} is archived. This cannot be undone.`} onConfirm={() => merge(r.id, t.id)} />)}</td></tr>)}</tbody></table></div></div>)}</div>}</Async>
    </Card>
    <Card title="Archived organisations">
      <Async state={arch}>{(a) => a.items.length === 0 ? <Empty title="Nothing archived" /> :
        <div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Region</th><th></th></tr></thead><tbody>{a.items.map((r) => <tr key={r.id}><td><span className="mono">{r.code}</span> {r.name}</td><td>{r.region}</td><td><Button onClick={() => restore(r.id)}>Restore</Button></td></tr>)}</tbody></table></div>}</Async>
    </Card>
  </div>;
}
