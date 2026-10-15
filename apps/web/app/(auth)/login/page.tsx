import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
export const metadata: Metadata = { title: 'Вход' };
export default function LoginPage() {
  return <Suspense fallback={<p>Загрузка…</p>}><AuthForm /></Suspense>;
}
