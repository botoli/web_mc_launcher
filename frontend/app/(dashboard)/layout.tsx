import { Shell } from '@/components/shell';
import { requireProfile } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireProfile('/');
  return <Shell user={user}>{children}</Shell>;
}
