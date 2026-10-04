'use client';
import { useState } from 'react';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
/** One avatar for the whole product. Shows the profile photo when there is one, otherwise initials. Decorative when the name is printed beside it. */
export function Avatar({ name, src, size = 36, decorative = true }: { name: string; src?: string | null; size?: number; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" style={style} src={src} alt={decorative ? '' : name} width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className="avatar" style={style} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : name} aria-hidden={decorative ? true : undefined}>{initials(name)}</span>;
}

export const Person = ({ name, src, sub, size = 36 }: { name: string; src?: string | null; sub?: string; size?: number }) => (
  <span className="person"><Avatar name={name} src={src} size={size} /><span><strong>{name}</strong>{sub ? <span className="small muted" style={{ display: 'block' }}>{sub}</span> : null}</span></span>
);
