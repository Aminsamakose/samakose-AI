/**
 * What can be edited on the public website, and the rules each piece must follow.
 * Pure data and checks, so the server (to validate) and the admin screens (to draw forms) share one definition.
 */
export type FieldType = 'text' | 'textarea' | 'url' | 'email' | 'bool' | 'select' | 'date' | 'markdown' | 'colour';
export type Field = {
  key: string; label: string; type: FieldType; max?: number; required?: boolean; hint?: string;
  options?: { value: string; label: string }[];
};
export type Group = 'content' | 'site_settings';
export type Kind = {
  id: string; label: string; plural: string; group: Group; singleton: boolean; blurb: string;
  fields: Field[];
  /** Which field gives a collection item its display title. */
  titleField?: string;
  /** Fields that must be true before the item can go live: evidence and consent, never assumed. */
  gates?: { key: string; message: string }[];
  defaults: Record<string, unknown>;
};

export const HOME_SECTIONS = [
  { id: 'partners', label: 'Partners and clients' },
  { id: 'platform', label: 'The platform (three products)' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'impact', label: 'Impact, results and testimonials' },
  { id: 'faq', label: 'Frequently asked questions' },
  { id: 'resources', label: 'Resources and insights' },
  { id: 'contact', label: 'Contact and final call to action' }
] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number]['id'];
export type HomeSection = { id: HomeSectionId; enabled: boolean };
export const DEFAULT_SECTIONS: HomeSection[] = HOME_SECTIONS.map((s) => ({ id: s.id, enabled: true }));

const url = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'url', max: 300, hint });

const isUrl = (v: string) => /^https:\/\/[^\s]+\.[^\s]+$/i.test(v) || /^\/[a-z0-9\-/_#?=&.]*$/i.test(v);
export const DEFAULT_MENU = ['Platform | /platform', 'Solutions | /solutions', 'Impact | /impact', 'Resources | /resources', 'Pricing | /pricing', 'About | /about', 'Contact | /contact'].join('\n');

/** Reads the menu text into links. Returns the links and any problem found, so the editor can say exactly what is wrong. */
export function parseMenu(text: string): { items: { label: string; href: string }[]; error?: string } {
  const items: { label: string; href: string }[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 10) return { items, error: 'Use at most 10 links' };
  for (const [i, l] of lines.entries()) {
    const [label, href, ...rest] = l.split('|').map((x) => x.trim());
    if (!label || !href || rest.length) return { items, error: `Line ${i + 1}: write it as Label | /page` };
    if (label.length > 30) return { items, error: `Line ${i + 1}: keep the label under 30 characters` };
    if (!isUrl(href)) return { items, error: `Line ${i + 1}: the address must be a page such as /pricing or a full https:// address` };
    items.push({ label, href });
  }
  return { items };
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export const KINDS: Kind[] = [
  {
    id: 'brand', label: 'Brand and identity', plural: 'Brand and identity', group: 'site_settings', singleton: true,
    blurb: 'The names and wording that appear in the browser tab, header and footer.',
    fields: [
      { key: 'siteName', label: 'Site name', type: 'text', max: 60, required: true },
      { key: 'tagline', label: 'Tagline', type: 'text', max: 100, hint: 'Shown beside the logo.' },
      { key: 'browserTitle', label: 'Browser title (home page)', type: 'text', max: 70, required: true },
      { key: 'footerBlurb', label: 'Footer description', type: 'textarea', max: 240 },
      { key: 'primaryColour', label: 'Main brand colour (light theme)', type: 'colour', hint: 'Used for buttons, headers and the footer. White text sits on it, so it must be dark enough to read: contrast of at least 4.5 to 1. Leave empty for the standard green.' }
    ],
    defaults: { siteName: 'Samakose', tagline: 'The Business Doctor', primaryColour: '', browserTitle: 'Samakose | The Business Doctor', footerBlurb: 'Diagnose, prescribe and track the health of enterprises across Africa. Built in Tamale, Northern Ghana.' }
  },
  {
    id: 'navigation', label: 'Menu', plural: 'Menu and navigation', group: 'site_settings', singleton: true,
    blurb: 'The links in the website header and footer, in order. The Sign in and Start buttons are always shown.',
    fields: [{ key: 'menu', label: 'Menu links (one per line)', type: 'textarea', max: 600, required: true, hint: 'Write each as Label | /page, for example Pricing | /pricing. Up to 10 links. Use a full https:// address for another website.' }],
    defaults: { menu: DEFAULT_MENU }
  },
  {
    id: 'contact', label: 'Contact details', plural: 'Contact details', group: 'site_settings', singleton: true,
    blurb: 'Shown in the footer, the contact page and the home page.',
    fields: [
      { key: 'email', label: 'Public email', type: 'email', max: 120, required: true },
      { key: 'phone', label: 'Phone (as displayed)', type: 'text', max: 40, required: true, hint: 'For example +233 (0) 55-858-9254. The dialling link is built from the digits.' },
      { key: 'address', label: 'Address (one line per row)', type: 'textarea', max: 300 },
      { key: 'hours', label: 'Opening hours', type: 'text', max: 120 }
    ],
    defaults: { email: 'info@samakose.com', phone: '+233 (0) 55-858-9254', address: 'Jisonaayili Road, Ayana Junction\nNS-123-6647, Tamale\nNorthern Region, Ghana', hours: '' }
  },
  {
    id: 'social', label: 'Social media links', plural: 'Social media links', group: 'site_settings', singleton: true,
    blurb: 'Leave a link empty to hide it. Only complete https:// addresses are accepted.',
    fields: [url('facebook', 'Facebook'), url('linkedin', 'LinkedIn'), url('x', 'X (Twitter)'), url('instagram', 'Instagram'), url('youtube', 'YouTube'), url('whatsapp', 'WhatsApp link')],
    defaults: { facebook: '', linkedin: '', x: '', instagram: '', youtube: '', whatsapp: '' }
  },
  {
    id: 'announcement', label: 'Announcement bar', plural: 'Announcement bar', group: 'site_settings', singleton: true,
    blurb: 'A short notice across the top of every public page. Switch it off when it is no longer needed.',
    fields: [
      { key: 'enabled', label: 'Show the bar', type: 'bool' },
      { key: 'text', label: 'Message', type: 'text', max: 160 },
      { key: 'linkLabel', label: 'Link label', type: 'text', max: 40 },
      url('linkHref', 'Link address', 'A full https:// address or a page on this site such as /pricing.')
    ],
    defaults: { enabled: false, text: '', linkLabel: '', linkHref: '' }
  },
  {
    id: 'seo', label: 'Search and sharing', plural: 'Search and sharing', group: 'site_settings', singleton: true,
    blurb: 'How the site appears in search results and when a link is shared.',
    fields: [
      { key: 'description', label: 'Default description', type: 'textarea', max: 200, required: true, hint: 'About 150 characters works best in search results.' },
      { key: 'indexing', label: 'Let search engines index the site', type: 'bool' },
      url('shareImage', 'Default sharing image address', 'A full https:// address of an image about 1200 by 630 pixels.')
    ],
    defaults: { description: 'Diagnose the health of your business, get a prescription, and track the change. Business health assessment and coaching for SMEs, agribusinesses and support organisations in Africa.', indexing: true, shareImage: '' }
  },
  {
    id: 'home', label: 'Home page', plural: 'Home page', group: 'site_settings', singleton: true,
    blurb: 'The opening headline and call to action. Section order and visibility are set below.',
    fields: [
      { key: 'heroHeadline', label: 'Headline', type: 'text', max: 90, required: true },
      { key: 'heroText', label: 'Introduction', type: 'textarea', max: 300, required: true },
      { key: 'primaryCta', label: 'Main button label', type: 'text', max: 40, required: true },
      { key: 'impactNote', label: 'Impact section note', type: 'textarea', max: 240, hint: 'Shown above the verified results.' }
    ],
    defaults: {
      heroHeadline: 'Know what is holding your business back.',
      heroText: 'Samakose reads the health of SMEs, agribusinesses and the organisations that support them, prescribes the next intervention, tracks it and coaches it to completion.',
      primaryCta: 'Start your health check',
      impactNote: 'Samakose will publish outcomes here once they are documented and cleared with the organisations concerned.',
      sections: DEFAULT_SECTIONS
    }
  },
  {
    id: 'faq', label: 'Question', plural: 'FAQs', group: 'content', singleton: false, titleField: 'question',
    blurb: 'Plain answers to questions visitors ask most.',
    fields: [
      { key: 'question', label: 'Question', type: 'text', max: 160, required: true },
      { key: 'answer', label: 'Answer', type: 'textarea', max: 1200, required: true }
    ],
    defaults: { question: '', answer: '' }
  },
  {
    id: 'testimonial', label: 'Testimonial', plural: 'Testimonials', group: 'content', singleton: false, titleField: 'name',
    blurb: 'Quotes from clients. A testimonial goes live only when the quote is confirmed as accurate and the person has agreed to its use.',
    fields: [
      { key: 'quote', label: 'Quote', type: 'textarea', max: 500, required: true },
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true },
      { key: 'role', label: 'Role', type: 'text', max: 80 },
      { key: 'organisation', label: 'Organisation', type: 'text', max: 100 },
      { key: 'verified', label: 'The quote has been checked with the speaker', type: 'bool' },
      { key: 'consent', label: 'The person has agreed to publication', type: 'bool' }
    ],
    gates: [{ key: 'verified', message: 'Confirm the quote has been checked with the speaker' }, { key: 'consent', message: 'Confirm the person has agreed to publication' }],
    defaults: { quote: '', name: '', role: '', organisation: '', verified: false, consent: false }
  },
  {
    id: 'partner', label: 'Partner', plural: 'Partners and clients', group: 'content', singleton: false, titleField: 'name',
    blurb: 'Organisations shown on the home page. Each needs written permission before it appears.',
    fields: [
      { key: 'name', label: 'Organisation name', type: 'text', max: 100, required: true },
      url('website', 'Website'),
      { key: 'note', label: 'What they do with Samakose', type: 'text', max: 140 },
      { key: 'permission', label: 'Written permission to show this organisation is on file', type: 'bool' }
    ],
    gates: [{ key: 'permission', message: 'Confirm written permission is on file' }],
    defaults: { name: '', website: '', note: '', permission: false }
  },
  {
    id: 'stat', label: 'Result', plural: 'Impact results', group: 'content', singleton: false, titleField: 'label',
    blurb: 'Headline numbers. Each must be backed by a source and marked verified before it is shown.',
    fields: [
      { key: 'value', label: 'Figure', type: 'text', max: 24, required: true, hint: 'For example 120 or 38%.' },
      { key: 'label', label: 'What it measures', type: 'text', max: 100, required: true },
      { key: 'source', label: 'Source and period', type: 'text', max: 160, required: true, hint: 'Where the figure comes from and the dates it covers.' },
      { key: 'verified', label: 'This figure has been checked against the source records', type: 'bool' }
    ],
    gates: [{ key: 'verified', message: 'Confirm the figure has been checked against the source records' }],
    defaults: { value: '', label: '', source: '', verified: false }
  },
  {
    id: 'article', label: 'Article', plural: 'Articles', group: 'content', singleton: false, titleField: 'title',
    blurb: 'Guides and insights for the Resources page.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', max: 120, required: true },
      { key: 'slug', label: 'Web address ending', type: 'text', max: 80, required: true, hint: 'Lower-case words joined by hyphens, for example what-is-a-health-check.' },
      { key: 'summary', label: 'Summary', type: 'textarea', max: 300, required: true },
      { key: 'author', label: 'Author', type: 'text', max: 80, required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'body', label: 'Article text (Markdown)', type: 'markdown', max: 30000, required: true }
    ],
    defaults: { title: '', slug: '', summary: '', author: 'Samakose', date: '', body: '' }
  }
];

export const KIND_BY_ID: Record<string, Kind> = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const SECTION_IDS = new Set<string>(HOME_SECTIONS.map((s) => s.id));


/** Checks and cleans one document's data against its kind. Returns the clean data or per-field messages. */
export function validateData(kind: Kind, input: unknown, opts: { forPublish?: boolean } = {}): { ok: true; data: Record<string, unknown> } | { ok: false; fields: Record<string, string> } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errs: Record<string, string> = {};
  for (const f of kind.fields) {
    const raw = src[f.key];
    if (f.type === 'bool') { out[f.key] = raw === true; continue; }
    const v = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
    if (f.max && v.length > f.max) { errs[f.key] = `Keep this under ${f.max} characters`; continue; }
    if (!v) { if (f.required && opts.forPublish) errs[f.key] = 'This is required before publishing'; out[f.key] = ''; continue; }
    if (f.type === 'url' && !isUrl(v)) errs[f.key] = 'Enter a full https:// address' + (f.key === 'linkHref' ? ' or a page such as /pricing' : '');
    else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs[f.key] = 'Enter a valid email address';
    else if (f.type === 'colour') { if (!/^#[0-9a-fA-F]{6}$/.test(v)) errs[f.key] = 'Use a six-digit colour such as #0f4a3f'; else if (contrastRatio(v, '#ffffff') < 4.5) errs[f.key] = `White text would be hard to read on this colour (contrast ${contrastRatio(v, '#ffffff').toFixed(1)} to 1). Choose a darker shade, at least 4.5 to 1.`; else out[f.key] = v.toLowerCase(); continue; }
    else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs[f.key] = 'Use the format YYYY-MM-DD';
    else if (f.key === 'slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) errs[f.key] = 'Use lower-case words joined by hyphens';
    out[f.key] = v;
  }
  if (kind.id === 'home') {
    const arr = Array.isArray(src.sections) ? (src.sections as any[]) : DEFAULT_SECTIONS;
    const seen = new Set<string>(); const secs: HomeSection[] = [];
    for (const s of arr) { if (s && SECTION_IDS.has(s.id) && !seen.has(s.id)) { seen.add(s.id); secs.push({ id: s.id, enabled: s.enabled === true }); } }
    for (const d of DEFAULT_SECTIONS) if (!seen.has(d.id)) secs.push({ ...d });
    out.sections = secs;
  }
  if (kind.id === 'navigation' && out.menu) { const m = parseMenu(String(out.menu)); if (m.error) errs.menu = m.error; }
  if (kind.id === 'announcement' && out.enabled === true && opts.forPublish && !out.text) errs.text = 'Write the message before showing the bar';
  if (kind.id === 'announcement' && out.linkHref && !out.linkLabel) errs.linkLabel = 'Add a label for the link';
  if (opts.forPublish) for (const g of kind.gates ?? []) if (out[g.key] !== true) errs[g.key] = g.message;
  return Object.keys(errs).length ? { ok: false, fields: errs } : { ok: true, data: out };
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
export const phoneHref = (p: string) => p.replace(/[^\d+]/g, '');
