import nodemailer from 'nodemailer';
import { env } from './env';
import { wrapEmailHtml } from './email-layout';

let transport: nodemailer.Transporter | null = null;
export const mailConfigured = () => !!env.smtpHost;

/** Sends one email. When SMTP is not configured the message is logged only, and the caller is told.
 *  An optional attachment (e.g. the same A4 PDF the "download" action serves) rides alongside the
 *  plain-text body rather than replacing it, so the email still reads on its own if the attachment
 *  is stripped or blocked by the recipient's mail provider.
 *
 *  Every caller still writes a plain-text subject/body -- that has not changed, and neither has any
 *  trigger, recipient rule, or variable. What changed is here, in one place: unless a caller supplies
 *  its own `html` (none currently do), this wraps that same text in the shared Business Doctor branded
 *  shell (see email-layout.ts) before sending, so every email the app sends -- the ~45 role-specific
 *  reminders raised through notifyUsers, the five admin-editable account templates, the free-assessment
 *  result, the enquiry notice -- reads as one consistent, mobile-readable, on-brand message instead of
 *  bare text, with no change to what triggers it, who receives it, or what it says. */
export async function sendMail(to: string, subject: string, body: string, attachments?: { filename: string; content: Uint8Array; contentType: string }[], html?: string): Promise<{ logOnly: boolean }> {
  const finalHtml = html ?? wrapEmailHtml(subject, body);
  if (!mailConfigured()) {
    console.log(`[mail:log-only] to=${to} subject="${subject}"${attachments?.length ? ` attachments=${attachments.map((a) => a.filename).join(',')}` : ''}`);
    return { logOnly: true };
  }
  transport ??= nodemailer.createTransport({
    host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined
  });
  await transport.sendMail({ from: env.mailFrom, to, subject, text: body, html: finalHtml, attachments: attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
  return { logOnly: false };
}
