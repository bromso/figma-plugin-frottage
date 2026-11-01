import { type Capture, countNodes, LIMITS } from "@repo/capture-schema";
import { AssetAssembler, ChunkAssembler, type ChunkMessage } from "./chunks";
import { captureFilename } from "./page";

export type RunStatus =
  | { state: "idle" }
  | { state: "capturing" | "packing" | "saving" }
  /**
   * `nodes` is the layer count in the file; `nodeLimit` is set when the page had more than fit;
   * `blockedImages` counts images left as placeholders because they could not be read.
   */
  | { state: "saved"; filename: string; nodes: number; nodeLimit: boolean; blockedImages: number }
  | { state: "error"; message: string };

export type RunDeps = {
  /** Parses and validates capture JSON; throws when it is not a valid capture. */
  parse: (text: string) => Capture;
  pack: (capture: Capture, assets: Map<string, Uint8Array>) => Uint8Array;
  makeBlobUrl: (bytes: Uint8Array) => string;
  revokeUrl: (url: string) => void;
  /** Resolves with the basename Chrome actually saved (it may differ from the requested one). */
  download: (req: { url: string; filename: string }) => Promise<string | undefined>;
  report: (status: RunStatus) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => Date;
  /** No-progress timeout. */
  timeoutMs: number;
  /** Most image bytes accepted from the page. Default 180 MiB, as in the page's budget. */
  maxAssetBytes?: number;
  /** Most capture JSON bytes packed. Default the importer's limit, so no file it refuses is saved. */
  maxCaptureBytes?: number;
};

/** Decoded size of base64 text, without decoding it. */
const decodedSize = (b64: string) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** 180 MiB of images plus up to 64 MiB of capture.json stays under the 256 MiB import limit. */
const MAX_ASSET_BYTES = 180 * 1024 * 1024;

const TOO_MUCH_CONTENT = "This page has too much content to capture. Try a smaller section.";

/** Images that stayed placeholders because they could not be read. */
function countBlockedImages(root: NonNullable<Capture["root"]>): number {
  let n = 0;
  const stack: Array<NonNullable<Capture["root"]>> = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.kind === "placeholder" && node.placeholderKind === "blocked-image") n++;
    if (node.kind === "element") stack.push(...node.children);
  }
  return n;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * State of one capture run. It lives in the offscreen document, never in the service
 * worker, because Chrome stops the worker while a page is still being captured.
 */
export class CaptureRun {
  private runId: string | null = null;
  private active = false;
  private capture: ChunkAssembler | null = null;
  private captureText: string | null = null;
  /** Assets still arriving, by hash, and the finished ones. */
  private assembling = new Map<string, AssetAssembler>();
  private assets = new Map<string, Uint8Array>();
  private assetBytes = 0;
  private timer: unknown;
  status: RunStatus = { state: "idle" };

  constructor(private deps: RunDeps) {}

  start(runId: string): void {
    if (this.active) throw new Error("A capture is already running");
    this.runId = runId;
    this.active = true;
    this.capture = new ChunkAssembler();
    this.captureText = null;
    this.resetAssets();
    this.set({ state: "capturing" });
    this.arm();
  }

  onChunk(runId: string, chunk: ChunkMessage): void {
    if (!this.mine(runId)) return;
    try {
      if (chunk.kind === "asset") {
        this.onAssetChunk(chunk);
        this.arm();
        return;
      }
      const text = this.capture?.add(chunk.index, chunk.total, chunk.data);
      if (text != null) this.captureText = text;
      this.arm();
    } catch (e) {
      this.fail(`The page sent a bad chunk: ${message(e)}`);
    }
  }

  private onAssetChunk(chunk: ChunkMessage): void {
    if (!SHA256_HEX.test(chunk.key)) throw new Error("Image data has an invalid key");
    if (this.assets.has(chunk.key)) throw new Error("Image data was sent twice");
    let asm = this.assembling.get(chunk.key);
    if (!asm) {
      asm = new AssetAssembler();
      this.assembling.set(chunk.key, asm);
    }
    // Count the chunk before decoding it, so an oversized one is never allocated.
    const limit = this.deps.maxAssetBytes ?? MAX_ASSET_BYTES;
    const tooMuch = () => new Error("The page sent more image data than the limit allows");
    if (this.assetBytes + decodedSize(chunk.data) > limit) throw tooMuch();
    const before = asm.size;
    const bytes = asm.add(chunk.index, chunk.total, chunk.data);
    this.assetBytes += asm.size - before;
    if (this.assetBytes > limit) throw tooMuch();
    if (bytes) {
      this.assembling.delete(chunk.key);
      this.assets.set(chunk.key, bytes);
    }
  }

  onEnd(runId: string): void {
    if (!this.mine(runId)) return;
    if (this.assembling.size > 0) {
      this.fail("The page finished before sending all of its image data");
      return;
    }
    const text = this.captureText;
    if (text == null) {
      this.fail("The page finished before sending the whole capture");
      return;
    }
    const limit = this.deps.maxCaptureBytes ?? LIMITS.captureJsonBytes;
    if (new TextEncoder().encode(text).length > limit) {
      this.fail(TOO_MUCH_CONTENT);
      return;
    }
    this.clear();
    this.set({ state: "packing" });
    void this.finish(text);
  }

  onPageError(runId: string, detail: string): void {
    if (!this.mine(runId)) return;
    this.fail(`The page could not be captured: ${detail}`);
  }

  onPortClosed(runId: string): void {
    if (!this.mine(runId) || this.status.state !== "capturing") return;
    this.fail("The page closed or navigated before the capture finished");
  }

  /** The page is still working (for example fetching images); restart the no-progress timer. */
  onHeartbeat(runId: string): void {
    if (!this.mine(runId) || this.status.state !== "capturing") return;
    this.arm();
  }

  /** Returns the current status; a finished run's status is handed out once, then cleared. */
  take(): RunStatus {
    const status = this.status;
    if (status.state === "saved" || status.state === "error") this.status = { state: "idle" };
    return status;
  }

  /** The popup confirmed it received `status`, so it need not be held for the next open. */
  acknowledge(status: RunStatus): RunStatus | undefined {
    return this.status === status ? this.take() : undefined;
  }

  /** Called by the worker when injection fails. */
  onInjectFailed(runId: string, detail: string): void {
    if (!this.mine(runId)) return;
    this.fail(`Could not start the capture: ${detail}`);
  }

  private mine(runId: string): boolean {
    return this.active && runId === this.runId;
  }

  private set(status: RunStatus): void {
    this.status = status;
    this.deps.report(status);
  }

  private arm(): void {
    this.clear();
    this.timer = this.deps.setTimer(
      () => this.fail("No progress from the page for 60 seconds; the capture was cancelled"),
      this.deps.timeoutMs
    );
  }

  private clear(): void {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
  }

  private resetAssets(): void {
    this.assembling = new Map();
    this.assets = new Map();
    this.assetBytes = 0;
  }

  private fail(msg: string): void {
    this.clear();
    this.active = false;
    this.capture = null;
    this.captureText = null;
    this.resetAssets();
    this.set({ state: "error", message: msg });
  }

  private async finish(text: string): Promise<void> {
    let url: string | null = null;
    try {
      const capture = this.deps.parse(text);
      // Pack exactly the images the capture lists; a missing one would leave a dangling hash.
      const listed = new Map<string, Uint8Array>();
      for (const { hash } of capture.assets) {
        const data = this.assets.get(hash);
        if (!data) throw new Error("image data is missing for an asset in the capture");
        listed.set(hash, data);
      }
      const bytes = this.deps.pack(capture, listed);
      url = this.deps.makeBlobUrl(bytes);
      const filename = captureFilename(capture.source.url, this.deps.now());
      const nodes = capture.root ? countNodes(capture.root) : 0;
      const nodeLimit = (capture.warnings ?? []).some((w) => w.code === "node-limit");
      const blockedImages = capture.root ? countBlockedImages(capture.root) : 0;
      this.set({ state: "saving" });
      const saved = await this.deps.download({ url, filename });
      this.active = false;
      this.set({ state: "saved", filename: saved ?? filename, nodes, nodeLimit, blockedImages });
    } catch (e) {
      this.fail(`Could not save the file: ${message(e)}`);
    } finally {
      if (url) this.deps.revokeUrl(url);
      this.capture = null;
      this.captureText = null;
      this.resetAssets();
    }
  }
}
