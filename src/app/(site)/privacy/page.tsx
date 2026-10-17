import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/LegalPage';
import { getSite, contactOf } from '@/lib/site-content';

export const metadata: Metadata = { title: 'Privacy notice', description: 'How Samakose Accelerator Lab handles personal information collected through this website and platform.' };

const body = (SITE: { email: string; phone: string; address: string[] }) => `
## Who we are
Samakose Accelerator Lab is based at ${SITE.address.join(', ')}. You can reach us at ${SITE.email} or ${SITE.phone}. We are responsible for the personal information described in this notice.

## What we collect
**When you send us a message or sign up.** Your name, email address, organisation, phone number, the topic you are interested in, your message, and a record that you agreed to be contacted. We also store a one-way scrambled form of your connection address, which helps us spot spam without keeping the address itself.

**When you use the platform.** Account details, and the business information, answers, documents and notes that you or your advisers enter. Access to this information is limited by role, so that people see only what their role allows.

**When you take a free preliminary assessment.** The questions and your answers are processed in your browser and are not sent to our assessment service. We use your email address to check whether you have already completed that platform's free assessment; the assessment database does not save eligibility checks or unfinished attempts. When you complete the assessment, we store your name, email address, selected platform and the result shown to you so we can enforce the one-completion limit and provide the result and report actions. We do not store individual answers or assessment progress for this free assessment. If you ask us to email your result, our email provider processes the address and result to send that message.

Records from free assessments completed before this change may contain answers and other assessment details in the previous system. We are reviewing the retention and removal of those legacy records.

## Why we use it
We use the details you send us to reply to you. We use platform information to provide the health check, produce reports and support the programmes you take part in. We rely on your consent for website enquiries and on your agreement with us, or with the programme that supports you, for platform use.

## Who sees it
Our own staff and advisers, limited by role. We also use service providers to run the platform: web hosting, a database provider, and an email service. These providers process information on our behalf. Some of them operate outside Ghana, for example in Europe and the United States.

## Cookies
The platform uses cookies that are needed to keep you signed in and to protect your account. We do not use advertising trackers.

## How long we keep it
Retention periods are to be confirmed. We will keep personal information only as long as needed for the purposes above, and then delete or anonymise it.

## Your rights
Under Ghana's Data Protection Act, 2012 (Act 843), you can ask to see the personal information we hold about you, ask us to correct it, or ask us to delete it where the law allows. You may also withdraw consent for marketing contact at any time. To do so, write to ${SITE.email}. You can also complain to Ghana's Data Protection Commission.

## Changes
We will update this notice when our practices change and show the date at the top of the page.
`;

export default async function Page() { return <LegalPage title="Privacy notice" updated="17 October 2026" body={body(contactOf(await getSite()))} />; }
