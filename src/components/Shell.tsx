'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { can, ROLE_LABEL, type Resource } from '@/lib/rbac';
import type { Role } from '@/db/schema';
import { api } from '@/lib/client/api';
import { ToastProvider, useApi } from './ui';

type Item = { href: string; label: string; need?: [Resource, any]; roles?: Role[]; badge?: 'notifications' };
type Group = { title: string; items: Item[] };
const GROUPS: Group[] = [
  { title: 'Work', items: [
    { href: '/dashboard', label: 'Dashboard', need: ['dashboard', 'read'] },
    { href: '/cases', label: 'Cases', need: ['cases', 'read'] },
    { href: '/my-case', label: 'My business', roles: ['OWNER'] },
    { href: '/reviews', label: 'Review queue', need: ['prescriptions', 'approve'] },
    { href: '/actions', label: 'Actions', need: ['actions', 'read'] },
    { href: '/sessions', label: 'Coaching sessions', need: ['sessions', 'read'] },
    { href: '/reports', label: 'Reports', roles: ['FUNDER'] }
  ] },
  { title: 'Portfolio', items: [
    { href: '/organisations', label: 'Organisations', need: ['organisations', 'read'] },
    { href: '/programmes', label: 'Programmes', need: ['programmes', 'read'] }
  ] },
  { title: 'Finance', items: [
    { href: '/finance/invoices', label: 'Invoices', need: ['invoices', 'read'] },
    { href: '/finance/payments', label: 'Payments', need: ['payments', 'read'] },
    { href: '/finance/contracts', label: 'Contracts', need: ['contracts', 'read'] },
    { href: '/finance/plans', label: 'Plans', need: ['plans', 'read'] }
  ] },
  { title: 'Administration', items: [
    { href: '/admin/users', label: 'Users', need: ['users', 'create'] },
    { href: '/admin/audit', label: 'Audit trail', need: ['audit', 'read'] },
    { href: '/admin/settings', label: 'Settings', need: ['settings', 'read'] },
    { href: '/admin/system', label: 'System', need: ['integrations', 'read'] }
  ] }
];

export function Shell({ user, children }: { user: { name: string; role: Role; email: string }; children: ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false);
  const notes = useApi<{ unread: number }>('/notifications?pageSize=1');
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (i.roles ? i.roles.includes(user.role) : i.need ? can(user.role, i.need[0], i.need[1]) : true)) })).filter((g) => g.items.length);
  const current = (h: string) => path === h || path.startsWith(h + '/');
  return <ToastProvider>
    <a href="#main" className="skip">Skip to content</a>
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><b>Samakose</b><span>The Business Doctor</span></div>
        {groups.map((g) => <div key={g.title}><h4>{g.title}</h4>{g.items.map((i) => <Link key={i.href} className="item" href={i.href} aria-current={current(i.href) ? 'page' : undefined} onClick={() => setOpen(false)}>{i.label}</Link>)}</div>)}
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">Menu</button>
          <form className="grow" role="search" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('q'); if (v) router.push('/search?q=' + encodeURIComponent(String(v))); }}>
            <label className="sr" htmlFor="gsearch">Search everything</label>
            <input id="gsearch" name="q" type="search" placeholder="Search cases, organisations, people" style={{ maxWidth: 420 }} />
          </form>
          <Link className="btn" href="/notifications" aria-label={`Notifications${notes.data?.unread ? `, ${notes.data.unread} unread` : ''}`}>Alerts{notes.data?.unread ? <span className="badge-n">{notes.data.unread}</span> : null}</Link>
          <Link className="btn ghost" href="/profile" title={user.email}>{user.name}<span className="muted small hide-sm"> · {ROLE_LABEL[user.role]}</span></Link>
          <button className="btn" onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}>Sign out</button>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  </ToastProvider>;
}
