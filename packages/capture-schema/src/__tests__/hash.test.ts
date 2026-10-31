import { expect, test } from "bun:test";
import { sha256Hex } from "../hash";

test("matches known SHA-256 vectors", () => {
  expect(sha256Hex(new Uint8Array())).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("chunked input hashes the same as one shot", () => {
  const big = new Uint8Array(2_500_000).fill(7);
  const { createHash } = require("node:crypto");
  expect(sha256Hex(big)).toBe(createHash("sha256").update(big).digest("hex"));
});
