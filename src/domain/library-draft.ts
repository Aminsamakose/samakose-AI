/**
 * Resource Drafting Agent rules. Pure functions, no database. Drafts a Library resource's title,
 * summary and body from a topic brief - it never writes to library_resources itself; the Library
 * Editor must explicitly save the draft (and it still goes through the normal submit/approve
 * workflow before anyone outside staff can see it).
 */
export type DraftBrief = { topic: string; dimension?: string | null; audience?: string | null; notes?: string | null };
export type DraftReply = { title: string; summary: string; body: string; suggestedDimension: string | null };

export function validateDraft(o: any): string[] {
  const p: string[] = [];
  if (!o || typeof o.title !== 'string' || !o.title.trim()) p.push('title is required');
  if (!o || typeof o.summary !== 'string' || !o.summary.trim()) p.push('summary is required');
  if (!o || typeof o.body !== 'string' || !o.body.trim()) p.push('body is required');
  if (o?.title && o.title.length > 160) p.push('The title is too long');
  if (o?.summary && o.summary.length > 400) p.push('The summary is too long');
  if (o && o.suggestedDimension !== null && typeof o.suggestedDimension !== 'undefined' && typeof o.suggestedDimension !== 'string') p.push('suggestedDimension must be a string or null');
  return p;
}

/** The built-in model for tests and for when no live key is set: a plain, honest placeholder the editor must expand. */
export function mockDraft(b: DraftBrief): DraftReply {
  const title = b.topic.trim().replace(/\s+/g, ' ').replace(/^(.)/, (c) => c.toUpperCase());
  return {
    title,
    summary: `A practical guide on ${b.topic.toLowerCase()}${b.audience ? ` for ${b.audience}` : ''}.`,
    body: `# ${title}\n\nThis is a starting draft. Replace this paragraph with the guide's substance: what the reader should do, in order, with a short example.\n\n## Why this matters\n\n(Add the business case for an SME owner.)\n\n## Steps\n\n1. \n2. \n3. \n\n## Common mistakes\n\n- \n`,
    suggestedDimension: b.dimension ?? null
  };
}
