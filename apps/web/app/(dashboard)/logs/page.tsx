import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireProfile, serverApi } from '@/lib/server-api';
import { logQuery, parseLogFilters } from '@/lib/log-filters';
import type { EventsPage } from '@/lib/types';
import { PageHeading } from '@/components/ui';
import { LogViewer } from '@/components/log-viewer';

export const metadata: Metadata = { title: 'Логи игроков' };
export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireProfile('/logs');
  if (user.role === 'player') redirect('/profile');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  const filters = parseLogFilters(params);
  const data = await serverApi<EventsPage>(`/api/admin/logs?${logQuery(filters)}`, '/logs');
  return <><PageHeading title="Логи игроков" description="Действия аккаунтов: авторизации, изменения, подключения и модерация." /><LogViewer initialData={data} initialFilters={{ ...filters, page: data.page }} /></>;
}
