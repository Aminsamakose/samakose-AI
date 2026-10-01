import Link from 'next/link';

/** A short notice above the header. Shown only when an administrator has switched it on and written a message. */
export function AnnouncementBar({ a }: { a: Record<string, any> }) {
  if (a.enabled !== true || !a.text) return null;
  const href = String(a.linkHref ?? '');
  const external = /^https:\/\//i.test(href);
  return (
    <div role="region" aria-label="Announcement" className="bg-forest px-4 py-2 text-center text-sm text-white">
      <span>{a.text}</span>
      {href && a.linkLabel && (external
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-lime underline underline-offset-2">{a.linkLabel}</a>
        : <Link href={href} className="ml-2 font-semibold text-lime underline underline-offset-2">{a.linkLabel}</Link>)}
    </div>
  );
}
