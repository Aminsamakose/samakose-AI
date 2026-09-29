import { LayoutDashboard, Briefcase, Building2, ClipboardCheck, ListChecks, MessagesSquare, FileBarChart, Layers, Receipt, CreditCard, FileSignature, Package, Users, ScrollText, Settings, Server, Bell, Search, Menu, Sun, Moon, MonitorSmartphone, LogOut, Check, Clock, AlertTriangle, XCircle, Info, Circle, Inbox, Store, type LucideIcon } from 'lucide-react';

export const ICONS = { dashboard: LayoutDashboard, cases: Briefcase, business: Store, reviews: ClipboardCheck, actions: ListChecks, sessions: MessagesSquare, reports: FileBarChart, organisations: Building2, programmes: Layers, invoices: Receipt, payments: CreditCard, contracts: FileSignature, plans: Package, users: Users, audit: ScrollText, settings: Settings, system: Server, bell: Bell, search: Search, menu: Menu, sun: Sun, moon: Moon, system_theme: MonitorSmartphone, logout: LogOut, ok: Check, pending: Clock, warn: AlertTriangle, bad: XCircle, info: Info, neutral: Circle, inbox: Inbox } satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

/** Decorative by default (aria-hidden); the visible text label carries the meaning. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const C = ICONS[name];
  return <C className={`ic ${className ?? ''}`} aria-hidden="true" focusable="false" />;
}
