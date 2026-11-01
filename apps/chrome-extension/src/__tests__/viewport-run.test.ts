import { describe, expect, test } from "bun:test";
import { NO_ROOM, type RunStatus } from "../capture-run";
import { pageOrigin } from "../page";
import type { ReleaseOutcome } from "../tab-hold";
import {
  CaptureGate,
  type CaptureResult,
  resizeWindow,
  startRefusal,
  ViewportRun,
  type WindowsApi,
} from "../viewport-run";

const ORIGIN = "https://example.com";

/** A stand-in for `chrome.windows`: Chrome keeps a window at 120 or wider, and at most `maxWidth`. */
function fakeWindows(start: { width: number; maxWidth?: number }) {
  const win = { width: start.width };
  const state = {
    closed: false,
    /** Refuses every resize while the window stays open. */
    refuseAll: false,
    /** Refuses just these widths, as Chrome does for one it can't give. */
    refuse: new Set<number>(),
    win,
    api: {
      get: async () => {
        if (state.closed) throw new Error("No window with id: 1.");
        return { width: win.width };
      },
      update: async (_id, info) => {
        if (state.closed) throw new Error("No window with id: 1.");
        if (state.refuseAll || state.refuse.has(info.width as number))
          throw new Error("Invalid value for bounds.");
        win.width = Math.min(Math.max(info.width as number, 120), start.maxWidth ?? 9999);
      },
    } satisfies WindowsApi,
  };
  return state;
}

type Over = {
  maxWidth?: number;
  width?: number;
  settle?: () => Promise<void>;
  origin?: () => string | null;
  capture?: (label: string, run: ViewportRun, count: number) => Promise<CaptureResult> | null;
  /** Width lost to something beside the page, such as a classic scrollbar. */
  scrollbar?: number;
  /** The page's width for a window width; by default the page fills the window. */
  pageWidth?: (windowWidth: number) => number | null;
  onStatus?: (status: RunStatus) => void;
  /** The widths Chrome refuses, with the window still open. */
  refuse?: number[];
  nodes?: (count: number) => number;
  hold?: () => Promise<void>;
  release?: ReleaseOutcome | (() => Promise<ReleaseOutcome>);
  save?: () => Promise<string>;
};

function setup(over: Over = {}) {
  const fake = fakeWindows({ width: over.width ?? 1728, maxWidth: over.maxWidth });
  const statuses: RunStatus[] = [];
  const captures: string[] = [];
  const events: string[] = [];
  const announced: boolean[] = [];
  for (const width of over.refuse ?? []) fake.refuse.add(width);
  const run: ViewportRun = new ViewportRun({
    origin: async () => (over.origin ? over.origin() : ORIGIN),
    hold: async () => {
      events.push("hold");
      await over.hold?.();
    },
    resize: async (width) => {
      events.push(`resize ${width}`);
      return resizeWindow(fake.api, 1, width);
    },
    windowOpen: () => fake.api.get().then(() => true),
    release: async () => {
      events.push("release");
      if (typeof over.release === "function") return over.release();
      return over.release ?? "back";
    },
    save: async () => {
      events.push("save");
      return over.save ? over.save() : "example.com.frottage";
    },
    announce: (failed) => {
      events.push("announce");
      announced.push(failed);
    },
    capture: async () => {
      const label = String(fake.win.width);
      captures.push(label);
      const scripted = over.capture?.(label, run, captures.length);
      if (scripted) return scripted;
      return {
        ok: true,
        label,
        width: Number(label) - (over.scrollbar ?? 0),
        nodes: over.nodes?.(captures.length) ?? 0,
        nodeLimit: false,
        blockedImages: 0,
      };
    },
    pageWidth: async () => {
      const width = fake.win.width;
      return over.pageWidth ? over.pageWidth(width) : width;
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
  return { run, fake, statuses, captures, events, announced, final };
}

const put = (label: string) => ({ label, width: Number(label) });

describe("ViewportRun", () => {
  test("widths run widest first, whatever order they were ticked in", async () => {
    const t = setup();
    await t.run.start([834, 1512, 1440]);
    expect(t.captures).toEqual(["1512", "1440", "834"]);
    expect(t.final().saved).toEqual([put("1512"), put("1440"), put("834")]);
    expect(t.final().stopped).toBeUndefined();
    expect(t.final().mismatched).toEqual([]);
  });

  test("a first status shows progress once the tab is held, then each width", async () => {
    const t = setup();
    await t.run.start([1512, 1440, 834]);
    expect(t.statuses.slice(0, 4)).toEqual([
      { state: "viewport", index: 1, total: 3, label: "1512" },
      { state: "viewport", index: 1, total: 3, label: "1512" },
      { state: "viewport", index: 2, total: 3, label: "1440" },
      { state: "viewport", index: 3, total: 3, label: "834" },
    ]);
  });

  test("widths from 120 run, and none is skipped as narrow", async () => {
    const t = setup();
    await t.run.start([1440, 393, 120]);
    expect(t.captures).toEqual(["1440", "393", "120"]);
    expect(t.final().saved).toEqual([put("1440"), put("393"), put("120")]);
    expect(t.final()).not.toHaveProperty("narrow");
  });

  test("one file is saved once, after the tab is back", async () => {
    const t = setup();
    await t.run.start([1512, 1440]);
    expect(t.events.slice(-3)).toEqual(["release", "save", "announce"]);
    expect(t.events.filter((e) => e === "save")).toHaveLength(1);
    expect(t.final().filename).toBe("example.com.frottage");
    expect(t.announced).toEqual([false]);
  });

  test("a stopped run saves what it captured and says why", async () => {
    const t = setup({
      capture: (_label, _run, count) =>
        count === 2 ? Promise.resolve({ ok: false, message: "The page broke" }) : null,
    });
    await t.run.start([1512, 1440, 834]);
    expect(t.events.filter((e) => e === "save")).toHaveLength(1);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The page broke");
    expect(t.announced).toEqual([true]);
  });

  test("Cancel saves what it captured", async () => {
    const t = setup({
      capture: (_label, run, count) => {
        if (count === 1) run.cancel();
        return null;
      },
    });
    await t.run.start([1512, 1440]);
    expect(t.events.filter((e) => e === "save")).toHaveLength(1);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().cancelled).toBe(true);
    expect(t.final().filename).toBe("example.com.frottage");
  });

  test("nothing captured saves nothing", async () => {
    const t = setup({ capture: () => Promise.resolve({ ok: false, message: "The page broke" }) });
    await t.run.start([1512]);
    expect(t.events).not.toContain("save");
    expect(t.final().filename).toBeUndefined();
    expect(t.final().saved).toEqual([]);
  });

  test("a size that doesn't fit stops the run and names it", async () => {
    const t = setup({
      capture: (_label, _run, count) =>
        count === 2 ? Promise.resolve({ ok: false, message: NO_ROOM }) : null,
    });
    await t.run.start([1512, 834, 390]);
    expect(t.captures).toEqual(["1512", "834"]);
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("834 didn't fit in the file, so the run stopped there.");
  });

  test("a failed save is reported with its cause, the tab is still back, and nothing is advised about the file", async () => {
    const t = setup({
      maxWidth: 1400,
      save: () => Promise.reject(new Error("disk full")),
      nodes: () => 12_000,
      capture: (label) =>
        Promise.resolve({
          ok: true,
          label,
          width: Number(label),
          nodes: 12_000,
          nodeLimit: true,
          blockedImages: 4,
        }),
    });
    await t.run.start([1512]);
    expect(t.events.slice(-3)).toEqual(["release", "save", "announce"]);
    expect(t.final().stopped).toBe("The file couldn't be saved: disk full");
    expect(t.final().filename).toBeUndefined();
    expect(t.final()).toMatchObject({
      saved: [],
      mismatched: [],
      blockedImages: 0,
      nodes: 0,
      nodeLimit: false,
    });
    expect(t.announced).toEqual([true]);
  });

  test("a refused hold stops the run and saves nothing", async () => {
    const t = setup({ hold: () => Promise.reject(new Error("Tabs can't be edited right now.")) });
    await t.run.start([1512, 1440]);
    expect(t.captures).toEqual([]);
    expect(t.events).toEqual(["hold", "announce"]);
    expect(t.final().stopped).toBe("The tab couldn't be moved, so the run stopped.");
    expect(t.final().saved).toEqual([]);
    expect(t.announced).toEqual([true]);
  });

  test("a stranded tab says so above any other reason, and announce reports a failure", async () => {
    const t = setup({
      release: "stranded",
      capture: (_label, _run, count) =>
        count === 1 ? Promise.resolve({ ok: false, message: "The page broke" }) : null,
    });
    await t.run.start([1512, 1440]);
    expect(t.final().stopped).toBe("Your tab couldn't be moved back. It's in the small window.");
    expect(t.announced).toEqual([true]);
  });

  test("a stranded tab is a failure even when every size was saved", async () => {
    const t = setup({ release: "stranded" });
    await t.run.start([1512, 1440]);
    expect(t.final().saved).toHaveLength(2);
    expect(t.announced).toEqual([true]);
  });

  test("a window closed during the page-width probe gives the closed-window message", async () => {
    const t = setup({
      pageWidth: () => {
        t.fake.closed = true;
        return 390;
      },
    });
    await t.run.start([1512]);
    expect(t.final().stopped).toBe("The window was closed, so the run stopped.");
  });

  test("no widths ends at once and moves nothing", async () => {
    const t = setup();
    await t.run.start([]);
    expect(t.events).toEqual(["announce"]);
    expect(t.final().saved).toEqual([]);
    expect(t.run.running).toBe(false);
  });

  test("the largest layer count of any capture reaches the final status", async () => {
    const t = setup({ nodes: (count) => (count === 1 ? 12_000 : 3_000) });
    await t.run.start([1512, 1440]);
    expect(t.final().nodes).toBe(12_000);
  });

  test("a typed label's width is read from the label", async () => {
    const t = setup({
      capture: (label) =>
        Promise.resolve({
          ok: true,
          label: `${label} Dark`,
          width: 1512,
          nodes: 0,
          nodeLimit: false,
          blockedImages: 0,
        }),
    });
    await t.run.start([1512]);
    expect(t.final().mismatched).toEqual([]);
    expect(t.final().saved).toEqual([{ label: "1512 Dark", width: 1512 }]);
  });

  test("announce reports a failure when the run saved less than was asked", async () => {
    const t = setup({ maxWidth: 1400 });
    await t.run.start([1512, 1440]);
    expect(t.final().saved).toHaveLength(1);
    expect(t.announced).toEqual([true]);
  });

  test("the page settles after a resize and before its capture", async () => {
    const t = setup();
    await t.run.start([1440]);
    expect(t.events).toEqual(["hold", "resize 1440", "settle", "release", "save", "announce"]);
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
          nodes: 0,
          nodeLimit: false,
          blockedImages: 0,
        }),
    });
    await t.run.start([1440]);
    expect(t.final().saved).toEqual([put("1200")]);
    expect(t.final().mismatched).toEqual([{ requested: 1440, width: 1200 }]);
  });

  test("a page held at one width stops the run before any file is saved", async () => {
    const t = setup({ pageWidth: () => 390 });
    await t.run.start([1512, 1440, 834]);
    expect(t.captures).toEqual([]);
    expect(t.final().saved).toEqual([]);
    expect(t.final().stopped).toBe(
      "The page stayed at 390 when the window was resized, so the run stopped. Turn off the device toolbar in Developer Tools and capture again."
    );
  });

  test("a held page is found when the window is already at the first width", async () => {
    const t = setup({ width: 1512, pageWidth: () => 390 });
    await t.run.start([1512, 834]);
    expect(t.captures).toEqual([]);
    expect(t.final().stopped).toContain("390");
  });

  test("a held page is found at the narrowest width a window can take", async () => {
    const t = setup({ pageWidth: () => 390 });
    await t.run.start([500]);
    expect(t.captures).toEqual([]);
    expect(t.final().stopped).toContain("390");
  });

  test("a page narrower than its window but following it is captured at the window's width", async () => {
    const widths: (number | undefined)[] = [];
    const t = setup({
      pageWidth: (window) => window - 400,
      capture: () => {
        widths.push(t.fake.win.width);
        return null;
      },
    });
    await t.run.start([1512, 834]);
    expect(widths).toEqual([1512, 834]);
    expect(t.final().stopped).toBeUndefined();
  });

  test("a page that fills its window takes no extra resize", async () => {
    const t = setup();
    await t.run.start([1440]);
    expect(t.events).toEqual(["hold", "resize 1440", "settle", "release", "save", "announce"]);
  });

  test("a page width that can't be read does not stop the run", async () => {
    const t = setup({ pageWidth: () => null });
    await t.run.start([1440]);
    expect(t.captures).toEqual(["1440"]);
    expect(t.final().stopped).toBeUndefined();
  });

  test("a classic scrollbar is not a mismatch", async () => {
    const t = setup({ scrollbar: 15 });
    await t.run.start([1440]);
    expect(t.final().saved).toEqual([{ label: "1440", width: 1425 }]);
    expect(t.final().mismatched).toEqual([]);
  });

  test("two widths that land on the same real width capture once", async () => {
    const t = setup({ maxWidth: 1512 });
    await t.run.start([1512, 1600, 834]);
    expect(t.captures).toEqual(["1512", "834"]);
    expect(t.final().saved).toEqual([put("1512"), put("834")]);
    expect(t.final().mismatched).toEqual([{ requested: 1600, width: 1512 }]);
  });

  test("the window is back after a failed capture", async () => {
    const t = setup({
      capture: (_label, _run, count) =>
        count === 2 ? Promise.resolve({ ok: false, message: "The page broke" }) : null,
    });
    await t.run.start([1512, 1440, 834]);
    expect(t.captures).toEqual(["1512", "1440"]);
    expect(t.events).toContain("release");
    expect(t.final().saved).toEqual([put("1512")]);
    expect(t.final().stopped).toBe("The page broke");
  });

  test("a capture that throws stops the run the same way", async () => {
    const t = setup({ capture: () => Promise.reject(new Error("No reply")) });
    await t.run.start([1512]);
    expect(t.events).toContain("release");
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
    expect(t.final().stopped).toBe("The page changed address, so the run stopped.");
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
    expect(t.final().stopped).toBe("The page changed address, so the run stopped.");
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

  test("a refused width is skipped and the rest still capture", async () => {
    const t = setup({ refuse: [1512] });
    await t.run.start([1512, 1440, 834]);
    expect(t.captures).toEqual(["1440", "834"]);
    expect(t.final().skipped).toEqual([1512]);
    expect(t.final().stopped).toBeUndefined();
    expect(t.final().saved).toEqual([put("1440"), put("834")]);
    expect(t.announced).toEqual([true]);
  });

  test("every width refused saves nothing and says so", async () => {
    const t = setup({ refuse: [1512, 1440] });
    await t.run.start([1512, 1440]);
    expect(t.events).not.toContain("save");
    expect(t.final().skipped).toEqual([1512, 1440]);
    expect(t.final().saved).toEqual([]);
    expect(t.events).toContain("release");
    expect(t.announced).toEqual([true]);
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

  test("a settle that rejects still gives the tab back, ends the run and reports", async () => {
    const t = setup({ settle: () => Promise.reject(new Error("timer gone")) });
    await t.run.start([1512, 1440]);
    expect(t.events).toContain("release");
    expect(t.run.running).toBe(false);
    expect(t.final().stopped).toBe("Something went wrong, so the run stopped.");
  });

  test("an onStatus that throws still gives the tab back, ends the run and holds the status", async () => {
    const t = setup({
      onStatus: () => {
        throw new Error("no popup");
      },
    });
    await t.run.start([1512]);
    expect(t.events).toContain("release");
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
    expect(t.final().stopped).toBe("The page changed address, so the run stopped.");
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
    expect(t.final().stopped).toBe("The page changed address, so the run stopped.");
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

  test("Cancel between widths stops the sweep, gives the tab back and saves", async () => {
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
    expect(t.events).toContain("release");
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
  });

  test("size warnings from any file reach the final status", async () => {
    const t = setup({
      capture: (label, _run, count) =>
        Promise.resolve({
          ok: true,
          label,
          width: Number(label),
          nodes: 0,
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

describe("resizeWindow", () => {
  test("returns the width Chrome gave, not the one asked for", async () => {
    const fake = fakeWindows({ width: 1728 });
    expect(await resizeWindow(fake.api, 1, 100)).toBe(120);
  });
});

describe("CaptureGate", () => {
  const saved: RunStatus = {
    state: "saved",
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
      nodes: 3,
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
