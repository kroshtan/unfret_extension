// Types for scripts/zip.mjs (used by test/store-publish.test.ts).
export function zipBuffer(dir: string): Buffer;
export function zipDirectory(dir: string, target: string): void;
export function zipEntry(zip: Buffer, name: string): Buffer | null;
