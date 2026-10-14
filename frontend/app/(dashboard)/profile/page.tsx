import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/profile-editor';
import { requireProfile } from '@/lib/server-api';
export const metadata: Metadata = { title: 'Мой профиль' };
export default async function ProfilePage() {
  return <ProfileEditor initial={await requireProfile()} />;
}
