import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const CHUNK_BYTES = 1_048_576;

/**
 * SHA-256 as lowercase hex, in pure JS: `crypto.subtle` is missing in
 * insecure contexts such as Figma's plugin iframe. Fed in 1 MB chunks.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const hash = sha256.create();
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    hash.update(bytes.subarray(i, i + CHUNK_BYTES));
  }
  return bytesToHex(hash.digest());
}
