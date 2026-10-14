import type { Metadata } from 'next';
import { ModsManager } from '@/components/mods-manager';
import { serverApi } from '@/lib/server-api';
import type { DashboardData } from '@/lib/types';
export const metadata: Metadata = { title: 'Моды' };
export default async function ModsPage() {
  const data = await serverApi<DashboardData>('/api/dashboard', '/mods');
  return <ModsManager initial={data.mods} />;
}
