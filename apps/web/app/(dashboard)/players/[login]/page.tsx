import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlayerActions } from '@/components/player-actions';
import { requireProfile, serverApi } from '@/lib/server-api';
import type { Profile } from '@/lib/types';

export const metadata: Metadata = { title: 'Действия игрока' };
export default async function PlayerPage({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const user = await requireProfile(`/players/${encodeURIComponent(login)}`);
  if (user.role === 'player') redirect('/profile');
  const player = await serverApi<Profile>(`/api/admin/players/${encodeURIComponent(login)}`);
  return <PlayerActions initial={player} />;
}
