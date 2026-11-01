import { NO_ROOM, type RunStatus } from "./capture-run";
import type { Reply } from "./messages";
import { friendlyError } from "./page";
import type { ReleaseOutcome } from "./tab-hold";

/** The part of `chrome.windows` the worker uses, so resizing can be tested. */
export type WindowsApi = {
  get: (windowId: number) => Promise<{ width?: number }>;
  update: (windowId: number, info: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Sets a window's width and returns the width Chrome gave. `left` moves it too, for a width Chrome
 * would refuse where the window stands.
 */
export async function resizeWindow(
  api: WindowsApi,
  windowId: number,
  width: number,
  left?: number
): Promise<number> {
  await api.update(windowId, { width, ...(left === undefined ? {} : { left }) });
  return (await api.get(windowId)).width ?? width;
}

export type CaptureResult =
  | { ok: true; label?: string; width: number; nodeLimit: boolean; blockedImages: number }
  | { ok: false; message: string };

/**
 * Holds one capture of a viewport run open until the `CaptureRun` reports how it ended. While it
 * holds one, statuses are the run's own and do not go to the popup.
 */
export class CaptureGate {
  private waiting: ((result: CaptureResult) => void) | null = null;

  run(start: () => Promise<Reply | undefined>): Promise<CaptureResult> {
    return new Promise((resolve) => {
      const settle = (result: CaptureResult) => {
        if (this.waiting === settle) this.waiting = null;
        resolve(result);
      };
      this.waiting = settle;
      start().then(
        (reply) => {
          if (!reply?.ok) {
            settle({ ok: false, message: reply?.error ?? "The capture could not start" });
          }
        },
        (error) => settle({ ok: false, message: messageOf(error) })
      );
    });
  }

  /** Takes a capture's status; false means none is held and it belongs to the popup. */
  offer(status: RunStatus): boolean {
    const waiting = this.waiting;
    if (!waiting) return false;
    if (status.state === "saved") {
      const { width, label, nodeLimit, blockedImages } = status;
      waiting({ ok: true, width, nodeLimit, blockedImages, ...(label ? { label } : {}) });
    } else if (status.state === "error") {
      waiting({ ok: false, message: status.message });
    }
    return true;
  }
}

type Busy = { capturing: boolean; viewportRunning: boolean };

const RUN_BUSY = "A capture at several widths is already running";
const CAPTURE_BUSY = "A capture is already running";

/**
 * Why a start must be refused, or null. `capture` is a plain capture, `width` one of a viewport
 * run's own, and `viewport` a new run. Check before changing anything: a refused run must not
 * touch the live one.
 */
export function startRefusal(
  request: "capture" | "width" | "viewport",
  { capturing, viewportRunning }: Busy
): string | null {
  if (request === "width") return null;
  if (viewportRunning) return RUN_BUSY;
  return request === "viewport" && capturing ? CAPTURE_BUSY : null;
}

export type ViewportDeps = {
  /** The tab's page, from `pageOrigin`; null when the tab is gone or its URL can't be read. */
  origin: () => Promise<string | null>;
  /** Moves the tab to the small window and holds its place. Throws when Chrome refuses. */
  hold: () => Promise<void>;
  /** Sets the small window's width; returns the width Chrome gave. Throws when refused. */
  resize: (width: number) => Promise<number>;
  /** Tells a closed window from a refused call. */
  windowOpen: () => Promise<boolean>;
  /** Gives the tab back; "stranded" means it is still in the small window. */
  release: () => Promise<ReleaseOutcome>;
  /** Packs the captures into one file and saves it; returns the filename. Called only if any exist. */
  save: () => Promise<string>;
  /** Tells the user the run is over. `failed` is true when it saved less than was asked. */
  announce: (failed: boolean) => void;
  /** One capture. `label` is what the window says; the page has the last word. */
  capture: (label: string) => Promise<CaptureResult>;
  /** The width the page is laid out at; null when it can't be read. */
  pageWidth: () => Promise<number | null>;
  /** Pages re-lay out on resize: this gives them time. */
  settle: () => Promise<void>;
  onStatus: (status: RunStatus) => void;
};

type Final = RunStatus & { state: "viewport-done" };

const WINDOW_CLOSED = "The window was closed, so the run stopped.";
const LEFT_PAGE = "The page changed address, so the run stopped.";
const NOT_RESIZED = "The window couldn't be resized, so the run stopped.";
const NOT_MOVED = "The tab couldn't be moved, so the run stopped.";
const STRANDED = "Your tab couldn't be moved back. It's in the small window.";
const NOT_SAVED = "The file couldn't be saved.";
const WENT_WRONG = "Something went wrong, so the run stopped.";
const held = (width: number) =>
  `The page stayed at ${width} when the window was resized, so the run stopped. Turn off the device toolbar in Developer Tools and capture again.`;
const noRoom = (width: number) => `${width} didn't fit in the file, so the run stopped there.`;

/** The narrowest width a window is asked for. */
const MIN_WIDTH = 120;

/** How far the window moves to see whether the page follows it. */
const PROBE_PX = 40;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One capture per width. It lives in the offscreen document, because a resized window can close the
 * popup and Chrome stops the worker when idle; each window call is one message to the worker.
 */
export class ViewportRun {
  private cancelled = false;
  running = false;
  status: RunStatus = { state: "idle" };

  constructor(private deps: ViewportDeps) {}

  /** Resolves when the run has finished and the window is back. */
  start(widths: number[]): Promise<void> {
    if (this.running) throw new Error(RUN_BUSY);
    this.running = true;
    this.cancelled = false;
    this.status = { state: "idle" };
    return this.drive(widths);
  }

  /** Takes effect between widths: a capture in progress finishes and its file is kept. */
  cancel(): void {
    this.cancelled = true;
  }

  /** Returns the current status; a finished run's status is handed out once, then cleared. */
  take(): RunStatus {
    const status = this.status;
    if (status.state === "viewport-done") this.status = { state: "idle" };
    return status;
  }

  /** The popup confirmed it received `status`, so it need not be held for the next open. */
  acknowledge(status: RunStatus): RunStatus | undefined {
    return this.status === status ? this.take() : undefined;
  }

  private set(status: RunStatus): void {
    this.status = status;
    this.deps.onStatus(status);
  }

  private async drive(widths: number[]): Promise<void> {
    const asked = [...widths].sort((a, b) => b - a);
    const done: Final = {
      state: "viewport-done",
      saved: [],
      mismatched: [],
      nodeLimit: false,
      blockedImages: 0,
    };
    try {
      await this.withTab(asked, done);
    } finally {
      this.running = false;
      try {
        this.set(done);
      } catch {
        // The status is already held for the popup's next open.
      }
      try {
        this.deps.announce(done.saved.length < asked.length);
      } catch {
        // The status is the record; a missed announcement loses nothing.
      }
    }
  }

  /** Every way out of the sweep passes through here, so the tab always goes back, then the file is saved. */
  private async withTab(widths: number[], done: Final): Promise<void> {
    const home = await this.origin();
    if (home === null) {
      done.stopped = LEFT_PAGE;
      return;
    }
    try {
      await this.deps.hold();
    } catch {
      done.stopped = NOT_MOVED;
      return;
    }
    let stranded = false;
    try {
      this.set({ state: "viewport", index: 1, total: widths.length, label: String(widths[0]) });
      const stopped = await this.sweep(widths, home, done);
      if (stopped) done.stopped = stopped;
    } catch {
      done.stopped = WENT_WRONG;
    } finally {
      try {
        stranded = (await this.deps.release()) === "stranded";
      } catch {
        stranded = true;
      }
    }
    if (done.saved.length > 0) {
      try {
        done.filename = await this.deps.save();
      } catch {
        done.saved = [];
        done.stopped = NOT_SAVED;
      }
    }
    if (stranded) done.stopped = STRANDED;
  }

  /** The width Chrome gave, or why it gave none. */
  private async resized(width: number): Promise<number | { stopped: string }> {
    try {
      return await this.deps.resize(width);
    } catch {
      return { stopped: (await this.windowOpen()) ? NOT_RESIZED : WINDOW_CLOSED };
    }
  }

  /** Returns why it stopped early, if something went wrong. */
  private async sweep(widths: number[], home: string, done: Final): Promise<string | undefined> {
    // Window width to the width its capture really had, to tell which requests are repeats.
    const seen = new Map<number, number>();
    for (const [index, requested] of widths.entries()) {
      if (this.stopping(done)) return undefined;
      const given = await this.resized(requested);
      if (typeof given !== "number") return given.stopped;
      const repeat = seen.get(given);
      if (repeat !== undefined) {
        if (repeat !== requested) done.mismatched.push({ requested, width: repeat });
        continue;
      }
      this.set({
        state: "viewport",
        index: index + 1,
        total: widths.length,
        label: String(given),
      });
      await this.deps.settle();
      if (this.stopping(done)) return undefined;
      if ((await this.origin()) !== home) return this.whyGone();
      const stuck = await this.heldAt(given);
      if (stuck !== null) return held(stuck);
      const result = await this.deps
        .capture(String(given))
        .catch((error): CaptureResult => ({ ok: false, message: messageOf(error) }));
      if (!result.ok) {
        if ((await this.origin()) !== home) return this.whyGone();
        return result.message === NO_ROOM ? noRoom(given) : friendlyError(result.message);
      }
      const label = result.label ?? String(result.width);
      // The label is the laid-out width, scrollbar included, so a scrollbar is not a mismatch.
      const real = Number.parseInt(label, 10);
      seen.set(given, real);
      if (real !== requested) done.mismatched.push({ requested, width: real });
      done.saved.push({ label, width: result.width });
      done.nodeLimit ||= result.nodeLimit;
      done.blockedImages = Math.max(done.blockedImages, result.blockedImages);
    }
    return undefined;
  }

  /**
   * The width the page is held at, or null. Device mode keeps a page at its own width whatever the
   * window does, and then every width would save the same file. A page narrower than its window
   * can also just share it with docked Developer Tools, so moving the window tells them apart.
   */
  private async heldAt(windowWidth: number): Promise<number | null> {
    const width = await this.pageWidth();
    if (width === null || width === windowWidth) return null;
    const probe =
      windowWidth - PROBE_PX >= MIN_WIDTH ? windowWidth - PROBE_PX : windowWidth + PROBE_PX;
    await this.deps.resize(probe);
    await this.deps.settle();
    const moved = await this.pageWidth();
    if (moved === width) return width;
    await this.deps.resize(windowWidth);
    await this.deps.settle();
    return null;
  }

  private pageWidth(): Promise<number | null> {
    return this.deps.pageWidth().catch(() => null);
  }

  private stopping(done: Final): boolean {
    if (this.cancelled) done.cancelled = true;
    return this.cancelled;
  }

  /** The tab is not where it was, which also happens when its window closes. */
  private async whyGone(): Promise<string> {
    return (await this.windowOpen()) ? LEFT_PAGE : WINDOW_CLOSED;
  }

  private windowOpen(): Promise<boolean> {
    return this.deps.windowOpen().catch(() => false);
  }

  private origin(): Promise<string | null> {
    return this.deps.origin().catch(() => null);
  }
}
