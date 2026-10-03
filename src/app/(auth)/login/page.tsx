import { Suspense } from 'react';
import { LoginForm } from '@/components/AuthForms';
export const metadata = { title: 'Sign in', description: 'Sign in to your Samakose account to continue your business health check.' };
export default function Page() { return <Suspense><LoginForm /></Suspense>; }
