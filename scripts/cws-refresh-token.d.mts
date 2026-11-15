// Types for scripts/cws-refresh-token.mjs (used by test/store-publish.test.ts).
export const AUTH_URL: string;
export const TOKEN_URL: string;
export const SCOPE: string;
export const SECRETS_FILE: string;
export function readClient(json: unknown): { clientId: string; clientSecret: string };
export function pkce(bytes?: Uint8Array): { verifier: string; challenge: string };
export function consentUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string;
export function codeExchangeRequest(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): { method: string; url: string; headers: Record<string, string>; body: URLSearchParams };
export function codeFrom(input: string, state: string): string;
