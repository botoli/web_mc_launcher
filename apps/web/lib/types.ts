export type PlayerStatus = "confirmed" | "pending" | "banned";
export type Profile = {
  login: string;
  nickname: string;
  email: string;
  registrationStatus: PlayerStatus;
  registeredAt: number;
  lastLogin: number | null;
  role: 'admin' | 'player';
  canManageRoles: boolean;
  telegramId: string | null;
  discordId: string | null;
  telegramUsername: string;
  discordUsername: string;
  frozenUntil: number | null;
  moderationReason: string;
};
export type PlayerEvent = {
  id: string; at: number; login: string; nickname: string;
  category: string; action: string; actor: string; source: string; method: string;
  outcome: string; ip: string; userAgent: string; bot: string; target: string;
  reason: string; telegramId: string; discordId: string;
  telegramUsername?: string; discordUsername?: string;
};
export type EventsPage = { items: PlayerEvent[]; total: number; page: number; limit: number };
export type BuildConfig = {
  version: string;
  loader: string;
  loaderVersion: string;
  javaVersion: number;
  minMemory: number;
  maxMemory: number;
  jvmArgs: string[];
  servers: { name: string; address: string }[];
  launcherServer: string;
};
export type Mod = { name: string; size: number };
export type ConfigArchive = {
  name: string;
  size: number;
  unpackedSize: number;
  fileCount: number;
  hash: string;
  updatedAt: number;
};
export type DashboardData = {
  mods: Mod[];
  configs: ConfigArchive | null;
  versions: string[];
  loaders: string[];
  userCount: number;
  clientExists: boolean;
  mcServer: string;
  buildConfig: BuildConfig;
  domain: string;
  useHTTPS: boolean;
  publicURL: string;
};
export type ClientInfo = { version: string; url: string; size: number; sha256: string | null };
