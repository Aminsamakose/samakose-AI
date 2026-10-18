import { describe, expect, it } from 'vitest';
import { wrapEmailHtml } from '@/lib/email-layout';

describe('branded HTML email shell', () => {
  it('wraps the title and body and renders the Business Doctor brand', () => {
    const html = wrapEmailHtml('Coaching session coming up for CASE-042', 'Scheduled for 18 Oct, 10:00 GMT.\n\nOpen: https://app.samakose.com/cases/42?tab=coaching');
    expect(html).toContain('Business Doctor');
    expect(html).toContain('by Samakose');
    expect(html).toContain('Coaching session coming up for CASE-042');
    expect(html).toContain('Scheduled for 18 Oct, 10:00 GMT.');
    expect(html).toContain('info@samakose.com');
  });

  it('turns the trailing "Open: <url>" convention into a real button, not body text', () => {
    const html = wrapEmailHtml('Prescription waiting for your review', 'Approve it, or return it with a reason.\n\nOpen: https://app.samakose.com/cases/7');
    expect(html).toContain('href="https://app.samakose.com/cases/7"');
    expect(html).toContain('Open in Business Doctor');
    expect(html).not.toContain('Open: https://app.samakose.com/cases/7');
  });

  it('escapes HTML in subject and body so a stray "<" or "&" cannot break the markup', () => {
    const html = wrapEmailHtml('A & B <script>', 'x < y && y > z');
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).toContain('x &lt; y &amp;&amp; y &gt; z');
    expect(html).not.toContain('<script>');
  });

  it('renders a plain body with no link and no crash when there is nothing to open', () => {
    const html = wrapEmailHtml('Payment received', 'INV-9 paid, GHS 500.');
    expect(html).toContain('INV-9 paid, GHS 500.');
    expect(html).not.toContain('Open in Business Doctor');
  });
});
