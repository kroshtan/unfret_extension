// Types for scripts/store-publish.mjs (used by test/store-publish.test.ts).
export const HEALTH_URL: string;
export const CWS_ITEM_ID: string;
export const CWS_TOKEN_URL: string;
export const CWS_API: string;
export const AMO_API: string;
export const AMO_SLUG: string;
export const EDGE_API: string;
export const REPO_URL: string;

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
  dry?: { status?: number; data?: unknown; headers?: Record<string, string> };
  accept?: number[];
}
export interface HttpClient {
  send(request: StoreRequest): Promise<{ status: number; data: any; headers: Record<string, string> }>; // eslint-disable-line @typescript-eslint/no-explicit-any
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
export function packageManifest(zipPath: string): Record<string, unknown>;
export function amoCompatibility(manifest: unknown): string[] | null;
export function publishFirefox(options: {
  http: HttpClient;
  credentials: { issuer: string; secret: string };
  zipPath: string;
  sourcePath: string;
  version: string;
  approvalNotes?: string;
  slug?: string;
  wait?: (ms: number) => Promise<unknown>;
  dryRun?: boolean;
}): Promise<string>;

export function edgeUrls(
  productId: string,
  api?: string,
): {
  upload: string;
  uploadStatus: (id: string) => string;
  publish: string;
  publishStatus: (id: string) => string;
};
export function edgeHeaders(credentials: { clientId: string; apiKey: string }): Record<string, string>;
export function edgeOperationId(location: string | null | undefined): string | null;
export function changelogHeadlines(changelog: string, version: string): string[];
export const EDGE_NOTES_MAX: number;
export function edgeNotes(options: {
  version: string;
  changelog?: string;
  instructions?: string;
  max?: number;
}): string;
export function publishEdge(options: {
  http: HttpClient;
  credentials: { productId: string; clientId: string; apiKey: string };
  zipPath: string;
  version: string;
  notes: string;
  wait?: (ms: number) => Promise<unknown>;
  tries?: number;
  dryRun?: boolean;
}): Promise<string>;

export function missing(env: Record<string, string | undefined>, names: string[]): string[];
export function main(
  argv?: string[],
  env?: Record<string, string | undefined>,
  fetchFn?: typeof fetch,
): Promise<number>;
