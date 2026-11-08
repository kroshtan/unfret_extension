// Types for scripts/crx.mjs (used by test/crx.test.ts).
export function crxIdBytes(spkiDer: Buffer): Buffer;
export function extensionId(spkiDer: Buffer): string;
export function publicKeyDer(privateKeyPem: string): Buffer;
export function packCrx(zip: Buffer, privateKeyPem: string): Buffer;
export function verifyCrx(crx: Buffer): { id: string; zip: Buffer; publicKey: Buffer };
