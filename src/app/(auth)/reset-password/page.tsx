import { Suspense } from 'react';
import { TokenPasswordForm } from '@/components/AuthForms';
export const metadata = { title: 'New password' };
export default function Page() { return <Suspense><TokenPasswordForm mode="reset" /></Suspense>; }
