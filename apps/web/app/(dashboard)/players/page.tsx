import type { Metadata } from 'next';
import { PlayersManager } from '@/components/players-manager';
import { requireProfile, serverApi } from '@/lib/server-api';
import type { Profile } from '@/lib/types';
export const metadata: Metadata = { title: 'Игроки' };
export default async function PlayersPage() {
  const user = await requireProfile('/players');
  const players = await serverApi<Profile[]>('/api/admin/players', '/players');
  return <PlayersManager initial={players} canManageRoles={user.canManageRoles} />;
}
