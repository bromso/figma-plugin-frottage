import { type Capture, FrottageFileError, unpackFrottage } from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import {
  batchOps,
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type ImportOptions,
  type ImportReport,
  mapCapture,
  missingFonts,
  type PlanOp,
  type PlanTokens,
} from "@repo/figma-mapper";
import { messageForError } from "./messages";

export { messageForError };

/** A font the file uses that the user does not have, with the available family chosen for it. */
export type ReviewFont = { family: string; choice: string };

export type ImportState =
  | { step: "idle" }
  | {
      step: "review";
      missing: ReviewFont[];
      /** Every available family, for the choices. */
      families: string[];
      options: ImportOptions;
      hostname: string;
    }
  | { step: "working"; done: number; total: number }
  | {
      step: "done";
      report: ImportReport;
      failedOps: number;
      missingImages: number;
      rewrappedTexts: number;
      textDriftCount: number;
      autoLayoutFrames: number;
      fallbackFrames: number;
      componentsCreated: number;
      instancesCreated: number;
      overrideFailures: number;
      overrideFailuresInMains: number;
      layoutFailures: number;
      hoverVariants: number;
      hoverFailures: number;
      paintFailures: number;
      resizedFallbacks: number;
      stylesCreated: number;
      stylesReused: number;
      variablesCreated: number;
      variablesReused: number;
      tokenFailures: number;
    }
  | { step: "error"; message: string };

export type ImportPort = {
  getPrefs(key: string): Promise<unknown>;
  setPrefs(key: string, value: unknown): Promise<void>;
  listFonts(): Promise<FontRef[]>;
  begin(meta: { name: string; fonts: FontRef[]; totalOps: number }): Promise<void>;
  tokens(tokens: PlanTokens, options: ImportOptions): Promise<void>;
  image(hash: string, bytes: Uint8Array): Promise<{ ok: boolean }>;
  batch(ops: PlanOp[]): Promise<void>;
  end(): Promise<{
    rootId: string;
    failedOps: number;
    missingImages?: number;
    rewrappedTexts?: number;
    textDriftCount?: number;
    autoLayoutFrames?: number;
    fallbackFrames?: number;
    componentsCreated?: number;
    instancesCreated?: number;
    overrideFailures?: number;
    overrideFailuresInMains?: number;
    layoutFailures?: number;
    hoverVariants?: number;
    hoverFailures?: number;
    paintFailures?: number;
    resizedFallbacks?: number;
    stylesCreated?: number;
    stylesReused?: number;
    variablesCreated?: number;
    variablesReused?: number;
    tokenFailures?: number;
  }>;
  cancel(): Promise<void>;
};

/** What the user confirmed in the review step. `fonts` maps a missing family to a chosen one. */
export type ReviewDecision = { options: ImportOptions; fonts: ReadonlyMap<string, string> };

export type ReviewSession = {
  /** Review even when no font is missing. */
  forceReview: boolean;
  /** Resolves when the user confirms, or with null when they cancel. */
  decide(): Promise<ReviewDecision | null>;
};

/** Stored options are untrusted: take each boolean field that is one, and keep the default for the rest. */
export function sanitizeOptions(raw: unknown): ImportOptions {
  const options = { ...DEFAULT_IMPORT_OPTIONS };
  if (typeof raw !== "object" || raw === null) return options;
  for (const key of Object.keys(options) as (keyof ImportOptions)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") options[key] = value;
  }
  return options;
}

/** Prefs never block an import: a failing read is as good as nothing stored. */
async function readPref(port: ImportPort, key: string): Promise<unknown> {
  try {
    return await port.getPrefs(key);
  } catch {
    return undefined;
  }
}

async function writePref(port: ImportPort, key: string, value: unknown): Promise<void> {
  try {
    await port.setPrefs(key, value);
  } catch {
    // Not remembering is the only cost.
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

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
  onState: (s: ImportState) => void,
  session?: ReviewSession,
  /** Aborted by the user's Cancel; checked between steps, images and batches. */
  signal?: AbortSignal
): Promise<void> {
  let begun = false;
  /** Stop here: undo what the sandbox made, then go back to the start. */
  const stop = async () => {
    if (begun) {
      begun = false;
      await port.cancel();
    }
    onState({ step: "idle" });
  };
  try {
    if (file.size > MAX_FILE_BYTES) throw new FrottageFileError("too-large");
    onState({ step: "working", done: 0, total: 0 });
    await yieldToPaint();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { capture, assets } = unpackFrottage(bytes);
    await verifyAssets(assets);
    if (signal?.aborted) return await stop();

    await yieldToPaint();
    const available = await port.listFonts();
    const hostname = hostnameOf(capture.source.url);
    let options = sanitizeOptions(
      hostname ? await readPref(port, `options:${hostname}`) : undefined
    );
    let plan = mapCapture(capture, available, options);

    const missing = missingFonts(plan.report, available);
    if (session && (missing.length > 0 || session.forceReview)) {
      const families = [...new Set(available.map((f) => f.family))];
      const reviewFonts: ReviewFont[] = [];
      for (const { family, nearest } of missing) {
        const stored = await readPref(port, `font:${family}`);
        const choice = typeof stored === "string" && families.includes(stored) ? stored : nearest;
        reviewFonts.push({ family, choice });
      }
      onState({ step: "review", missing: reviewFonts, families, options, hostname });
      const decision = await session.decide();
      if (!decision) {
        onState({ step: "idle" });
        return;
      }
      options = sanitizeOptions(decision.options);
      // Prefilled choices the user left alone still apply to the plan, but are not remembered.
      const overrides: Record<string, string> = Object.create(null);
      const changed: [string, string][] = [];
      for (const { family, choice } of reviewFonts) {
        const picked = decision.fonts.get(family);
        const chosen = typeof picked === "string" && families.includes(picked) ? picked : choice;
        overrides[family] = chosen;
        if (chosen !== choice) changed.push([family, chosen]);
      }
      onState({ step: "working", done: 0, total: 0 });
      await yieldToPaint();
      plan = mapCapture(capture, available, options, overrides);
      if (hostname) await writePref(port, `options:${hostname}`, options);
      for (const [family, chosen] of changed) await writePref(port, `font:${family}`, chosen);
    }
    const total = plan.ops.length;
    onState({ step: "working", done: 0, total });

    // Set first: a begin that fails halfway may still have created state to cancel.
    begun = true;
    await port.begin({ name: importName(capture.source), fonts: plan.fonts, totalOps: total });
    // A Cancel pressed while begin ran waits for it to return, then undoes what it made.
    if (signal?.aborted) return await stop();
    await port.tokens(plan.tokens, options);

    for (const hash of plan.assetHashes) {
      if (signal?.aborted) return await stop();
      const data = assets.get(hash);
      // A failed image is not an error here; the sandbox counts it in `missingImages` at end().
      if (data) await port.image(hash, data);
    }

    let done = 0;
    for (const ops of batchOps(plan.ops)) {
      if (signal?.aborted) return await stop();
      await port.batch(ops);
      done += ops.length;
      onState({ step: "working", done, total });
    }

    if (signal?.aborted) return await stop();
    const result = await port.end();
    if (!result.rootId) throw new Error("Nothing was created");
    begun = false;
    onState({ step: "working", done: total, total });
    onState({
      step: "done",
      report: plan.report,
      failedOps: result.failedOps,
      missingImages: result.missingImages ?? 0,
      rewrappedTexts: result.rewrappedTexts ?? 0,
      textDriftCount: result.textDriftCount ?? 0,
      autoLayoutFrames: result.autoLayoutFrames ?? 0,
      fallbackFrames: result.fallbackFrames ?? 0,
      componentsCreated: result.componentsCreated ?? 0,
      instancesCreated: result.instancesCreated ?? 0,
      overrideFailures: result.overrideFailures ?? 0,
      overrideFailuresInMains: result.overrideFailuresInMains ?? 0,
      layoutFailures: result.layoutFailures ?? 0,
      hoverVariants: result.hoverVariants ?? 0,
      hoverFailures: result.hoverFailures ?? 0,
      paintFailures: result.paintFailures ?? 0,
      resizedFallbacks: result.resizedFallbacks ?? 0,
      stylesCreated: result.stylesCreated ?? 0,
      stylesReused: result.stylesReused ?? 0,
      variablesCreated: result.variablesCreated ?? 0,
      variablesReused: result.variablesReused ?? 0,
      tokenFailures: result.tokenFailures ?? 0,
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
