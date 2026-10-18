/**
 * Shared branded HTML shell for every outgoing email. Before this, `sendMail` sent plain
 * text only (see mail.ts), so the ~45 role-specific reminders raised across the app --
 * coaching sessions, overdue actions, prescriptions waiting for review, invoices, assignment
 * notices, and the rest (see src/domain/events.ts and src/services/sla.ts) -- all landed as
 * bare text, while the downloaded report PDF (src/services/report-export.ts) carried the real
 * Business Doctor brand: forest header band, logo mark, footer with contact details. This file
 * is the email equivalent of that PDF shell, built once and reused everywhere, so what the
 * audit called "every reminder" becomes brand-consistent without touching any of the ~45
 * call sites that already write the role-specific, context-specific title and body text --
 * their wording is untouched; only how it is presented changes.
 */

/** Brand palette, carried over exactly from report-export.ts's BRAND_COLOR (itself sourced
 *  from the app's own CSS tokens), so the emailed reminder, the downloaded report and the
 *  web app all read as the same brand rather than three different looks. */
const COLOR = { forest: '#0f4a3f', lime: '#c6f26b', ink: '#0c2622' };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Blank-line-separated blocks become paragraphs; a single line break inside a block stays a <br>.
 *  The source strings are already plain text written for a text email, so this is the one place
 *  that turns them into readable HTML rather than every call site doing it itself. */
function bodyToHtml(body: string): string {
  return body.trim().split(/\n{2,}/).filter(Boolean).map((block) =>
    `<p style="margin:0 0 14px;">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`
  ).join('');
}

/** Every notification email ends its text body with a line of the exact form "Open: <url>"
 *  (see notifyUsers in src/domain/notify.ts) -- that is the de facto call-to-action link already
 *  present on every one of the ~45 reminder types. Rather than asking 45 call sites to pass a
 *  separate structured link, this picks that one convention up and turns it into a real button,
 *  so every existing reminder gets a clear call to action for free. */
const OPEN_LINE = /\n?Open:\s*(\S+)\s*$/;

/** Wraps a subject (used as the on-page heading) and a plain-text body into the branded HTML
 *  email shell: forest header band with the logo mark and brand name, the message, a call-to-
 *  action button when the body ends with the "Open: <url>" convention, and a footer with
 *  contact details -- the layout a recipient on desktop or mobile mail should see for any
 *  Business Doctor email, matching the Assessment Report design template's identity. */
export function wrapEmailHtml(title: string, body: string): string {
  const m = body.match(OPEN_LINE);
  const mainBody = (m ? body.slice(0, m.index) : body).trim();
  const ctaUrl = m?.[1];
  const cta = ctaUrl ? `
            <tr><td style="padding:4px 32px 28px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${COLOR.forest};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:999px;">Open in Business Doctor</a>
            </td></tr>` : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
          <tr><td style="background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="background:${COLOR.forest};padding:20px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="${COLOR.lime}"/><polyline points="6,21 13,21 16,13 21,29 25,18 27,21 34,21" fill="none" stroke="${COLOR.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="color:#ffffff;font-size:17px;font-weight:bold;line-height:1.2;">Business Doctor</div>
                    <div style="color:#d8ebe4;font-size:11px;line-height:1.2;">by Samakose</div>
                  </td>
                </tr></table>
              </td></tr>
              <tr><td style="padding:28px 32px 4px;">
                <h1 style="margin:0 0 16px;font-size:19px;color:${COLOR.ink};font-family:Arial,Helvetica,sans-serif;">${escapeHtml(title)}</h1>
                <div style="font-size:14.5px;line-height:1.55;color:#2b3b37;font-family:Arial,Helvetica,sans-serif;">${bodyToHtml(mainBody)}</div>
              </td></tr>
              ${cta}
              <tr><td style="border-top:1px solid #e7ece9;padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#73807c;">
                info@samakose.com&nbsp;|&nbsp;+233&nbsp;(0)&nbsp;55-858-9254&nbsp;|&nbsp;www.samakose.com
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
