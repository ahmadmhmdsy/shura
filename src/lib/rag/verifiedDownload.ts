/**
 * Integrity checks for downloaded model assets.
 *
 * The catalog pins every asset to a HuggingFace commit and records its size and SHA-256
 * (modelCatalog.ts). A download is capped at the recorded size, so a wrong or hostile
 * response cannot fill the cache, and the finished bytes must match the digest before
 * they are written: a model that is executed and a tokenizer that shapes every stored
 * vector are never trusted on the strength of the URL alone.
 */

import { KeyedError } from "@/lib/errors/keyedError";

export interface AssetDigest {
  /** Exact byte length of the pinned file. */
  bytes: number;
  /** Lowercase hex SHA-256 of the pinned file. */
  sha256: string;
}

/** Throws once a response has delivered (or announced) more bytes than the pinned file. */
export function assertWithinSize(loaded: number, expected: AssetDigest): void {
  if (loaded > expected.bytes) throw new KeyedError("errors.modelTooLarge");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Rejects bytes whose length or SHA-256 differs from the pinned file. */
export async function verifyDigest(bytes: ArrayBuffer, expected: AssetDigest): Promise<void> {
  if (bytes.byteLength !== expected.bytes) throw new KeyedError("errors.modelIntegrity");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new KeyedError("errors.modelIntegrity");
  const digest = toHex(await subtle.digest("SHA-256", bytes));
  if (digest !== expected.sha256) throw new KeyedError("errors.modelIntegrity");
}
