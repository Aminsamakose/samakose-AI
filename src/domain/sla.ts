/**
 * Delivery service levels. Pure rules, no database.
 * The scheduler runs once a day, so a reminder window is wider than the reminder time: a session is reminded on the first run
 * that falls within `hours + SCAN_SLACK_HOURS` of it, which is never less than `hours` and at most `hours + 12`.
 */
export const SCAN_SLACK_HOURS = 12;
const H = 3_600_000, D = 86_400_000;

/** The reminder is due when the session starts within the window and has not started yet. */
export function reminderDue(scheduledAt: Date, now: Date, hours: number): boolean {
  const t = scheduledAt.getTime() - now.getTime();
  return t > 0 && t <= (hours + SCAN_SLACK_HOURS) * H;
}

/** A Scheduled session whose time passed `hours` ago and still has no recorded outcome. */
export function outcomeOverdue(scheduledAt: Date, now: Date, hours: number): boolean {
  return now.getTime() - scheduledAt.getTime() >= hours * H;
}

/** Nobody has acted on the case for `days` days. */
export function isStalled(lastActivity: Date, now: Date, days: number): boolean {
  return now.getTime() - lastActivity.getTime() >= days * D;
}

export const whole = (n: number) => Math.max(1, Math.round(n));
/** Plain wording for how long ago, for notices. */
export function ago(from: Date, now: Date): string {
  const d = Math.floor((now.getTime() - from.getTime()) / D);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}
