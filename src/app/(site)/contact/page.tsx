import type { Metadata } from 'next';
import { Mail, Phone, MapPin } from 'lucide-react';
import { PageHero, Section } from '@/components/site/ui';
import { Reveal } from '@/components/site/motion';
import { ContactForm } from '@/components/site/ContactForm';
import { SITE } from '@/components/site/config';

export const metadata: Metadata = { title: 'Contact', description: 'Talk to the Samakose team about a business health check, a programme tool, coaching or a partnership.' };

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Talk to the Samakose team." intro="Tell us about your business, cooperative or programme. We will reply by email and suggest the right next step." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.3fr_0.7fr]">
          <Reveal><ContactForm /></Reveal>
          <Reveal delay={0.1}>
            <div className="flex flex-col gap-6">
              <h2 className="font-display text-2xl font-bold">Reach us directly</h2>
              <ul className="flex flex-col gap-4 text-sm">
                <li className="flex items-start gap-3"><Mail className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><span><span className="block font-semibold">Email</span><a href={`mailto:${SITE.email}`}>{SITE.email}</a></span></li>
                <li className="flex items-start gap-3"><Phone className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><span><span className="block font-semibold">Phone</span><a href={`tel:${SITE.phoneHref}`}>{SITE.phone}</a></span></li>
                <li className="flex items-start gap-3"><MapPin className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><span><span className="block font-semibold">Office</span>{SITE.address.map((l) => <span key={l} className="block">{l}</span>)}</span></li>
              </ul>
              <p className="rounded-card bg-surface-2 p-4 text-sm text-muted">We use the details you send only to respond to you. You can ask us to delete them at any time.</p>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
