import { beforeEach, describe, expect, test } from "bun:test";
import { CaptureRun, type RunDeps, type RunStatus } from "../capture-run";
import { assetChunks, splitIntoChunks } from "../chunks";

const CAPTURE = { source: { url: "https://example.com/p" }, assets: [] };

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
      return undefined;
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
    t.run.start("r1");
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

  test("disconnect before end (navigation, close, crash) reports an error", () => {
    t.run.onPortClosed("r1");
    expect(last(t.statuses)).toMatchObject({ state: "error" });
    expect((last(t.statuses) as { message: string }).message).toMatch(/closed or navigated/);
  });

  test("a heartbeat restarts the no-progress timer", () => {
    const before = [...t.timers.keys()][0];
    t.run.onHeartbeat("r1");
    expect(t.timers.size).toBe(1);
    expect([...t.timers.keys()][0]).not.toBe(before);
    expect(last(t.statuses)).toMatchObject({ state: "capturing" });
  });

  test("a finished status is handed out once, then cleared", async () => {
    t.run.onPageError("r1", "boom");
    const first = t.run.take();
    expect(first).toMatchObject({ state: "error" });
    expect(t.run.take()).toEqual({ state: "idle" });
  });

  test("a run saved while the popup is closed is still held", async () => {
    sendCapture(t.run, "r1");
    t.run.onEnd("r1");
    await tick();
    expect(t.run.take()).toEqual({ state: "saved", filename: "example.com-2026-10-31.frottage" });
    expect(t.run.take()).toEqual({ state: "idle" });
  });

  test("an acknowledged status is not held for the next open", () => {
    t.run.onPageError("r1", "boom");
    const status = t.run.status;
    expect(t.run.acknowledge(status)).toBe(status);
    expect(t.run.take()).toEqual({ state: "idle" });
  });

  test("a busy status is never cleared by take", () => {
    expect(t.run.take()).toEqual({ state: "capturing" });
    expect(t.run.take()).toEqual({ state: "capturing" });
  });

  test("the saved name is the basename Chrome reports", async () => {
    const f = setup({ download: async () => "example.com-2026-10-31 (1).frottage" });
    f.run.start("r3");
    sendCapture(f.run, "r3");
    f.run.onEnd("r3");
    await tick();
    expect(last(f.statuses)).toEqual({
      state: "saved",
      filename: "example.com-2026-10-31 (1).frottage",
    });
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
    f.run.start("r2");
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

  describe("assets", () => {
    const H1 = "a".repeat(64);
    const H2 = "b".repeat(64);
    const withAssets = (hashes: string[]) =>
      JSON.stringify({ ...CAPTURE, assets: hashes.map((hash) => ({ hash })) });
    const sendAsset = (run: CaptureRun, key: string, bytes: Uint8Array, step = 4) => {
      for (const c of assetChunks(bytes, step)) {
        run.onChunk("r1", { type: "chunk", kind: "asset", key, ...c });
      }
    };

    test("asset bytes are decoded and handed to pack by hash", async () => {
      const packed: Array<Map<string, Uint8Array>> = [];
      const f = setup({
        pack: (_c, assets) => {
          packed.push(assets);
          return new Uint8Array([1]);
        },
      });
      f.run.start("r1");
      sendAsset(f.run, H1, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      sendAsset(f.run, H2, new Uint8Array([9]));
      sendCapture(f.run, "r1", withAssets([H1, H2]));
      f.run.onEnd("r1");
      await tick();
      expect(last(f.statuses)).toMatchObject({ state: "saved" });
      expect([...(packed[0]?.keys() ?? [])]).toEqual([H1, H2]);
      expect(packed[0]?.get(H1)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    test("bytes the capture does not list are not packed", async () => {
      const packed: Array<Map<string, Uint8Array>> = [];
      const f = setup({
        pack: (_c, assets) => {
          packed.push(assets);
          return new Uint8Array([1]);
        },
      });
      f.run.start("r1");
      sendAsset(f.run, H1, new Uint8Array([1]));
      sendCapture(f.run, "r1", withAssets([]));
      f.run.onEnd("r1");
      await tick();
      expect(packed[0]?.size).toBe(0);
    });

    test("an asset key that is not a SHA-256 hash is rejected", () => {
      t.run.onChunk("r1", {
        type: "chunk",
        kind: "asset",
        key: "ab",
        index: 0,
        total: 1,
        data: "AAAA",
      });
      expect(last(t.statuses)).toMatchObject({ state: "error" });
    });

    test("a listed asset that never arrived fails the run", () => {
      sendCapture(t.run, "r1", withAssets([H1]));
      t.run.onEnd("r1");
      expect(last(t.statuses)).toMatchObject({
        state: "error",
        message: expect.stringContaining("image data"),
      });
    });

    test("an asset cut off mid-transfer fails the run", () => {
      t.run.onChunk("r1", {
        type: "chunk",
        kind: "asset",
        key: H1,
        index: 0,
        total: 2,
        data: "AAAA",
      });
      sendCapture(t.run, "r1", withAssets([]));
      t.run.onEnd("r1");
      expect(last(t.statuses)).toMatchObject({ state: "error" });
    });

    test("invalid base64 fails the run", () => {
      t.run.onChunk("r1", {
        type: "chunk",
        kind: "asset",
        key: H1,
        index: 0,
        total: 1,
        data: "!!!!",
      });
      expect(last(t.statuses)).toMatchObject({ state: "error" });
    });

    test("too many asset bytes fail the run", () => {
      const f = setup({ maxAssetBytes: 6 });
      f.run.start("r1");
      sendAsset(f.run, H1, new Uint8Array(5));
      expect(last(f.statuses)).toMatchObject({ state: "capturing" });
      sendAsset(f.run, H2, new Uint8Array(5));
      expect(last(f.statuses)).toMatchObject({ state: "error" });
    });

    test("asset chunks restart the no-progress timer", () => {
      t.run.onChunk("r1", {
        type: "chunk",
        kind: "asset",
        key: H1,
        index: 0,
        total: 2,
        data: "AAAA",
      });
      expect(t.timers.size).toBe(1);
    });
  });

  test("a second start while running is refused", () => {
    expect(() => t.run.start("r2")).toThrow(/already/i);
  });
});
