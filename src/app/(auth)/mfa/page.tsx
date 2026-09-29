import { Suspense } from 'react';
import { MfaForm } from '@/components/AuthForms';
export const metadata = { title: 'Verify' };
export default function Page() { return <Suspense><MfaForm /></Suspense>; }
