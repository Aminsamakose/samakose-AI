import { Suspense } from 'react';
import { ChangePasswordForm } from '@/components/AuthForms';
export const metadata = { title: 'Change password' };
export default function Page() { return <Suspense><ChangePasswordForm forced /></Suspense>; }
