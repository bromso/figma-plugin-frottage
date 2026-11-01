import { describe, expect, test } from "bun:test";
import type { RunStatus } from "../capture-run";
import { pageOrigin } from "../page";
import {
  CaptureGate,
  type CaptureResult,
  fittedLeft,
  MIN_WINDOW_WIDTH,
  resizeWindow,
  restoreWindow,
  startRefusal,
  ViewportRun,
  type WindowState,
  type WindowsApi,
} from "../viewport-run";

const ORIGIN = "https://example.com";

/** A stand-in for `chrome.windows`, narrowing at 500 px as Chrome does on macOS. */
function fakeWindows(
  start: Omit<WindowState, "windowId"> & { maxWidth?: number; screen?: number }
) {
  const win = { ...start };
  const updates: Record<string, unknown>[] = [];
  const state = {
    closed: false,
    /** Refuses every resize while the window stays open, whatever its bounds. */
    refuseAll: false,
    updates,
    win,
    api: {
      get: async () => {
        if (state.closed) throw new Error("No window with id: 1.");
        return { ...win, windowId: 1 };
      },
      update: async (_id, info) => {
        if (state.closed) throw new Error("No window with id: 1.");
        const left = (info.left as number | undefined) ?? win.left ?? 0;
        const width = (info.width as number | undefined) ?? win.width ?? 0;
        const onScreen = (start.screen ?? 9999) - left;
        const restoring = info.height !== undefined;
        if ((state.refuseAll && !restoring) || onScreen < width / 2) {
          throw new Error("Invalid value for bounds. Bounds must be at least 50% within screen.");
        }
        updates.push(info);
        Object.assign(win, info);
        win.width = Math.min(Math.max(win.width ?? 0, 500), start.maxWidth ?? 9999);
      },
    } satisfies WindowsApi,
  };
  return state;
}

type Over = {
  state?: string;
  maxWidth?: number;
  /** The screen's available width, with the window's own left and width in it. */
  screen?: number;
  left?: number;
  width?: number;
  settle?: () => Promise<void>;
  origin?: () => string | null;
  capture?: (label: string, run: ViewportRun, count: number) => Promise<CaptureResult> | null;
  /** Width lost to something beside the page, such as a classic scrollbar. */
  scrollbar?: number;
  onStatus?: (status: RunStatus) => void;
};

function setup(over: Over = {}) {
  const fake = fakeWindows({
    state: over.state ?? "normal",
    width: over.width ?? 1728,
    height: 1000,
    left: over.left ?? 10,
    top: 25,
    maxWidth: over.maxWidth,
    screen: over.screen,
  });
  const statuses: RunStatus[] = [];
  const captures: string[] = [];
  let saved: WindowState | null = null;
  const events: string[] = [];
  const run: ViewportRun = new ViewportRun({
    origin: async () => (over.origin ? over.origin() : ORIGIN),
    remember: async () => {
      saved = await fake.api.get();
    },
    resize: async (width, left) => {
      events.push(`resize ${width}`);
      return resizeWindow(fake.api, 1, width, left);
    },
    windowOpen: () => fake.api.get().then(() => true),
    screenWidth: () => over.screen ?? 1728,
    restore: async () => {
      events.push("restore");
      if (saved) await restoreWindow(fake.api, saved);
    },
    capture: async (label) => {
      captures.push(label);
      const scripted = over.capture?.(label, run, captures.length);
      if (scripted) return scripted;
      return {
        ok: true,
        label,
        width: Number(label) - (over.scrollbar ?? 0),
        nodeLimit: false,
        blockedImages: 0,
      };
    },
    settle: async () => {
      events.push("settle");
      await over.settle?.();
    },
    onStatus: (status) => {
      statuses.push(status);
      over.onStatus?.(status);
    },
  });
  const final = () => {
    const status = statuses[statuses.length - 1];
    if (status?.state !== "viewport-done") throw new Error("the run did not finish");
    return status;
  };
  return { run, fake, statuses, captures, events, final };
}

const put = (label: string) => ({ label, width: Number(label) });

describe("ViewportRun", () => {
  test("captures each width in order and saves one file each", async () => {
    const t = setup();
    await t.run.start([1512, 1440, 834]);
    expect(t.captures).toEqual(["1512", "1440", "834"]);
    expect(t.final().saved).toEqual([put("1512"), put("1440"), put("834")]);
    expect(t.statuses.slice(0, 3)).toEqual([
      { state: "viewport", index: 1, total: 3, label: "1512" },
      { state: "viewport", index: 2, total: 3, label: "1440" },
      { state: "viewport", index: 3, total: 3, label: "834" },
    ]);
    expect(t.final().stopped).toBeUndefined();
    expect(t.final().mismatched).toEqual([]);
  });

  test("the page settles after a resize and before its capture", async () => {
    const t = setup();
    await t.run.start([1440]);
    expect(t.events).toEqual(["resize 1440", "settle", "restore"]);
  });

  test("the window gets its whole state back, whatever the widths did", async () => {
    const t = setup();
    await t.run.start([1440, 834]);
    expect(t.fake.win).toMatchObject({
      state: "normal",
      width: 1728,
      height: 1000,
      left: 10,
      top: 25,
    });
  });

  test("a maximised window goes to normal, and comes back afterwards", async () => {
    const t = setup({ state: "maximized" });
    await t.run.start([1440]);
    expect(t.fake.updates[0]).toEqual({ state: "normal", width: 1440 });
    const last = t.fake.updates.at(-1);
    // The size goes back first; a maximised window would refuse it, and lose it for good.
    expect(t.fake.updates.at(-2)).toEqual({
      state: "normal",
      width: 1728,
      height: 1000,
      left: 10,
      top: 25,
    });
    expect(last).toEqual({ state: "maximized" });
    expect(t.fake.win.state).toBe("maximized");
  });

  test("the file is labelled with the real width, and a mismatch is listed", async () => {
    const t = setup({ maxWidth: 1400 });
    await t.run.start([1512, 834]);
    expect(t.captures).toEqual(["1400", "834"]);
    expect(t.final().saved).toEqual([put("1400"), put("834")]);
    expect(t.final().mismatched).toEqual([{ requested: 1512, width: 1400 }]);
  });

  test("the label is the page's own width, when it is not what the window said", async () => {
    const t = setup({
      capture: () =>
        Promise.resolve({
          ok: true,
          label: "1200",
          width: 1200,
          nodeLimit: false,
          blockedImages: 0,
        }),
    });
    await t.run.start([1440]);
    expect(t.final().saved).toEqual([put("1200")]);
    expect(t.final().mismatched).toEqual([{ requested: 1440, width: 1200 }]);
  });

  test("a classic scrollbar is not a mismatch", async () => {
    const t = setup({ scrollbar: 15 });
    await t.run.start([1440]);
    expect(t.final().saved).toEqual([{ label: "1440", width: 1425 }]);
    expect(t.final().mismatched).toEqual([]);
  });

  test("a width under 500 is not requested and is reported as needing DevTools", async () => {
    const t = setup();
    await t.run.start([1440, 393, 390]);
    expect(MIN_WINDOW_WIDTH).toBe(500);
    expect(t.fake.updates.some((u) => u.width === 393 || u.width === 390)).toBe(false);
    expect(t.captures).toEqual(["1440"]);
    expect(t.final().narrow).toEqual([393, 390]);
    expect(t.statuses[0]).toEqual({ state: "viewport", index: 1, total: 1, label: "1440" });
  });

  test("only narrow widths leave the window alone", async () => {
    const t = setup();
    await t.run.start([393]);
    expect(t.fake.updates).toEqual([]);
    expect(t.final()).toMatchObject({ saved: [], narrow: [393] });
    expect(t.run.running).toBe(false);
  });

  test("two widths that land on the same real width capture once", async () => {
    const t = setup({ maxWidth: 1512 });
    await t.run.start([1512, 1600, 834]);
    expect(t.captures).toEqual(["1512", "834"]);
    expect(t.final().saved).toEqual([put("1512"), put("834")]);
    expect(t.final().mismatched).toEqual([{ requested: 1600, width: 1512 }]);
  });

  test("the window is restored after a failed capture", async () => {
    const t = setup({
      capture: (_label, _run, count) =>
        count === 2 ? Promise.resolve({ ok: false, message: "The page broke" }) : null,
    });
    await t.run.start([1512, 1440, 834]);
    expect(t.captures).toEqual(["1512", "1440"]);
    expect(t.events.at(-1)).toBe("restore");
    expect(t.fake.win.width).toBe(1728);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The page broke");
  });

  test("a capture that throws stops the run the same way", async () => {
    const t = setup({ capture: () => Promise.reject(new Error("No reply")) });
    await t.run.start([1512]);
    expect(t.events.at(-1)).toBe("restore");
    expect(t.final().stopped).toBe("No reply");
  });

  test("a closed window stops the run, keeps saved files and says so", async () => {
    const t = setup({
      capture: (_label, _run, count) => {
        if (count === 1) t.fake.closed = true;
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
    expect(t.run.running).toBe(false);
  });

  test("a window closed before the run starts ends it plainly", async () => {
    const t = setup();
    t.fake.closed = true;
    await t.run.start([1512]);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
    expect(t.final().saved).toEqual([]);
  });

  test("a navigated tab stops the run the same way", async () => {
    let origin = ORIGIN;
    const t = setup({
      origin: () => origin,
      capture: (_label, _run, count) => {
        if (count === 1) origin = "https://elsewhere.example";
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.captures).toEqual(["1512"]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The tab left the page, so the run stopped.");
    expect(t.fake.win.width).toBe(1728);
  });

  test("moving to another page of the same site stops the run", async () => {
    let page = pageOrigin("https://example.com/a?one=1");
    const t = setup({
      origin: () => page,
      capture: () => {
        page = pageOrigin("https://example.com/b?one=1");
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.captures).toEqual(["1512"]);
    expect(t.final().stopped).toBe("The tab left the page, so the run stopped.");
  });

  test("a window closed during a capture says so, not that the tab left", async () => {
    let origin: string | null = ORIGIN;
    const t = setup({
      origin: () => origin,
      capture: () => {
        t.fake.closed = true;
        origin = null;
        return Promise.resolve({ ok: false, message: "The page closed" });
      },
    });
    await t.run.start([1512]);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
  });

  test("a window closed while the page settles says so too", async () => {
    let origin: string | null = ORIGIN;
    const t = setup({
      origin: () => origin,
      settle: async () => {
        t.fake.closed = true;
        origin = null;
      },
    });
    await t.run.start([1512]);
    expect(t.captures).toEqual([]);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
  });

  test("a resize refused for its bounds moves the window to fit, then puts it back", async () => {
    const t = setup({ screen: 1728, left: 1000, width: 800 });
    await t.run.start([1512]);
    expect(t.fake.updates[0]).toEqual({ state: "normal", width: 1512, left: 216 });
    expect(t.captures).toEqual(["1512"]);
    expect(t.final().stopped).toBeUndefined();
    expect(t.fake.win).toMatchObject({ left: 1000, width: 800 });
  });

  test("a resize refused twice stops plainly, and the window goes back", async () => {
    const t = setup({
      capture: () => {
        t.fake.refuseAll = true;
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The window couldn't be resized, so the run stopped.");
    expect(t.events.filter((e) => e === "resize 1440")).toHaveLength(2);
    expect(t.fake.win.width).toBe(1728);
  });

  test("a resize failing because the window closed is not retried", async () => {
    const t = setup({
      capture: () => {
        t.fake.closed = true;
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.events.filter((e) => e === "resize 1440")).toHaveLength(1);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
  });

  test("a settle that rejects still restores, ends the run and reports", async () => {
    const t = setup({ settle: () => Promise.reject(new Error("timer gone")) });
    await t.run.start([1512, 1440]);
    expect(t.events.at(-1)).toBe("restore");
    expect(t.fake.win.width).toBe(1728);
    expect(t.run.running).toBe(false);
    expect(t.final().stopped).toBe("Something went wrong, so the run stopped.");
  });

  test("an onStatus that throws still restores, ends the run and holds the status", async () => {
    const t = setup({
      onStatus: () => {
        throw new Error("no popup");
      },
    });
    await t.run.start([1512]);
    expect(t.events.at(-1)).toBe("restore");
    expect(t.fake.win.width).toBe(1728);
    expect(t.run.running).toBe(false);
    expect(t.run.take()).toMatchObject({
      state: "viewport-done",
      stopped: "Something went wrong, so the run stopped.",
    });
  });

  test("a tab whose origin can no longer be read counts as navigated", async () => {
    let origin: string | null = ORIGIN;
    const t = setup({
      origin: () => origin,
      capture: () => {
        origin = null;
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.final().stopped).toBe("The tab left the page, so the run stopped.");
  });

  test("a tab that navigates while the page settles is not captured", async () => {
    let origin = ORIGIN;
    const t = setup({
      origin: () => origin,
      onStatus: (status) => {
        if (status.state === "viewport") origin = "https://elsewhere.example";
      },
    });
    await t.run.start([1512]);
    expect(t.captures).toEqual([]);
    expect(t.final().stopped).toBe("The tab left the page, so the run stopped.");
  });

  test("a refused injection stops the run with a plain message", async () => {
    const t = setup({
      capture: () =>
        Promise.resolve({
          ok: false,
          message: "Could not start the capture: Cannot access contents of the page.",
        }),
    });
    await t.run.start([1512]);
    expect(t.final().stopped).toBe("This page can't be captured.");
  });

  test("Cancel between widths restores the window", async () => {
    const t = setup({
      capture: (_label, run, count) => {
        if (count === 1) run.cancel();
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.captures).toEqual(["1512"]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().cancelled).toBe(true);
    expect(t.final().stopped).toBeUndefined();
    expect(t.fake.win.width).toBe(1728);
  });

  test("Cancel while the page settles captures nothing more", async () => {
    const t = setup({
      onStatus: (status) => {
        if (status.state === "viewport") t.run.cancel();
      },
    });
    await t.run.start([1512]);
    expect(t.captures).toEqual([]);
    expect(t.final().cancelled).toBe(true);
    expect(t.fake.win.width).toBe(1728);
  });

  test("a window that can't be put back is reported", async () => {
    const t = setup({
      capture: () => {
        t.fake.closed = true;
        return null;
      },
    });
    await t.run.start([1512]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The window could not be put back as it was.");
  });

  test("size warnings from any file reach the final status", async () => {
    const t = setup({
      capture: (label, _run, count) =>
        Promise.resolve({
          ok: true,
          label,
          width: Number(label),
          nodeLimit: count === 1,
          blockedImages: count === 1 ? 2 : 3,
        }),
    });
    await t.run.start([1512, 1440]);
    expect(t.final()).toMatchObject({ nodeLimit: true, blockedImages: 3 });
  });

  test("a status survives the popup closing", async () => {
    const t = setup();
    await t.run.start([1440]);
    // Nothing read onStatus: the popup was closed. It asks on its next open.
    expect(t.run.take()).toMatchObject({ state: "viewport-done", saved: [put("1440")] });
    expect(t.run.take()).toEqual({ state: "idle" });
  });

  test("a popup that showed the final status clears it; an earlier one does not", async () => {
    const t = setup();
    await t.run.start([1440]);
    expect(t.run.acknowledge(t.statuses[0] as RunStatus)).toBeUndefined();
    expect(t.run.acknowledge(t.final())).toBe(t.final());
    expect(t.run.status).toEqual({ state: "idle" });
  });

  test("a second run is refused while one is going, and a later one starts clean", async () => {
    let second: unknown;
    const t = setup({
      capture: (_label, run, count) => {
        if (count === 1) {
          try {
            void run.start([834]);
          } catch (error) {
            second = error;
          }
        }
        return null;
      },
    });
    await t.run.start([1440]);
    expect(second).toBeInstanceOf(Error);
    t.run.take();
    t.statuses.length = 0;
    await t.run.start([1440]);
    expect(t.final().saved).toEqual([put("1440")]);
  });
});

describe("startRefusal", () => {
  const idle = { capturing: false, viewportRunning: false };

  test("a second run is refused while one is going, so it can't retarget the first", () => {
    expect(startRefusal("viewport", { ...idle, viewportRunning: true })).toBe(
      "A capture at several widths is already running"
    );
  });

  test("a run is refused during a plain capture", () => {
    expect(startRefusal("viewport", { ...idle, capturing: true })).toBe(
      "A capture is already running"
    );
  });

  test("a plain capture is refused during a run, the run's own captures are not", () => {
    const running = { ...idle, viewportRunning: true };
    expect(startRefusal("capture", running)).toBe("A capture at several widths is already running");
    expect(startRefusal("width", running)).toBeNull();
  });

  test("nothing is refused when nothing is running", () => {
    expect(startRefusal("capture", idle)).toBeNull();
    expect(startRefusal("viewport", idle)).toBeNull();
  });
});

describe("fittedLeft", () => {
  test("puts the window's right edge at the screen's", () => {
    expect(fittedLeft(1512, 1728)).toBe(216);
  });
  test("a window wider than the screen starts at its left edge", () => {
    expect(fittedLeft(2000, 1728)).toBe(0);
  });
});

describe("resizeWindow", () => {
  test("returns the width Chrome gave, not the one asked for", async () => {
    const fake = fakeWindows({ state: "normal", width: 1728, height: 900, left: 0, top: 0 });
    expect(await resizeWindow(fake.api, 1, 300)).toBe(500);
  });
});

describe("restoreWindow", () => {
  test("a normal window takes one call, and absent bounds are left out", async () => {
    const fake = fakeWindows({ state: "normal", width: 800, height: 900, left: 0, top: 0 });
    await restoreWindow(fake.api, { windowId: 1, state: "normal", width: 1000 });
    expect(fake.updates).toEqual([{ state: "normal", width: 1000 }]);
  });
});

describe("CaptureGate", () => {
  const saved: RunStatus = {
    state: "saved",
    filename: "a.frottage",
    nodes: 3,
    nodeLimit: true,
    blockedImages: 1,
    width: 1425,
    label: "1440",
  };

  test("holds a capture until its finished status arrives", async () => {
    const gate = new CaptureGate();
    let done = false;
    const result = gate
      .run(async () => ({ ok: true }))
      .then((r) => {
        done = true;
        return r;
      });
    expect(gate.offer({ state: "capturing" })).toBe(true);
    await Bun.sleep(0);
    expect(done).toBe(false);
    expect(gate.offer(saved)).toBe(true);
    expect(await result).toEqual({
      ok: true,
      width: 1425,
      label: "1440",
      nodeLimit: true,
      blockedImages: 1,
    });
  });

  test("an error status fails the capture", async () => {
    const gate = new CaptureGate();
    const result = gate.run(async () => ({ ok: true }));
    gate.offer({ state: "error", message: "No progress" });
    expect(await result).toEqual({ ok: false, message: "No progress" });
  });

  test("a start that is refused fails the capture", async () => {
    const gate = new CaptureGate();
    expect(await gate.run(async () => ({ ok: false, error: "Busy" }))).toEqual({
      ok: false,
      message: "Busy",
    });
    expect(await gate.run(async () => undefined)).toEqual({
      ok: false,
      message: "The capture could not start",
    });
    expect(await gate.run(() => Promise.reject(new Error("Gone")))).toEqual({
      ok: false,
      message: "Gone",
    });
  });

  test("with no capture held, a status belongs to the popup", () => {
    expect(new CaptureGate().offer(saved)).toBe(false);
  });
});
