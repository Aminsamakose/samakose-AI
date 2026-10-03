import { Suspense } from 'react';
import { LoginForm } from '@/components/AuthForms';
export const metadata = { title: 'Sign in', description: 'Sign in to your Business Doctor account to continue your business health check.' };
export default function Page() { return <><h1 style={{ marginBottom: 12 }}>Sign in</h1><Suspense><LoginForm /></Suspense></>; }
