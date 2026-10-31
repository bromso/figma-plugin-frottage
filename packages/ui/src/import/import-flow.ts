import { type Capture, FrottageFileError, unpackFrottage } from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import {
  batchOps,
  type FontRef,
  type ImportReport,
  mapCapture,
  type PlanOp,
} from "@repo/figma-mapper";
import { messageForError } from "./messages";

export { messageForError };

export type ImportState =
  | { step: "idle" }
  | { step: "working"; done: number; total: number }
  | {
      step: "done";
      report: ImportReport;
      failedOps: number;
      missingImages: number;
    }
  | { step: "error"; message: string };

export type ImportPort = {
  listFonts(): Promise<FontRef[]>;
  begin(meta: { name: string; fonts: FontRef[]; totalOps: number }): Promise<void>;
  image(hash: string, bytes: Uint8Array): Promise<{ ok: boolean }>;
  batch(ops: PlanOp[]): Promise<void>;
  end(): Promise<{ rootId: string; failedOps: number; missingImages?: number }>;
  cancel(): Promise<void>;
};

/** Files above this are refused before reading; the container enforces the real limits. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

const SHA256_KEY = /^[0-9a-f]{64}$/i;

/** A hidden iframe gets no animation frames, so the import never waits longer than this for one. */
const PAINT_WAIT_MS = 100;

/** Let the browser paint and handle input; safe where requestAnimationFrame is absent or stalled. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve);
      return;
    }
    const fallback = setTimeout(resolve, PAINT_WAIT_MS);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve);
    });
  });
}

/** The root layer's name: the page title, else its hostname, never anything from the query. */
function importName({ title, url }: Capture["source"]): string {
  const name = title.trim();
  if (name) return name;
  try {
    return new URL(url).hostname || "Frottage import";
  } catch {
    return "Frottage import";
  }
}

async function verifyAssets(assets: Map<string, Uint8Array>): Promise<void> {
  for (const [key, bytes] of assets) {
    if (!SHA256_KEY.test(key)) continue;
    if (sha256Hex(bytes) !== key.toLowerCase()) throw new FrottageFileError("corrupt-asset");
    await yieldToPaint();
  }
}

export async function runImport(
  file: File,
  port: ImportPort,
  onState: (s: ImportState) => void
): Promise<void> {
  let begun = false;
  try {
    if (file.size > MAX_FILE_BYTES) throw new FrottageFileError("too-large");
    onState({ step: "working", done: 0, total: 0 });
    await yieldToPaint();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { capture, assets } = unpackFrottage(bytes);
    await verifyAssets(assets);

    await yieldToPaint();
    const plan = mapCapture(capture, await port.listFonts());
    const total = plan.ops.length;
    onState({ step: "working", done: 0, total });

    // Set first: a begin that fails halfway may still have created state to cancel.
    begun = true;
    await port.begin({ name: importName(capture.source), fonts: plan.fonts, totalOps: total });

    for (const hash of plan.assetHashes) {
      const data = assets.get(hash);
      // A failed image is not an error here; the sandbox counts it in `missingImages` at end().
      if (data) await port.image(hash, data);
    }

    let done = 0;
    for (const ops of batchOps(plan.ops)) {
      await port.batch(ops);
      done += ops.length;
      onState({ step: "working", done, total });
    }

    const result = await port.end();
    if (!result.rootId) throw new Error("Nothing was created");
    begun = false;
    onState({ step: "working", done: total, total });
    onState({
      step: "done",
      report: plan.report,
      failedOps: result.failedOps,
      missingImages: result.missingImages ?? 0,
    });
  } catch (error) {
    if (begun) {
      try {
        await port.cancel();
      } catch {
        // The error below is what matters.
      }
    }
    onState({ step: "error", message: messageForError(error) });
  }
}
