export type PlayerStatus = "confirmed" | "pending" | "banned";
export type Profile = {
  login: string;
  nickname: string;
  email: string;
  registrationStatus: PlayerStatus;
  registeredAt: number;
  lastLogin: number | null;
};
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
export type DashboardData = {
  mods: Mod[];
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
export type ClientInfo = { version: string; url: string; size: number };
