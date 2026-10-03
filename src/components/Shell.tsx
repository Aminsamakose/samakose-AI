'use client';
import { ThemeToggle } from './ThemeToggle';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { can, ROLE_LABEL, type Resource } from '@/lib/rbac';
import type { Role } from '@/db/schema';
import { api } from '@/lib/client/api';
import { ToastProvider, useApi } from './ui';
import { Icon, type IconName } from './Icon';
import { FeedbackLauncher } from './FeedbackLauncher';

type Item = { icon: IconName; href: string; label: string; need?: [Resource, any]; roles?: Role[]; badge?: 'notifications' };
type Group = { title: string; items: Item[] };
const GROUPS: Group[] = [
  { title: 'Work', items: [
    { icon: 'dashboard', href: '/dashboard', label: 'Dashboard', need: ['dashboard', 'read'] },
    { icon: 'cases', href: '/cases', label: 'Cases', need: ['cases', 'read'] },
    { icon: 'business', href: '/my-case', label: 'My business', roles: ['OWNER'] },
    { icon: 'users', href: '/team', label: 'My team', need: ['team', 'read'] },
    { icon: 'actions', href: '/answer', label: 'My questions', roles: ['OWNER', 'RESPONDENT'] },
    { icon: 'reviews', href: '/reviews', label: 'Review queue', need: ['prescriptions', 'approve'] },
    { icon: 'actions', href: '/actions', label: 'Actions', need: ['actions', 'read'] },
    { icon: 'sessions', href: '/sessions', label: 'Coaching sessions', need: ['sessions', 'read'] },
    { icon: 'reports', href: '/reports', label: 'Reports', roles: ['FUNDER'] }
  ] },
  { title: 'Portfolio', items: [
    { icon: 'organisations', href: '/organisations', label: 'Organisations', need: ['organisations', 'read'] },
    { icon: 'programmes', href: '/programmes', label: 'Programmes', need: ['programmes', 'read'] }
  ] },
  { title: 'Finance', items: [
    { icon: 'invoices', href: '/finance/invoices', label: 'Invoices', need: ['invoices', 'read'] },
    { icon: 'payments', href: '/finance/payments', label: 'Payments', need: ['payments', 'read'] },
    { icon: 'contracts', href: '/finance/contracts', label: 'Contracts', need: ['contracts', 'read'] },
    { icon: 'plans', href: '/finance/plans', label: 'Plans', need: ['plans', 'read'] }
  ] },
  { title: 'Administration', items: [
    { icon: 'dashboard', href: '/admin', label: 'Command Centre', need: ['users', 'create'] },
    { icon: 'users', href: '/admin/users', label: 'Users', need: ['users', 'create'] },
    { icon: 'users', href: '/admin/registrations', label: 'Pending approvals', need: ['users', 'edit'] },
    { icon: 'system', href: '/admin/agents', label: 'AI workforce', need: ['agents', 'read'] },
    { icon: 'settings', href: '/admin/registration', label: 'Registration settings', need: ['consent', 'read'] },
    { icon: 'inbox', href: '/admin/website', label: 'Website', need: ['content', 'read'] },
    { icon: 'inbox', href: '/admin/feedback', label: 'Feedback', need: ['feedback', 'read'] },
    { icon: 'audit', href: '/admin/audit', label: 'Audit trail', need: ['audit', 'read'] },
    { icon: 'settings', href: '/admin/settings', label: 'Settings', need: ['settings', 'read'] },
    { icon: 'system', href: '/admin/system', label: 'System', need: ['integrations', 'read'] }
  ] }
];

export function Shell({ user, children }: { user: { name: string; role: Role; email: string }; children: ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false);
  const notes = useApi<{ unread: number }>('/notifications?pageSize=1');
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (i.roles ? i.roles.includes(user.role) : i.need ? can(user.role, i.need[0], i.need[1]) : true)) })).filter((g) => g.items.length);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const h = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const primary = groups.flatMap((g) => g.items).slice(0, 4);
  const current = (h: string) => path === h || (h !== '/admin' && path.startsWith(h + '/'));
  return <ToastProvider>
    <a href="#main" className="skip">Skip to content</a>
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><b>Business Doctor</b><span>by Samakose Accelerator Lab</span></div>
        {groups.map((g) => <div key={g.title}><h4>{g.title}</h4>{g.items.map((i) => <Link key={i.href} className="item" href={i.href} aria-current={current(i.href) ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={i.icon} />{i.label}</Link>)}</div>)}
        <Link className="site-link" href="/">Back to the public website</Link>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" />Menu</button>
          <form className="grow" role="search" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('q'); if (v) router.push('/search?q=' + encodeURIComponent(String(v))); }}>
            <label className="sr" htmlFor="gsearch">Search everything</label>
            <input ref={searchRef} id="gsearch" name="q" type="search" placeholder="Search cases, organisations, people  ( / )" style={{ maxWidth: 420 }} />
          </form>
          <FeedbackLauncher />
          <Link className="btn" href="/notifications" aria-label={`Notifications${notes.data?.unread ? `, ${notes.data.unread} unread` : ''}`}><Icon name="bell" />Alerts{notes.data?.unread ? <span className="badge-n">{notes.data.unread}</span> : null}</Link>
          <Link className="btn ghost" href="/profile" title={user.email}>{user.name}<span className="muted small hide-sm"> · {ROLE_LABEL[user.role]}</span></Link>
          <ThemeToggle className="btn icon" />
          <button className="btn" aria-label="Sign out" onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}><Icon name="logout" /><span className="hide-sm">Sign out</span></button>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <nav className="tabbar" aria-label="Quick navigation">
        {primary.map((i) => <Link key={i.href} href={i.href} aria-current={current(i.href) ? 'page' : undefined}><Icon name={i.icon} />{i.label.split(' ')[0]}</Link>)}
        <button type="button" onClick={() => setOpen(true)} aria-label="More navigation"><Icon name="menu" />More</button>
      </nav>
    </div>
  </ToastProvider>;
}
