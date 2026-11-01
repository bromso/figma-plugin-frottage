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

/** Sets a window's width, leaving any other state for normal, and returns the width Chrome gave. */
export async function resizeWindow(
  api: WindowsApi,
  windowId: number,
  width: number
): Promise<number> {
  await api.update(windowId, { state: "normal", width });
  return (await api.get(windowId)).width ?? width;
}

/** Bounds first: Chrome refuses them on a window that is maximised, minimised or full screen. */
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

export type ViewportDeps = {
  /** The origin of the tab's URL; null when the tab is gone or its URL can't be read. */
  origin: () => Promise<string | null>;
  /** Stores the window's state for `restore`. */
  remember: () => Promise<void>;
  /** Resizes the window and returns the width Chrome gave. Throws when the window has gone. */
  resize: (width: number) => Promise<number>;
  restore: () => Promise<void>;
  /** One capture, start to saved file. `label` is what the window says; the page has the last word. */
  capture: (label: string) => Promise<CaptureResult>;
  /** Pages re-lay out on resize: this gives them time. */
  settle: () => Promise<void>;
  onStatus: (status: RunStatus) => void;
};

type Final = RunStatus & { state: "viewport-done" };

const WINDOW_CLOSED = "The window was closed, so the run stopped.";
const LEFT_PAGE = "The tab left the page, so the run stopped.";
const NOT_RESTORED = "The window could not be put back as it was.";

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
    if (this.running) throw new Error("A capture at several widths is already running");
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
    if (reachable.length > 0) await this.withWindow(reachable, done);
    this.running = false;
    this.set(done);
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
    const stopped = await this.sweep(widths, home, done);
    if (stopped) done.stopped = stopped;
    try {
      await this.deps.restore();
    } catch {
      done.stopped ??= NOT_RESTORED;
    }
  }

  /** Returns why it stopped early, if something went wrong. */
  private async sweep(widths: number[], home: string, done: Final): Promise<string | undefined> {
    // Window width to the width its capture really had, to tell which requests are repeats.
    const seen = new Map<number, number>();
    for (const [index, requested] of widths.entries()) {
      if (this.stopping(done)) return undefined;
      let given: number;
      try {
        given = await this.deps.resize(requested);
      } catch {
        return WINDOW_CLOSED;
      }
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
      if ((await this.origin()) !== home) return LEFT_PAGE;
      const result = await this.deps
        .capture(String(given))
        .catch((error): CaptureResult => ({ ok: false, message: messageOf(error) }));
      if (!result.ok) {
        return (await this.origin()) === home ? friendlyError(result.message) : LEFT_PAGE;
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

  private origin(): Promise<string | null> {
    return this.deps.origin().catch(() => null);
  }
}
