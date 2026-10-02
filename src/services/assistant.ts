/** The public Enquiry Assistant. Runs through the AI gateway like every other agent, so it can be paused, limited and audited. */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { AgentBlocked, runAgent } from './ai';
import { switchOn } from './switches';
import { HANDOFF, mockAssistant, validateReply, type AssistantReply, type Passage } from '@/domain/assistant';

export const ASSISTANT_SWITCH = 'switch.assistant';
export const assistantOn = () => switchOn(db(), ASSISTANT_SWITCH);

/** Published FAQs and articles only. Drafts and anything not live are never read. */
export async function publishedPassages(): Promise<Passage[]> {
  const rows = await db().select().from(schema.contentDocs).where(and(inArray(schema.contentDocs.kind, ['faq', 'article']), inArray(schema.contentDocs.status, ['Published', 'Scheduled']), isNotNull(schema.contentDocs.live)));
  const out: Passage[] = [];
  for (const r of rows) {
    const d = (r.live ?? {}) as Record<string, string>;
    if (r.kind === 'faq' && d.question && d.answer) out.push({ title: d.question, text: d.answer, href: '/#faq' });
    if (r.kind === 'article' && d.title) out.push({ title: d.title, text: `${d.summary ?? ''} ${String(d.body ?? '').slice(0, 800)}`.trim(), href: `/resources` });
  }
  return out;
}

export type Turn = { role: 'user' | 'assistant'; text: string };

export async function ask(question: string, history: Turn[]): Promise<AssistantReply & { blocked?: boolean }> {
  const passages = await publishedPassages();
  const { rank } = await import('@/domain/assistant');
  // Only the best matching passages go to the model, so a visitor's question can never pull in anything else.
  const picked = rank([...history.filter((h) => h.role === 'user').slice(-2).map((h) => h.text), question].join(' '), passages, 4);
  try {
    const r = await runAgent<AssistantReply>({
      agent: 'enquiry', caseId: null, requestedBy: null,
      context: { question, earlier: history.slice(-4), passages: picked.map((p) => ({ title: p.title, text: p.text })) },
      validate: validateReply, mock: () => mockAssistant(question, picked)
    });
    const o = r.output;
    // Nothing matched at all: a person answers, whatever the model said.
    if (!picked.length) return { reply: HANDOFF, handoff: true, sources: [] };
    return { reply: o.reply.trim(), handoff: o.handoff, sources: (o.sources ?? []).filter((s) => picked.some((p) => p.title === s)).slice(0, 3) };
  } catch (e) {
    if (e instanceof AgentBlocked) return { reply: 'The assistant is not available right now. Please send your question to our team and a person will reply.', handoff: true, sources: [], blocked: true };
    return { reply: HANDOFF, handoff: true, sources: [] };
  }
}
