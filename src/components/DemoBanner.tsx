/**
 * Shown only when NEXT_PUBLIC_DEMO_MODE=1 (set on the demo deployment's environment variables only,
 * never on production). This is the one visible difference between the demo environment and the real
 * platform: everything else in the codebase is identical, so the demo behaves exactly like production
 * except for its own isolated database and mock (never real) payments.
 */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== '1') return null;
  return (
    <div role="note" style={{ position: 'sticky', top: 0, zIndex: 9999, textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, padding: '6px 12px', background: '#b45309', color: '#fff' }}>
      Demo environment — sample data only, no real payments or client records
    </div>
  );
}
