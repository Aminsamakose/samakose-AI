'use client';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Mode = 'system' | 'light' | 'dark';
const NEXT: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Mode, string> = { system: 'Match my device', light: 'Light', dark: 'Dark' };

export function applyTheme(m: Mode) {
  try {
    if (m === 'system') { localStorage.removeItem('sk-theme'); document.documentElement.removeAttribute('data-theme'); }
    else { localStorage.setItem('sk-theme', m); document.documentElement.setAttribute('data-theme', m); }
  } catch { /* storage can be blocked; the choice then lasts for this page only */ }
}

/** One theme control for the public site, the sign-in pages and the portal. Cycles match device, light, dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => { try { const t = localStorage.getItem('sk-theme'); if (t === 'light' || t === 'dark') setMode(t); } catch { /* ignore */ } }, []);
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  return (
    <button type="button" className={className ?? 'theme-btn'} aria-label={`Theme: ${LABEL[mode]}. Press to change.`} title={`Theme: ${LABEL[mode]}`}
      onClick={() => { const n = NEXT[mode]; setMode(n); applyTheme(n); }}>
      <Icon className="theme-ic" width={18} height={18} aria-hidden="true" />
    </button>
  );
}
