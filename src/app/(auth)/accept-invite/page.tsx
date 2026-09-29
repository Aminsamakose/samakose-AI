import { Suspense } from 'react';
import { TokenPasswordForm } from '@/components/AuthForms';
export const metadata = { title: 'Accept invitation' };
export default function Page() { return <Suspense><TokenPasswordForm mode="accept" /></Suspense>; }
