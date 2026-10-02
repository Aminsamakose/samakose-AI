/**
 * Exports validated diagnostic responses for one framework to a CSV the pilot analysis reads.
 *   npx tsx scripts/pilot/export-responses.ts SME360 pilot-sme360.csv [--version <n>]
 * One row per answered question. Case references are the platform case codes. Rater is a short hash of the submitting user, so the
 * file can be analysed without names. Outcomes (loan, repayment, growth) are collected separately: see docs/frameworks/pilot/README.md.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb, schema } from '@/db/client';

const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function main() {
  const [code, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const vi = process.argv.indexOf('--version'); const onlyVersion = vi > 0 ? Number(process.argv[vi + 1]) : null;
  if (!code || !out) { console.error('Usage: export-responses.ts <FRAMEWORK_CODE> <out.csv> [--version n]'); process.exit(1); }
  const d = db();
  const [fw] = await d.select().from(schema.frameworks).where(eq(schema.frameworks.code, code));
  if (!fw) throw new Error(`Unknown framework ${code}`);
  const versions = await d.select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, fw.id));
  const vs = versions.filter((v) => !onlyVersion || v.version === onlyVersion);
  if (!vs.length) throw new Error('No matching framework version');
  const diags = await d.select({ dg: schema.diagnostics, caseCode: schema.cases.code, orgType: schema.organisations.type })
    .from(schema.diagnostics).innerJoin(schema.cases, eq(schema.cases.id, schema.diagnostics.caseId)).innerJoin(schema.organisations, eq(schema.organisations.id, schema.cases.orgId))
    .where(and(eq(schema.diagnostics.status, 'Validated'), inArray(schema.diagnostics.frameworkVersionId, vs.map((v) => v.id))));
  const rows: string[] = ['case,org_type,diagnostic,version,rater,submitted_at,question_code,value,not_applicable,evidence_class'];
  for (const x of diags) {
    const rs = await d.select().from(schema.responses).where(eq(schema.responses.diagnosticId, x.dg.id));
    const ev = rs.length ? await d.select({ responseId: schema.evidence.responseId, cls: schema.evidence.class }).from(schema.evidence).where(and(eq(schema.evidence.caseId, x.dg.caseId), inArray(schema.evidence.responseId, rs.map((r) => r.id)))) : [];
    const cls = new Map(ev.map((e) => [e.responseId, e.cls]));
    const rater = x.dg.submittedBy ? 'R' + crypto.createHash('sha256').update(x.dg.submittedBy).digest('hex').slice(0, 6) : 'R000000';
    for (const r of rs) rows.push([x.caseCode, x.orgType, x.dg.code, x.dg.version, rater, x.dg.createdAt.toISOString(), r.questionCode, r.value, r.notApplicable ? 1 : 0, cls.get(r.id) ?? r.evidenceClass].map(esc).join(','));
  }
  fs.writeFileSync(out, rows.join('\n') + '\n');
  console.log(`${code}: ${diags.length} diagnostics, ${rows.length - 1} responses -> ${out}`);
  await closeDb();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
