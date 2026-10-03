import { Suspense } from 'react';
import { RegisterForm } from '@/components/AuthForms';
export const metadata = { title: 'Create account', description: 'Create a Business Doctor account to start a business health check for your business or organisation.' };
export default function Page() { return <><h1 style={{ marginBottom: 12 }}>Create your account</h1><Suspense><RegisterForm /></Suspense></>; }
