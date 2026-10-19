import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/profile-editor';
import { publicClientInfo, requireProfile } from '@/lib/server-api';
export const metadata: Metadata = { title: 'Мой профиль' };
export default async function ProfilePage() {
  const [profile, client] = await Promise.all([requireProfile(), publicClientInfo()]);
  return <ProfileEditor initial={profile} client={client} />;
}
