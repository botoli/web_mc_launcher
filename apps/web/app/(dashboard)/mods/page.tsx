import type { Metadata } from 'next';
import { ModsManager } from '@/components/mods-manager';
import { ConfigsManager } from '@/components/configs-manager';
import { PageHeading } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import type { DashboardData } from '@/lib/types';
export const metadata: Metadata = { title: 'Моди и конфиги' };
export default async function ModsPage() {
  const data = await serverApi<DashboardData>('/api/dashboard', '/mods');
  return <>
    <PageHeading title="Моди и конфиги" description="Управляй модами и настройками, которые получают игроки." />
    <div className="mods-configs-layout">
      <section className="mods-section" aria-labelledby="mods-title"><ModsManager initial={data.mods} /></section>
      <section className="configs-section" aria-labelledby="configs-title"><ConfigsManager initial={data.configs} /></section>
    </div>
  </>;
}
