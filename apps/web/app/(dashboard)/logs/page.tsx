import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/server-api';
import { PageHeading } from '@/components/ui';
import { LogViewer } from '@/components/log-viewer';

export const metadata: Metadata = { title: 'Логи игроков' };
export default async function LogsPage() {
  const user = await requireProfile('/logs');
  if (user.role === 'player') redirect('/profile');
  return <><PageHeading title="Логи игроков" description="Действия аккаунтов: авторизации, изменения, подключения и модерация." /><LogViewer /></>;
}
