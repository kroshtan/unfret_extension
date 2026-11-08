// Types for scripts/manifest.mjs (used by the build and by test/permissions.test.ts).
export declare const API_ORIGIN: string;
export declare const UPDATE_URL: string;
export declare const DEV_PERMISSIONS: string[];
export declare function manifest(
  browser: "chrome" | "chrome-selfhosted" | "firefox",
  options: { version: string; description: string; publicKey?: string },
): Record<string, unknown>;
