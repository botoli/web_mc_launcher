import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
export const metadata: Metadata = { title: 'Регистрация' };
export default function RegisterPage() {
  return <Suspense fallback={<p>Загрузка…</p>}><AuthForm register /></Suspense>;
}
