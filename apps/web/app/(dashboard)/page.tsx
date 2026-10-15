import type { Metadata } from 'next';
import { BuildDashboard } from '@/components/build-dashboard';
import { serverApi } from '@/lib/server-api';
import type { ClientInfo, DashboardData } from '@/lib/types';

export const metadata: Metadata = { title: 'Сборка' };
export default async function BuildPage() {
  const [data, client] = await Promise.all([
    serverApi<DashboardData>('/api/dashboard'), serverApi<ClientInfo>('/api/client-info'),
  ]);
  return <BuildDashboard initial={data} client={client} />;
}
