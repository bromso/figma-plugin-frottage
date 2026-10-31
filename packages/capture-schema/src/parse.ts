import { type Capture, type CaptureNode, captureSchema, SCHEMA_VERSION } from "./schema";

export type ParseResult =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "invalid" | "newer-version"; detail: string };

export function parseCapture(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "invalid", detail: "Capture must be an object" };
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "newer-version",
      detail: `Capture uses schema version ${version}; this plugin reads up to ${SCHEMA_VERSION}`,
    };
  }
  const result = captureSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, reason: "invalid", detail: result.error.message };
  }
  return { ok: true, capture: result.data };
}

export function countNodes(root: CaptureNode): number {
  let n = 1;
  if (root.kind === "element") {
    for (const child of root.children) n += countNodes(child);
  }
  return n;
}
