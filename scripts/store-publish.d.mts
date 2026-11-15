// Types for scripts/store-publish.mjs (used by test/store-publish.test.ts).
export const HEALTH_URL: string;
export const CWS_ITEM_ID: string;
export const CWS_TOKEN_URL: string;
export const CWS_API: string;
export const AMO_API: string;
export const AMO_SLUG: string;

export function parseVersion(version: string): { core: number[]; pre: string };
export function compareVersions(a: string, b: string): number;
export function gateProblem(running: string | null | undefined, minimum: string): string | null;
export function checkBackend(options: {
  fetch?: typeof fetch;
  url?: string;
  minimum: string;
}): Promise<{ running: string | undefined; problem: string | null }>;

export class StoreApiError extends Error {}

export interface StoreRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData | Blob;
  shown?: string;
  file?: string;
  dry?: { status?: number; data?: unknown };
  accept?: number[];
}
export interface HttpClient {
  send(request: StoreRequest): Promise<{ status: number; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  sent: string[];
}
export function httpClient(options?: {
  fetch?: typeof fetch;
  dryRun?: boolean;
  log?: (line: string) => void;
}): HttpClient;

export const CWS_SCOPE: string;
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}
export function readServiceAccount(json: unknown): ServiceAccountKey;
export function cwsServiceAccountAssertion(
  key: ServiceAccountKey,
  options?: { now?: number; lifetime?: number },
): string;
export function cwsServiceAccountTokenRequest(assertion: string): {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: URLSearchParams;
};
export function cwsTokenRequest(credentials: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): { method: string; url: string; headers: Record<string, string>; body: URLSearchParams };
export function cwsUrls(
  publisherId: string,
  itemId?: string,
): { upload: string; publish: string; status: string };
export function cwsExistingState(status: unknown, version: string): string | null;
export function publishChrome(options: {
  http: HttpClient;
  credentials: {
    publisherId: string;
    serviceAccount?: ServiceAccountKey | undefined;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };
  zipPath: string;
  version: string;
  itemId?: string;
  wait?: (ms: number) => Promise<unknown>;
  dryRun?: boolean;
}): Promise<string>;

export function amoJwt(options: {
  issuer: string;
  secret: string;
  now?: number;
  jti?: string;
  lifetime?: number;
}): string;
export function amoUrls(
  slug?: string,
  api?: string,
): {
  upload: string;
  uploadDetail: (uuid: string) => string;
  versions: string;
  version: (id: string | number) => string;
};
export function publishFirefox(options: {
  http: HttpClient;
  credentials: { issuer: string; secret: string };
  zipPath: string;
  sourcePath: string;
  version: string;
  android?: boolean;
  approvalNotes?: string;
  slug?: string;
  wait?: (ms: number) => Promise<unknown>;
  dryRun?: boolean;
}): Promise<string>;

export function missing(env: Record<string, string | undefined>, names: string[]): string[];
export function main(
  argv?: string[],
  env?: Record<string, string | undefined>,
  fetchFn?: typeof fetch,
): Promise<number>;
