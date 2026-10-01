'use client';
import { useState } from 'react';
import { PageHead, Tabs } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { RulesEditor } from '@/components/admin/RulesEditor';
import { WorkflowEditor, EmailEditor, ReportTextEditor } from '@/components/admin/WorkflowSettings';
import { BillingEditor, MaintenanceEditor, SecurityOverview, TransferPanel } from '@/components/admin/SystemSettings';
import { LibraryEditor, QuestionsEditor } from '@/components/admin/BankEditors';

export default function SettingsPage() {
  const [tab, setTab] = useState('workflow');
  return <Guard resource="settings" action="read" title="Settings">{(me) => <>
    <PageHead title="Settings" sub="Workflow switches, registration, email wording, report wording, assessment rules, the question bank and the intervention library. All changes are recorded in the audit trail." />
    <Tabs tabs={[{ id: 'workflow', label: 'Workflow' }, { id: 'emails', label: 'Emails' }, { id: 'reports', label: 'Reports' }, { id: 'rules', label: 'Assessment rules' }, { id: 'questions', label: 'Questions' }, { id: 'library', label: 'Library' }, { id: 'billing', label: 'Billing' }, { id: 'maintenance', label: 'Maintenance' }, { id: 'security', label: 'Security' }, { id: 'transfer', label: 'Transfer' }]} active={tab} onChange={setTab} />
    <div role="tabpanel">
      {tab === 'workflow' && <WorkflowEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'emails' && <EmailEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'reports' && <ReportTextEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'rules' && <RulesEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'questions' && <div className="card"><QuestionsEditor canCreate={me.can('settings', 'create')} canEdit={me.can('settings', 'edit')} /></div>}
      {tab === 'billing' && <BillingEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'maintenance' && <MaintenanceEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'security' && <SecurityOverview />}
      {tab === 'transfer' && <TransferPanel canExport={me.can('settings', 'edit')} />}
      {tab === 'library' && <div className="card"><LibraryEditor canCreate={me.can('settings', 'create')} canEdit={me.can('settings', 'edit')} /></div>}
    </div>
  </>}</Guard>;
}
