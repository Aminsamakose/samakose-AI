import { Suspense } from 'react';
import { RegisterForm } from '@/components/AuthForms';
export const metadata = { title: 'Create account', description: 'Create a Samakose account to start a business health check for your business or organisation.' };
export default function Page() { return <Suspense><RegisterForm /></Suspense>; }
