// Types for scripts/channels.mjs (used by test/publish.test.ts).
export interface Channel {
  build: string;
  keyPath: string;
  publicKeyFile: string;
  idFile: string;
  crxPrefix: string;
  updates: string;
  baseUrl: string;
}
export const CHANNELS: { production: Channel; dev: Channel };
export function channelFromArgs(argv?: string[]): Channel;
export function devVersion(version: string, build?: string): string;
export function versionFor(build: string, version: string): string;
