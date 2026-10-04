import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/LegalPage';
import { getSite, contactOf } from '@/lib/site-content';

export const metadata: Metadata = { title: 'Terms of use', description: 'The terms that apply to using the Business Doctor website and platform, operated by Samakose Accelerator Lab.' };

const body = (SITE: { email: string; phone: string; address: string[] }) => `
## About these terms
These terms apply to your use of the Business Doctor website and platform, operated by Samakose Accelerator Lab. By using them you agree to these terms. If you use the platform through a programme or an organisation, the agreement you have with that programme or organisation also applies.

## Using the website
You may read and share the public pages of this website for lawful purposes. Please do not misuse the site, attempt to break into it, send spam through it, or use automated tools to collect its content in bulk.

## Accounts
You are responsible for keeping your password and any two-step verification codes safe, and for what happens under your account. Tell us promptly if you think someone else has used it. Access to information on the platform depends on your role, and creating an account does not by itself give you access to another organisation's or programme's information.

## Your information
You are responsible for the accuracy of the information you enter and for having the right to share it. Our Privacy notice explains how we handle personal information.

## What the platform provides
Health scores, diagnoses and prescriptions are decision-support tools. They are based on the information provided and are reviewed by people, but they are not a substitute for professional financial, legal or tax advice, and they do not guarantee any business result.

## Plans and payment
Prices, plans and payment terms will be set out when you choose a plan. Online payments are processed by a third-party payment provider.

## Availability and liability
We aim to keep the platform available but cannot promise it will always be uninterrupted or error-free. To the extent the law allows, we are not liable for indirect or consequential loss arising from use of the website or platform.

## Changes and contact
We may update these terms and will show the date at the top of the page. Questions can be sent to ${SITE.email}.
`;

export default async function Page() { return <LegalPage title="Terms of use" updated="1 October 2026" body={body(contactOf(await getSite()))} />; }
