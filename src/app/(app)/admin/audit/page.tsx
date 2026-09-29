'use client';
import { useState } from 'react';
import { PageHead, Tabs } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { AuditTable, EventsTable } from '@/components/admin/AuditViews';

export default function AuditPage() {
  const [tab, setTab] = useState('audit');
  return <Guard resource="audit" action="read" title="Audit trail">{(me) => <>
    <PageHead title="Audit trail" sub="Every sign-in, change and export is recorded with who, when and what changed." />
    <div className="card stack">
      <Tabs tabs={[{ id: 'audit', label: 'Audit log' }, { id: 'events', label: 'Domain events' }]} active={tab} onChange={setTab} />
      {tab === 'audit'
        ? <section aria-label="Audit log"><AuditTable exportable={me.can('audit', 'export')} /></section>
        : <section aria-label="Domain events"><p className="muted small" style={{ marginBottom: 10 }}>Events are business facts the platform emits, such as a payment received or a score changing. They drive notifications and automation.</p><EventsTable exportable={me.can('audit', 'export')} /></section>}
    </div>
  </>}</Guard>;
}
