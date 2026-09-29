import { Suspense } from 'react';
import { MfaSetupForm } from '@/components/AuthForms';
export const metadata = { title: 'Set up two-step' };
export default function Page() { return <Suspense><MfaSetupForm /></Suspense>; }
