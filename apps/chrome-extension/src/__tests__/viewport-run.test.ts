import { describe, expect, test } from "bun:test";
import type { RunStatus } from "../capture-run";
import {
  CaptureGate,
  type CaptureResult,
  MIN_WINDOW_WIDTH,
  resizeWindow,
  restoreWindow,
  ViewportRun,
  type WindowState,
  type WindowsApi,
} from "../viewport-run";

const ORIGIN = "https://example.com";

/** A stand-in for `chrome.windows`, narrowing at 500 px as Chrome does on macOS. */
function fakeWindows(start: Omit<WindowState, "windowId"> & { maxWidth?: number }) {
  const win = { ...start };
  const updates: Record<string, unknown>[] = [];
  const state = {
    closed: false,
    updates,
    win,
    api: {
      get: async () => {
        if (state.closed) throw new Error("No window with id: 1.");
        return { ...win, windowId: 1 };
      },
      update: async (_id, info) => {
        if (state.closed) throw new Error("No window with id: 1.");
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
  origin?: () => string | null;
  capture?: (label: string, run: ViewportRun, count: number) => Promise<CaptureResult> | null;
  /** Width lost to something beside the page, such as a classic scrollbar. */
  scrollbar?: number;
  onStatus?: (status: RunStatus) => void;
};

function setup(over: Over = {}) {
  const fake = fakeWindows({
    state: over.state ?? "normal",
    width: 1728,
    height: 1000,
    left: 10,
    top: 25,
    maxWidth: over.maxWidth,
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
    resize: async (width) => {
      events.push(`resize ${width}`);
      return resizeWindow(fake.api, 1, width);
    },
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
