// Types for scripts/manifest.mjs (used by the build and by test/permissions.test.ts).
export declare const API_ORIGIN: string;
export declare const UPDATE_URL: string;
export declare const DEV_API_ORIGIN: string;
export declare const DEV_UPDATE_URL: string;
export declare const LOCAL_PERMISSIONS: string[];
type Browser = "chrome" | "chrome-selfhosted" | "chrome-dev" | "firefox";
export declare function apiOrigin(browser: Browser): string;
export declare function manifest(
  browser: Browser,
  options: { version: string; description: string; publicKey?: string },
): Record<string, unknown>;
