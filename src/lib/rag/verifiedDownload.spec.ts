import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { assertWithinSize, verifyDigest, type AssetDigest } from "./verifiedDownload";

const payload = new TextEncoder().encode("pinned model bytes");
const expected: AssetDigest = {
  bytes: payload.byteLength,
  sha256: createHash("sha256").update(payload).digest("hex"),
};

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

describe("verifiedDownload", () => {
  it("accepts bytes that match the pinned size and digest", async () => {
    await expect(verifyDigest(copy(payload), expected)).resolves.toBeUndefined();
  });

  it("rejects bytes with the right size but a different digest", async () => {
    const tampered = payload.slice();
    tampered[0] ^= 1;
    await expect(verifyDigest(copy(tampered), expected)).rejects.toThrow("errors.modelIntegrity");
  });

  it("rejects a truncated download", async () => {
    await expect(verifyDigest(copy(payload.subarray(1)), expected)).rejects.toThrow("errors.modelIntegrity");
  });

  it("stops a response that grows past the pinned size", () => {
    expect(() => assertWithinSize(expected.bytes, expected)).not.toThrow();
    expect(() => assertWithinSize(expected.bytes + 1, expected)).toThrow("errors.modelTooLarge");
  });
});
