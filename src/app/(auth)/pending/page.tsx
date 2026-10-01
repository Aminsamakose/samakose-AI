import { Suspense } from 'react';
import { PendingNotice } from '@/components/AuthForms';
export const metadata = { title: 'Waiting for approval' };
export default function Page() { return <Suspense><PendingNotice /></Suspense>; }
