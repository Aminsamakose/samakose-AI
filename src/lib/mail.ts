import nodemailer from 'nodemailer';
import { env } from './env';

let transport: nodemailer.Transporter | null = null;
export const mailConfigured = () => !!env.smtpHost;

/** Sends one email. When SMTP is not configured the message is logged only, and the caller is told. */
export async function sendMail(to: string, subject: string, body: string): Promise<{ logOnly: boolean }> {
  if (!mailConfigured()) {
    console.log(`[mail:log-only] to=${to} subject="${subject}"`);
    return { logOnly: true };
  }
  transport ??= nodemailer.createTransport({
    host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined
  });
  await transport.sendMail({ from: env.mailFrom, to, subject, text: body });
  return { logOnly: false };
}
