import type { PageLanguage } from "@repo/capture-schema";
import { NO_ROOM, type RunStatus } from "./capture-run";
import type { Reply } from "./messages";
import { friendlyError } from "./page";
import type { RunWidth } from "./plan-widths";
import type { ReleaseOutcome } from "./tab-hold";

/** The part of `chrome.windows` the worker uses, so resizing can be tested. */
export type WindowsApi = {
  get: (windowId: number) => Promise<{ width?: number }>;
  update: (windowId: number, info: Record<string, unknown>) => Promise<unknown>;
};

/** Sets a window's width and returns the width Chrome gave. */
export async function resizeWindow(
  api: WindowsApi,
  windowId: number,
  width: number
): Promise<number> {
  await api.update(windowId, { width });
  return (await api.get(windowId)).width ?? width;
}

/** The part of `chrome.tabs` that loads an address, so waiting for the load can be tested. */
export type TabsApi = {
  update: (tabId: number, info: { url: string }) => Promise<unknown>;
  onUpdated: {
    addListener: (listener: (tabId: number, change: { status?: string }) => void) => void;
    removeListener: (listener: (tabId: number, change: { status?: string }) => void) => void;
  };
};

const NOT_LOADED = "The page didn't finish loading";

/** Loads an address in a tab and resolves once its page has loaded; rejects after `timeoutMs`. */
export async function loadTab(
  api: TabsApi,
  tabId: number,
  url: string,
  timeoutMs: number
): Promise<void> {
  let listener: ((id: number, change: { status?: string }) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      // Listening first, so a fast load is not missed. A `complete` counts only after this load's
      // `loading`, so the old page's can't end the wait.
      let loading = false;
      listener = (id, change) => {
        if (id !== tabId) return;
        if (change.status === "loading") loading = true;
        else if (change.status === "complete" && loading) resolve();
      };
      api.onUpdated.addListener(listener);
      timer = setTimeout(() => reject(new Error(NOT_LOADED)), timeoutMs);
      api.update(tabId, { url }).catch(reject);
    });
  } finally {
    if (listener) api.onUpdated.removeListener(listener);
    clearTimeout(timer);
  }
}

export type CaptureResult =
  | {
      ok: true;
      label?: string;
      width: number;
      nodes: number;
      nodeLimit: boolean;
      blockedImages: number;
    }
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
      const { width, label, nodes, nodeLimit, blockedImages } = status;
      waiting({ ok: true, width, nodes, nodeLimit, blockedImages, ...(label ? { label } : {}) });
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
 * Why a new run must be refused, or null. Check before changing anything: a refused run must not
 * touch the live one.
 */
export function startRefusal({ capturing, viewportRunning }: Busy): string | null {
  if (viewportRunning) return RUN_BUSY;
  return capturing ? CAPTURE_BUSY : null;
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
  /** The tab's address; null when it can't be read. Only a run with languages asks. */
  address: () => Promise<string | null>;
  /** Loads an address in the tab and waits for it; throws when it doesn't load. */
  navigate: (url: string) => Promise<void>;
  /** Gives the tab back; "stranded" means it is still in the small window. */
  release: () => Promise<ReleaseOutcome>;
  /** Packs the captures into one file and saves it; returns the filename. Called only if any exist. */
  save: () => Promise<string>;
  /** Tells the user the run is over. `failed` is true when it saved less than was asked. */
  announce: (failed: boolean) => void;
  /**
   * One capture, kept in the run's set, for its device or breakpoint and, in a run with languages,
   * the language it records. The page has the last word on its width.
   */
  capture: (item: RunWidth, language?: PageLanguage) => Promise<CaptureResult>;
  /** The width the page is laid out at; null when it can't be read. */
  pageWidth: () => Promise<number | null>;
  /** Pages re-lay out on resize: this gives them time. */
  settle: () => Promise<void>;
  onStatus: (status: RunStatus) => void;
};

type Final = RunStatus & { state: "viewport-done" };

/** One sweep of the widths: the page as it is, or one other language loaded in the tab. */
type Pass = { items: RunWidth[]; language?: PageLanguage; load: boolean };

const WINDOW_CLOSED = "The window was closed, so the run stopped.";
const LEFT_PAGE = "The page changed address, so the run stopped.";
const NO_ADDRESS = "The page's address couldn't be read, so the run stopped.";
const NOT_MOVED = "The tab couldn't be moved, so the run stopped.";
const STRANDED = "Your tab couldn't be moved back. It's in the small window.";
const notSaved = (reason: string) => `The file couldn't be saved: ${friendlyError(reason)}`;
const WENT_WRONG = "Something went wrong, so the run stopped.";
const held = (width: number) =>
  `The page stayed at ${width} when the window was resized, so the run stopped. Turn off the device toolbar in Developer Tools and capture again.`;
const noRoom = (width: number) => `${width} didn't fit in the file, so the run stopped there.`;
const notLoaded = (language: PageLanguage) =>
  `${language.name} couldn't be loaded, so it was left out.`;

/** The narrowest width a window is asked for. */
const MIN_WIDTH = 120;

/** How far the window moves to see whether the page follows it. */
const PROBE_PX = 40;

/** What a capture is called while it runs and in the file: its device, or its breakpoint. */
const nameOf = (item: RunWidth): string | undefined => item.device?.name ?? item.breakpoint;

/** What progress and the saved list call a capture: in a run with languages, its language too. */
const tagged = (name: string, language?: PageLanguage) =>
  language ? `${name} · ${language.name}` : name;

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The run's sweeps: the page as it is first, with every width, then each other language at the
 * device widths only. Languages on the page's own site go before those on another, because leaving
 * the site loses the access the toolbar click gave for it.
 */
function planPasses(widths: RunWidth[], languages: PageLanguage[] | undefined): Pass[] {
  const current = languages?.find((l) => l.current);
  if (!languages || !current) return [{ items: widths, load: false }];
  const devices = widths.filter((w) => !w.breakpoint);
  // With no device ticked there is nothing to capture another language at.
  if (devices.length === 0) return [{ items: widths, language: current, load: false }];
  const site = originOf(current.url);
  const others = languages.filter((l) => l !== current);
  const ordered = [
    ...others.filter((l) => originOf(l.url) === site),
    ...others.filter((l) => originOf(l.url) !== site),
  ];
  return [
    { items: widths, language: current, load: false },
    ...ordered.map((language) => ({ items: devices, language, load: true })),
  ];
}

/** Lists a width the page had instead of the one asked, once: each language repeats the widths. */
function mismatch(done: Final, requested: number, width: number): void {
  if (!done.mismatched.some((m) => m.requested === requested && m.width === width)) {
    done.mismatched.push({ requested, width });
  }
}

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

  /**
   * Resolves when the run has finished, the tab is back and the file is saved. Plain widths are
   * what a run from an older build asked; they are labelled with the width the page had.
   */
  start(
    widths: (number | RunWidth)[],
    options: {
      collapseWrappers?: boolean;
      versionLabel?: string;
      themes?: { light: boolean; dark: boolean };
      /** The languages to capture, current first; more than one, or the run is of the page as it is. */
      languages?: PageLanguage[];
    } = {}
  ): Promise<void> {
    if (this.running) throw new Error(RUN_BUSY);
    this.running = true;
    this.cancelled = false;
    this.status = { state: "idle" };
    const items = widths.map((w): RunWidth => (typeof w === "number" ? { width: w } : { ...w }));
    const named = items.some((w) => w.device || w.breakpoint);
    const languages =
      options.languages && options.languages.length > 1
        ? options.languages.map((l) => ({ ...l }))
        : undefined;
    return this.drive(items, languages, {
      widths: items.map((w) => w.width),
      ...(named ? { runWidths: items.map((w) => ({ ...w })) } : {}),
      collapseWrappers: options.collapseWrappers === true,
      versionLabel: options.versionLabel ?? "",
      ...(options.themes ? { themes: { ...options.themes } } : {}),
      ...(languages ? { languages: languages.map((l) => ({ ...l })) } : {}),
    });
  }

  /** Takes effect between widths: a capture in progress finishes and is kept. */
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

  private async drive(
    widths: RunWidth[],
    languages: PageLanguage[] | undefined,
    request: Final["request"]
  ): Promise<void> {
    const asked = [...widths].sort((a, b) => b.width - a.width);
    const passes = planPasses(asked, languages);
    const total = passes.reduce((sum, pass) => sum + pass.items.length, 0);
    const done: Final = {
      state: "viewport-done",
      saved: [],
      mismatched: [],
      skipped: [],
      nodes: 0,
      nodeLimit: false,
      blockedImages: 0,
      request,
    };
    try {
      if (asked.length > 0) await this.withTab(passes, total, done);
    } finally {
      this.running = false;
      try {
        this.set(done);
      } catch {
        // The status is already held for the popup's next open.
      }
      try {
        this.deps.announce(
          done.saved.length < total || done.stopped?.startsWith(STRANDED) === true
        );
      } catch {
        // The status is the record; a missed announcement loses nothing.
      }
    }
  }

  /**
   * Every way out of the sweeps passes through here, so the tab always goes back, to the address it
   * began at when languages were loaded in it, then the file is saved.
   */
  private async withTab(passes: Pass[], total: number, done: Final): Promise<void> {
    const home = await this.origin();
    const loads = passes.some((pass) => pass.load);
    const start = loads ? await this.address() : null;
    if (home === null) {
      done.stopped = LEFT_PAGE;
      return;
    }
    if (loads && start === null) {
      // Without it the tab couldn't be sent back after the languages, so none is loaded.
      done.stopped = NO_ADDRESS;
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
      const [first] = passes;
      this.set({
        state: "viewport",
        index: 1,
        total,
        label: tagged(nameOf(first.items[0]) ?? String(first.items[0].width), first.language),
      });
      // Every capture of a run with languages records where it began, so the import keeps the
      // languages of one page together.
      const based =
        start === null
          ? passes
          : passes.map((pass) =>
              pass.language ? { ...pass, language: { ...pass.language, base: start } } : pass
            );
      const stopped = await this.sweeps(based, total, home, done);
      if (stopped) done.stopped = stopped;
    } catch {
      done.stopped = WENT_WRONG;
    } finally {
      if (start !== null) await this.goBack(start);
      try {
        stranded = (await this.deps.release()) === "stranded";
      } catch {
        stranded = true;
      }
    }
    let saveFailure: string | undefined;
    if (done.saved.length > 0) {
      try {
        done.filename = await this.deps.save();
      } catch (error) {
        // Nothing was saved, so nothing about the file is left to advise on.
        done.saved = [];
        done.mismatched = [];
        done.nodes = 0;
        done.nodeLimit = false;
        done.blockedImages = 0;
        saveFailure = notSaved(messageOf(error));
        done.stopped = saveFailure;
      }
    }
    if (stranded) done.stopped = saveFailure ? `${STRANDED} ${saveFailure}` : STRANDED;
  }

  /** The width Chrome gave; "closed" when the window is gone, "refused" when it won't take it. */
  private async resized(width: number): Promise<number | "closed" | "refused"> {
    try {
      return await this.deps.resize(width);
    } catch {
      return (await this.windowOpen()) ? "refused" : "closed";
    }
  }

  /** Runs each pass in turn; a language that can't be loaded is left out and the rest go on. */
  private async sweeps(
    passes: Pass[],
    total: number,
    home: string,
    done: Final
  ): Promise<string | undefined> {
    let offset = 0;
    for (const pass of passes) {
      if (this.stopping(done)) return undefined;
      const page = pass.load && pass.language ? await this.load(pass.language) : home;
      if (page === null) {
        if (pass.language) done.leftOut = [...(done.leftOut ?? []), notLoaded(pass.language)];
      } else {
        const stopped = await this.sweep(pass, page, done, { offset, total });
        if (stopped) return stopped;
      }
      offset += pass.items.length;
    }
    return undefined;
  }

  /**
   * Loads a language in the tab; its page, which that pass's captures must stay on, or null when it
   * didn't load or landed on another site (a redirect within its own site is fine).
   */
  private async load(language: PageLanguage): Promise<string | null> {
    try {
      await this.deps.navigate(language.url);
    } catch {
      return null;
    }
    await this.deps.settle();
    const address = await this.address();
    if (address === null || originOf(address) !== originOf(language.url)) return null;
    return this.origin();
  }

  /** Sends the tab back to where the run began, if it isn't there; the release goes ahead anyway. */
  private async goBack(start: string): Promise<void> {
    try {
      if ((await this.address()) !== start) await this.deps.navigate(start);
    } catch {
      // The tab is given back wherever it is.
    }
  }

  /** Returns why it stopped early, if something went wrong. */
  private async sweep(
    { items, language }: Pass,
    home: string,
    done: Final,
    count: { offset: number; total: number }
  ): Promise<string | undefined> {
    // Window width to the width its capture really had, to tell which requests are repeats.
    const seen = new Map<number, number>();
    for (const [index, item] of items.entries()) {
      const requested = item.width;
      if (this.stopping(done)) return undefined;
      const given = await this.resized(requested);
      if (given === "closed") return WINDOW_CLOSED;
      if (given === "refused") {
        if (!done.skipped.includes(requested)) done.skipped.push(requested);
        continue;
      }
      const repeat = seen.get(given);
      if (repeat !== undefined) {
        if (repeat !== requested) mismatch(done, requested, repeat);
        continue;
      }
      this.set({
        state: "viewport",
        index: count.offset + index + 1,
        total: count.total,
        label: tagged(nameOf(item) ?? String(given), language),
      });
      await this.deps.settle();
      if (this.stopping(done)) return undefined;
      if ((await this.origin()) !== home) return this.whyGone();
      const stuck = await this.heldAt(given);
      if (typeof stuck === "string") return stuck;
      if ("at" in stuck) return held(stuck.at);
      const result = await this.deps
        .capture(item, language)
        .catch((error): CaptureResult => ({ ok: false, message: messageOf(error) }));
      if (!result.ok) {
        if ((await this.origin()) !== home) return this.whyGone();
        return result.message === NO_ROOM ? noRoom(given) : friendlyError(result.message);
      }
      const label = result.label ?? String(result.width);
      // The laid-out width, scrollbar included, so a scrollbar is not a mismatch: a plain width's
      // label is that width, and a named capture's is the page's width read before it.
      const real = nameOf(item) ? (stuck.page ?? given) : Number.parseInt(label, 10);
      seen.set(given, real);
      if (real !== requested) mismatch(done, requested, real);
      done.saved.push({ label: tagged(label, language), width: result.width });
      done.nodes = Math.max(done.nodes, result.nodes);
      done.nodeLimit ||= result.nodeLimit;
      done.blockedImages = Math.max(done.blockedImages, result.blockedImages);
    }
    return undefined;
  }

  /**
   * Whether the page is held at one width, or why the run must stop; when it follows the window,
   * the width it is laid out at (null when that can't be read).
   * Device mode keeps a page at its own width whatever the window does, and then every width would
   * save the same file. A page narrower than its window can also just share it with docked
   * Developer Tools, so moving the window tells them apart.
   */
  private async heldAt(
    windowWidth: number
  ): Promise<{ at: number } | { page: number | null } | string> {
    const width = await this.pageWidth();
    if (width === null || width === windowWidth) return { page: width };
    const probe =
      windowWidth - PROBE_PX >= MIN_WIDTH ? windowWidth - PROBE_PX : windowWidth + PROBE_PX;
    const moved = await this.resized(probe);
    if (moved === "closed") return WINDOW_CLOSED;
    // A probe Chrome refuses can't tell the cases apart, so the capture goes ahead.
    if (moved === "refused") return { page: width };
    await this.deps.settle();
    if ((await this.pageWidth()) === width) return { at: width };
    if ((await this.resized(windowWidth)) === "closed") return WINDOW_CLOSED;
    await this.deps.settle();
    // Back at the window's width, the page is laid out as it was first read.
    return { page: width };
  }

  private address(): Promise<string | null> {
    return this.deps.address().catch(() => null);
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
