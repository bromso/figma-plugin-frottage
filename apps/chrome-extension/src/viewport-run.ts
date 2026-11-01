import type { RunStatus } from "./capture-run";
import type { Reply } from "./messages";
import { friendlyError } from "./page";

/** Chrome keeps a window at this width on macOS, silently, whatever narrower width it is sent. */
export const MIN_WINDOW_WIDTH = 500;

/** What a window was before the run, to give it back. */
export type WindowState = {
  windowId: number;
  state?: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

/** The part of `chrome.windows` the worker uses, so resizing can be tested. */
export type WindowsApi = {
  get: (windowId: number) => Promise<Partial<Omit<WindowState, "windowId">>>;
  update: (windowId: number, info: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Sets a window's width, leaving any other state for normal, and returns the width Chrome gave.
 * `left` moves it too, for a width Chrome would refuse where the window stands.
 */
export async function resizeWindow(
  api: WindowsApi,
  windowId: number,
  width: number,
  left?: number
): Promise<number> {
  await api.update(windowId, { state: "normal", width, ...(left === undefined ? {} : { left }) });
  return (await api.get(windowId)).width ?? width;
}

/** The `left` that keeps a window of `width` on a screen `screenWidth` wide. */
export function fittedLeft(width: number, screenWidth: number): number {
  return Math.max(0, screenWidth - width);
}

/**
 * Bounds first: Chrome refuses them on a window that is maximised, minimised or full screen. For a
 * maximised window these are the maximised bounds, the only ones Chrome exposes, so the size it had
 * before it was maximised can't be given back; un-maximising it later keeps the maximised size.
 */
export async function restoreWindow(api: WindowsApi, saved: WindowState): Promise<void> {
  const { windowId, state, ...bounds } = saved;
  const known = Object.entries(bounds).filter(([, value]) => value !== undefined);
  await api.update(windowId, { state: "normal", ...Object.fromEntries(known) });
  if (state && state !== "normal") await api.update(windowId, { state });
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
  /** Stores the window's state for `restore`. */
  remember: () => Promise<void>;
  /** Sets the width, and `left` if given; returns the width Chrome gave. Throws when refused. */
  resize: (width: number, left?: number) => Promise<number>;
  /** Tells a closed window from a refused call. */
  windowOpen: () => Promise<boolean>;
  /** The screen's available width. */
  screenWidth: () => number;
  restore: () => Promise<void>;
  /** One capture, start to saved file. `label` is what the window says; the page has the last word. */
  capture: (label: string) => Promise<CaptureResult>;
  /** Pages re-lay out on resize: this gives them time. */
  settle: () => Promise<void>;
  onStatus: (status: RunStatus) => void;
};

type Final = RunStatus & { state: "viewport-done" };

const WINDOW_CLOSED = "The window was closed, so the run stopped.";
const LEFT_PAGE = "The page changed address, so the run stopped.";
const NOT_RESIZED = "The window couldn't be resized, so the run stopped.";
const NOT_RESTORED = "The window could not be put back as it was.";
const WENT_WRONG = "Something went wrong, so the run stopped.";

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
    const done: Final = {
      state: "viewport-done",
      saved: [],
      narrow: widths.filter((width) => width < MIN_WINDOW_WIDTH),
      mismatched: [],
      nodeLimit: false,
      blockedImages: 0,
    };
    const reachable = widths.filter((width) => width >= MIN_WINDOW_WIDTH);
    try {
      if (reachable.length > 0) await this.withWindow(reachable, done);
    } finally {
      this.running = false;
      try {
        this.set(done);
      } catch {
        // The status is already held for the popup's next open.
      }
    }
  }

  /** Every way out of the sweep passes through here, so the window always goes back. */
  private async withWindow(widths: number[], done: Final): Promise<void> {
    const home = await this.origin();
    if (home === null) {
      done.stopped = LEFT_PAGE;
      return;
    }
    try {
      await this.deps.remember();
    } catch {
      done.stopped = WINDOW_CLOSED;
      return;
    }
    try {
      const stopped = await this.sweep(widths, home, done);
      if (stopped) done.stopped = stopped;
    } catch {
      done.stopped = WENT_WRONG;
    } finally {
      try {
        await this.deps.restore();
      } catch {
        done.stopped ??= NOT_RESTORED;
      }
    }
  }

  /** The width Chrome gave, or why it gave none. A refused width gets one more try, moved to fit. */
  private async resized(width: number): Promise<number | { stopped: string }> {
    try {
      return await this.deps.resize(width);
    } catch {
      if (!(await this.windowOpen())) return { stopped: WINDOW_CLOSED };
    }
    try {
      return await this.deps.resize(width, fittedLeft(width, this.deps.screenWidth()));
    } catch {
      return { stopped: NOT_RESIZED };
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
      const result = await this.deps
        .capture(String(given))
        .catch((error): CaptureResult => ({ ok: false, message: messageOf(error) }));
      if (!result.ok) {
        return (await this.origin()) === home ? friendlyError(result.message) : this.whyGone();
      }
      const label = result.label ?? String(result.width);
      // The label is the laid-out width, scrollbar included, so a scrollbar is not a mismatch.
      const real = Number(label);
      seen.set(given, real);
      if (real !== requested) done.mismatched.push({ requested, width: real });
      done.saved.push({ label, width: result.width });
      done.nodeLimit ||= result.nodeLimit;
      done.blockedImages = Math.max(done.blockedImages, result.blockedImages);
    }
    return undefined;
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
