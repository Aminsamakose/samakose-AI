'use client';
import { useState } from 'react';
import { PageHead, Tabs } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { RulesEditor } from '@/components/admin/RulesEditor';
import { LibraryEditor, QuestionsEditor } from '@/components/admin/BankEditors';

export default function SettingsPage() {
  const [tab, setTab] = useState('rules');
  return <Guard resource="settings" action="read" title="Settings">{(me) => <>
    <PageHead title="Settings" sub="The rules, question bank and intervention library that shape every diagnosis. All changes are recorded in the audit trail." />
    <Tabs tabs={[{ id: 'rules', label: 'Rules' }, { id: 'questions', label: 'Questions' }, { id: 'library', label: 'Library' }]} active={tab} onChange={setTab} />
    <div role="tabpanel">
      {tab === 'rules' && <RulesEditor canEdit={me.can('settings', 'edit')} />}
      {tab === 'questions' && <div className="card"><QuestionsEditor canCreate={me.can('settings', 'create')} canEdit={me.can('settings', 'edit')} /></div>}
      {tab === 'library' && <div className="card"><LibraryEditor canCreate={me.can('settings', 'create')} canEdit={me.can('settings', 'edit')} /></div>}
    </div>
  </>}</Guard>;
}
