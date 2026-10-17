import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlayersManager } from '@/components/players-manager';
import { requireProfile } from '@/lib/server-api';
export const metadata: Metadata = { title: 'Игроки' };
export default async function PlayersPage() {
  const user = await requireProfile('/players');
  if (user.role !== 'admin') redirect('/profile');
  return <PlayersManager canManageRoles={user.canManageRoles} />;
}
