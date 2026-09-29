import { Suspense } from 'react';
import { ForgotForm } from '@/components/AuthForms';
export const metadata = { title: 'Reset password' };
export default function Page() { return <Suspense><ForgotForm /></Suspense>; }
