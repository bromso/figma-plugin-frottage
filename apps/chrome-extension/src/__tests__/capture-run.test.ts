import { beforeEach, describe, expect, test } from "bun:test";
import { CaptureRun, type RunDeps, type RunStatus } from "../capture-run";
import { splitIntoChunks } from "../chunks";

const CAPTURE = { source: { url: "https://example.com/p" } };

function setup(over: Partial<RunDeps> = {}) {
  const statuses: RunStatus[] = [];
  const downloads: Array<{ url: string; filename: string }> = [];
  const revoked: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  const deps: RunDeps = {
    parse: (text) => JSON.parse(text),
    pack: () => new Uint8Array([1, 2, 3]),
    makeBlobUrl: () => "blob:test/1",
    revokeUrl: (u) => revoked.push(u),
    download: async (req) => {
      downloads.push(req);
    },
    report: (s) => statuses.push(s),
    setTimer: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    clearTimer: (h) => timers.delete(h as number),
    now: () => new Date(2026, 9, 31, 12),
    timeoutMs: 60_000,
    ...over,
  };
  const fire = () => {
    const [id, t] = [...timers.entries()][0] ?? [];
    if (id === undefined || !t) throw new Error("no timer");
    timers.delete(id);
    t.fn();
  };
  return { run: new CaptureRun(deps), statuses, downloads, revoked, timers, fire };
}

const last = (s: RunStatus[]) => s[s.length - 1];
const sendCapture = (run: CaptureRun, runId: string, text = JSON.stringify(CAPTURE), size = 20) => {
  const chunks = splitIntoChunks(text, size);
  chunks.forEach((data, index) => {
    run.onChunk(runId, {
      type: "chunk",
      kind: "capture",
      key: "capture",
      index,
      total: chunks.length,
      data,
    });
  });
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CaptureRun", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.run.start("r1", 7);
  });

  test("happy path: chunks, end, pack, download with the page's hostname", async () => {
    sendCapture(t.run, "r1");
    t.run.onEnd("r1");
    await tick();
    expect(t.downloads).toEqual([
      { url: "blob:test/1", filename: "example.com-2026-10-31.frottage" },
    ]);
    expect(last(t.statuses)).toEqual({
      state: "saved",
      filename: "example.com-2026-10-31.frottage",
    });
    expect(t.revoked).toEqual(["blob:test/1"]);
    expect(t.timers.size).toBe(0);
  });

  test("a 60 s no-progress timeout reports an error, and chunks restart it", () => {
    expect(t.timers.size).toBe(1);
    expect([...t.timers.values()][0]?.ms).toBe(60_000);
    t.run.onChunk("r1", {
      type: "chunk",
      kind: "capture",
      key: "capture",
      index: 0,
      total: 2,
      data: "{",
    });
    expect(t.timers.size).toBe(1);
    t.fire();
    expect(last(t.statuses)).toMatchObject({ state: "error" });
    expect((last(t.statuses) as { message: string }).message).toMatch(/no progress|timed out/i);
  });

  test("port closing before the end reports an error", () => {
    t.run.onChunk("r1", {
      type: "chunk",
      kind: "capture",
      key: "capture",
      index: 0,
      total: 2,
      data: "{",
    });
    t.run.onPortClosed("r1");
    expect(last(t.statuses)).toMatchObject({ state: "error" });
    expect(t.timers.size).toBe(0);
  });

  test("port closing after completion is ignored", async () => {
    sendCapture(t.run, "r1");
    t.run.onEnd("r1");
    await tick();
    t.run.onPortClosed("r1");
    expect(last(t.statuses)).toMatchObject({ state: "saved" });
  });

  test("navigation of the captured tab reports an error; other tabs are ignored", () => {
    t.run.onTabEvent(99);
    expect(last(t.statuses)).toMatchObject({ state: "capturing" });
    t.run.onTabEvent(7);
    expect(last(t.statuses)).toMatchObject({ state: "error" });
    expect((last(t.statuses) as { message: string }).message).toMatch(/navigat|closed/i);
  });

  test("a page error is reported", () => {
    t.run.onPageError("r1", "boom");
    expect(last(t.statuses)).toEqual({ state: "error", message: expect.stringContaining("boom") });
  });

  test("end before the capture is complete is an error", () => {
    t.run.onEnd("r1");
    expect(last(t.statuses)).toMatchObject({ state: "error" });
  });

  test("invalid capture reports an error", async () => {
    t.run.onChunk("r1", {
      type: "chunk",
      kind: "capture",
      key: "capture",
      index: 0,
      total: 1,
      data: "not json",
    });
    t.run.onEnd("r1");
    await tick();
    expect(last(t.statuses)).toMatchObject({ state: "error" });
    expect(t.downloads).toEqual([]);
  });

  test("a failed download reports an error and revokes the URL", async () => {
    const f = setup({
      download: async () => {
        throw new Error("disk full");
      },
    });
    f.run.start("r2", 1);
    sendCapture(f.run, "r2");
    f.run.onEnd("r2");
    await tick();
    expect(last(f.statuses)).toEqual({
      state: "error",
      message: expect.stringContaining("disk full"),
    });
    expect(f.revoked).toEqual(["blob:test/1"]);
  });

  test("messages from another run are ignored", () => {
    t.run.onPageError("other", "boom");
    t.run.onPortClosed("other");
    expect(last(t.statuses)).toMatchObject({ state: "capturing" });
  });

  test("asset chunks are rejected until assets are supported", () => {
    t.run.onChunk("r1", { type: "chunk", kind: "asset", key: "ab", index: 0, total: 1, data: "x" });
    expect(last(t.statuses)).toMatchObject({ state: "error" });
  });

  test("a second start while running is refused", () => {
    expect(() => t.run.start("r2", 1)).toThrow(/already/i);
  });
});
