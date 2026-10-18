import nodemailer from 'nodemailer';
import { env } from './env';

let transport: nodemailer.Transporter | null = null;
export const mailConfigured = () => !!env.smtpHost;

/** Sends one email. When SMTP is not configured the message is logged only, and the caller is told.
 *  An optional attachment (e.g. the same A4 PDF the "download" action serves) rides alongside the
 *  plain-text body rather than replacing it, so the email still reads on its own if the attachment
 *  is stripped or blocked by the recipient's mail provider. */
export async function sendMail(to: string, subject: string, body: string, attachments?: { filename: string; content: Uint8Array; contentType: string }[]): Promise<{ logOnly: boolean }> {
  if (!mailConfigured()) {
    console.log(`[mail:log-only] to=${to} subject="${subject}"${attachments?.length ? ` attachments=${attachments.map((a) => a.filename).join(',')}` : ''}`);
    return { logOnly: true };
  }
  transport ??= nodemailer.createTransport({
    host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined
  });
  await transport.sendMail({ from: env.mailFrom, to, subject, text: body, attachments: attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
  return { logOnly: false };
}
