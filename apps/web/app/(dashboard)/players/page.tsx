import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlayersManager } from '@/components/players-manager';
import { requireProfile, serverApi } from '@/lib/server-api';
import type { Profile } from '@/lib/types';
export const metadata: Metadata = { title: 'Игроки' };
export default async function PlayersPage() {
  const user = await requireProfile('/players');
  if (user.role !== 'admin') redirect('/profile');
  const players = await serverApi<Profile[]>('/api/admin/players', '/players');
  return <PlayersManager canManageRoles={user.canManageRoles} initialPlayers={players} initialNow={Date.now()} />;
}
