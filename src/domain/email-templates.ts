/** The system emails, their allowed {{variables}} and built-in wording. Pure, so the server and the editor share it. */
export type Template = { key: string; label: string; when: string; vars: { name: string; sample: string; note: string }[]; required: string[]; subject: string; body: string };

export const TEMPLATES: Template[] = [
  { key: 'verify_email', label: 'Confirm email address', when: 'Sent after someone registers, and when they ask for a new link.',
    vars: [{ name: 'user_name', sample: 'Ama Mensah', note: 'The person\'s name' }, { name: 'link', sample: 'https://example.org/verify-email?token=abc', note: 'The confirmation link' }, { name: 'hours', sample: '48', note: 'Hours the link stays valid' }],
    required: ['link'], subject: 'Confirm your email for Business Doctor',
    body: 'Hello {{user_name}},\n\nConfirm your email within {{hours}} hours:\n{{link}}\n\nIf you did not sign up, ignore this email.' },
  { key: 'invite', label: 'Invitation to join', when: 'Sent when an administrator invites someone.',
    vars: [{ name: 'user_name', sample: 'Kofi Boateng', note: 'The person\'s name' }, { name: 'link', sample: 'https://example.org/accept-invite?token=abc', note: 'The link to set a password' }],
    required: ['link'], subject: 'You have been invited to Business Doctor',
    body: 'Hello {{user_name}},\n\nYou have been invited to Business Doctor. Set your password within 7 days:\n{{link}}\n' },
  { key: 'team_invite', label: 'Invitation to answer part of an assessment', when: 'Sent when a business owner invites a colleague.',
    vars: [{ name: 'user_name', sample: 'Kofi Boateng', note: 'The colleague\'s name' }, { name: 'inviter_name', sample: 'Ama Mensah', note: 'The business owner' }, { name: 'business_name', sample: 'Mensah Foods', note: 'The business' }, { name: 'link', sample: 'https://example.org/accept-invite?token=abc', note: 'The link to activate the account' }],
    required: ['link'], subject: '{{inviter_name}} invited you to help with a business health check',
    body: 'Hello {{user_name}},\n\n{{inviter_name}} of {{business_name}} has asked you to help answer part of a business health check on the Business Doctor platform. Business Doctor is run by Samakose, a business support organisation based in Tamale, Northern Ghana. You will see only the questions assigned to you.\n\nActivate your account within 7 days:\n{{link}}\n\nIf the link does not open, copy it into your browser. When you activate, you will be asked to agree to how your answers are used.\n\nQuestions, or not expecting this? Reply to this email or call +233 (0) 55-858-9254.' },
  { key: 'registration_approved', label: 'Registration approved', when: 'Sent when an administrator approves a registration.',
    vars: [{ name: 'user_name', sample: 'Ama Mensah', note: 'The person\'s name' }, { name: 'link', sample: 'https://example.org/login', note: 'The sign-in link' }],
    required: ['link'], subject: 'Your Business Doctor registration is approved',
    body: 'Hello {{user_name}},\n\nYour registration is approved. Sign in here:\n{{link}}\n' },
  { key: 'password_reset', label: 'Password reset', when: 'Sent when someone asks to reset their password.',
    vars: [{ name: 'link', sample: 'https://example.org/reset-password?token=abc', note: 'The reset link' }],
    required: ['link'], subject: 'Reset your Business Doctor password',
    body: 'Use this link within one hour to choose a new password:\n{{link}}\n\nIf you did not ask for this, ignore this email.' }
];
export const TEMPLATE_BY_KEY = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]));

const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function render(text: string, vars: Record<string, string>): string {
  return text.replace(VAR, (_m, k: string) => vars[k] ?? '');
}
/** Problems with an edited template, written for the person editing it. */
export function templateProblems(t: Template, subject: string, body: string): Record<string, string> {
  const errs: Record<string, string> = {};
  const allowed = new Set(t.vars.map((v) => v.name));
  if (!subject.trim()) errs.subject = 'Write a subject'; else if (subject.length > 150) errs.subject = 'Keep the subject under 150 characters'; else if (/[\r\n]/.test(subject)) errs.subject = 'The subject must be one line';
  if (!body.trim()) errs.body = 'Write the message'; else if (body.length > 4000) errs.body = 'Keep the message under 4000 characters';
  const used = (s: string) => [...s.matchAll(VAR)].map((m) => m[1]);
  const unknown = [...new Set([...used(subject), ...used(body)].filter((v) => !allowed.has(v)))];
  if (unknown.length && !errs.body) errs.body = `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use only ${[...allowed].map((a) => `{{${a}}}`).join(', ')}.`;
  const miss = t.required.filter((r) => !used(body).includes(r));
  if (miss.length && !errs.body) errs.body = `The message must include ${miss.map((m) => `{{${m}}}`).join(', ')}, or the recipient cannot complete the step.`;
  if (/\{\{[^}]*$/.test(body) || /\{[^{]*\}\}/.test(body.replace(VAR, ''))) errs.body ??= 'A variable is not written correctly. Use the form {{name}}.';
  return errs;
}
