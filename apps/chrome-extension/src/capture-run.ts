import type { Capture } from "@repo/capture-schema";
import { ChunkAssembler, type ChunkMessage } from "./chunks";
import { captureFilename } from "./page";

export type RunStatus =
  | { state: "idle" }
  | { state: "capturing" | "packing" | "saving" }
  | { state: "saved"; filename: string }
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
};

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
  private timer: unknown;
  status: RunStatus = { state: "idle" };

  constructor(private deps: RunDeps) {}

  start(runId: string): void {
    if (this.active) throw new Error("A capture is already running");
    this.runId = runId;
    this.active = true;
    this.capture = new ChunkAssembler();
    this.captureText = null;
    this.set({ state: "capturing" });
    this.arm();
  }

  onChunk(runId: string, chunk: ChunkMessage): void {
    if (!this.mine(runId)) return;
    if (chunk.kind !== "capture") {
      this.fail("Unexpected image data from the page");
      return;
    }
    try {
      const text = this.capture?.add(chunk.index, chunk.total, chunk.data);
      if (text != null) this.captureText = text;
      this.arm();
    } catch (e) {
      this.fail(`The page sent a bad chunk: ${message(e)}`);
    }
  }

  onEnd(runId: string): void {
    if (!this.mine(runId)) return;
    const text = this.captureText;
    if (text == null) {
      this.fail("The page finished before sending the whole capture");
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

  private fail(msg: string): void {
    this.clear();
    this.active = false;
    this.capture = null;
    this.captureText = null;
    this.set({ state: "error", message: msg });
  }

  private async finish(text: string): Promise<void> {
    let url: string | null = null;
    try {
      const capture = this.deps.parse(text);
      const bytes = this.deps.pack(capture, new Map());
      url = this.deps.makeBlobUrl(bytes);
      const filename = captureFilename(capture.source.url, this.deps.now());
      this.set({ state: "saving" });
      const saved = await this.deps.download({ url, filename });
      this.active = false;
      this.set({ state: "saved", filename: saved ?? filename });
    } catch (e) {
      this.fail(`Could not save the file: ${message(e)}`);
    } finally {
      if (url) this.deps.revokeUrl(url);
      this.capture = null;
      this.captureText = null;
    }
  }
}
