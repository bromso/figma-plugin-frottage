import { beforeEach, describe, expect, test } from "bun:test";
import type { Capture } from "@repo/capture-schema";
import { CaptureRun, type RunDeps, type RunStatus } from "../capture-run";
import { assetChunks, splitIntoChunks } from "../chunks";

const CAPTURE = {
  source: { url: "https://example.com/p", viewport: { w: 1440, h: 900 } },
  assets: [],
};

function setup(over: Partial<RunDeps> = {}) {
  const statuses: RunStatus[] = [];
  const kept: Array<{ capture: Capture; assets: Map<string, Uint8Array> }> = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  const deps: RunDeps = {
    parse: (text) => JSON.parse(text),
    keep: (capture, assets) => {
      kept.push({ capture, assets });
      return true;
    },
    report: (s) => statuses.push(s),
    setTimer: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    clearTimer: (h) => timers.delete(h as number),
    timeoutMs: 60_000,
    ...over,
  };
  const fire = () => {
    const [id, t] = [...timers.entries()][0] ?? [];
    if (id === undefined || !t) throw new Error("no timer");
    timers.delete(id);
    t.fn();
  };
  return { run: new CaptureRun(deps), statuses, kept, timers, fire };
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
const TOO_MUCH = "This page has too much content to capture. Try a smaller section.";
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("CaptureRun", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.run.start("r1");
  });

  test("a finished capture is handed to keep, then reported saved", async () => {
    sendCapture(t.run, "r1");
    t.run.onEnd("r1");
    await tick();
    expect(t.kept).toHaveLength(1);
    expect(t.kept[0]?.capture.source.url).toBe("https://example.com/p");
    expect(last(t.statuses)).toEqual({
      state: "saved",
      nodes: 0,
      nodeLimit: false,
      blockedImages: 0,
      width: 1440,
    });
    expect(t.timers.size).toBe(0);
  });

  test("keep returning false fails with: This size doesn't fit in the file.", async () => {
    const f = setup({ keep: () => false });
    f.run.start("r1");
    sendCapture(f.run, "r1");
    f.run.onEnd("r1");
    await tick();
    expect(last(f.statuses)).toEqual({
      state: "error",
      message: "This size doesn't fit in the file.",
    });
    expect(f.run.busy).toBe(false);
  });

  test("the saved status carries the count from the images-blocked warning", async () => {
    const warned = {
      ...CAPTURE,
      root: { kind: "element", children: [] },
      warnings: [
        { code: "image-blocked", detail: "Could not read x: Failed to fetch" },
        { code: "images-blocked", detail: "3 images could not be read" },
      ],
    };
    sendCapture(t.run, "r1", JSON.stringify(warned));
    t.run.onEnd("r1");
    await tick();
    expect(last(t.statuses)).toMatchObject({ state: "saved", blockedImages: 3 });
  });

  test("placeholders alone are not counted as blocked images", async () => {
    const blocked = { kind: "placeholder", placeholderKind: "blocked-image" };
    sendCapture(
      t.run,
      "r1",
      JSON.stringify({ ...CAPTURE, root: { kind: "element", children: [blocked] } })
    );
    t.run.onEnd("r1");
    await tick();
    expect(last(t.statuses)).toMatchObject({ state: "saved", blockedImages: 0 });
  });

  test("a run knows whether it is live for an id", () => {
    expect(t.run.isLive("r1")).toBe(true);
    expect(t.run.isLive("other")).toBe(false);
    sendCapture(t.run, "r1");
    t.run.onEnd("r1");
    expect(t.run.isLive("r1")).toBe(false);
  });

  test("the saved status carries the node count and whether the node limit was hit", async () => {
    const leaf = { kind: "text" };
    const tree = { kind: "element", children: [leaf, { kind: "element", children: [leaf] }] };
    const limited = {
      ...CAPTURE,
      root: tree,
      warnings: [{ code: "node-limit", nodeId: "", detail: "x" }],
    };
    sendCapture(t.run, "r1", JSON.stringify(limited));
    t.run.onEnd("r1");
    await tick();
    expect(last(t.statuses)).toMatchObject({ state: "saved", nodes: 4, nodeLimit: true });
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
    expect(t.run.take()).toMatchObject({
      state: "saved",
    });
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
    expect(t.kept).toEqual([]);
  });

  test("capture JSON over the import limit fails with a plain message and packs nothing", async () => {
    const big = setup({ maxCaptureBytes: 100 });
    big.run.start("r");
    sendCapture(big.run, "r", JSON.stringify({ ...CAPTURE, pad: "x".repeat(200) }));
    big.run.onEnd("r");
    await tick();
    expect(big.kept).toHaveLength(0);
    expect(last(big.statuses)).toEqual({ state: "error", message: TOO_MUCH });
  });

  test("the limit counts bytes, not characters", async () => {
    const text = JSON.stringify({ ...CAPTURE, pad: "中".repeat(40) });
    expect(text.length).toBeLessThan(150);
    const big = setup({ maxCaptureBytes: 150 });
    big.run.start("r");
    sendCapture(big.run, "r", text);
    big.run.onEnd("r");
    await tick();
    expect(last(big.statuses)).toEqual({ state: "error", message: TOO_MUCH });
  });

  test("the default limit is the importer's", async () => {
    const { LIMITS } = await import("@repo/capture-schema");
    const big = setup();
    big.run.start("r");
    const text = "x".repeat(LIMITS.captureJsonBytes + 1);
    big.run.onChunk("r", {
      type: "chunk",
      kind: "capture",
      key: "capture",
      index: 0,
      total: 1,
      data: text,
    });
    big.run.onEnd("r");
    await tick();
    expect(last(big.statuses)).toEqual({ state: "error", message: TOO_MUCH });
    expect(big.kept).toHaveLength(0);
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

    test("asset bytes are decoded and handed to keep by hash", async () => {
      const packed: Array<Map<string, Uint8Array>> = [];
      const f = setup({
        keep: (_c, assets) => {
          packed.push(assets);
          return true;
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

    test("bytes the capture does not list are not kept", async () => {
      const packed: Array<Map<string, Uint8Array>> = [];
      const f = setup({
        keep: (_c, assets) => {
          packed.push(assets);
          return true;
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

    test("an oversized chunk is refused before it is decoded", () => {
      const f = setup({ maxAssetBytes: 6 });
      f.run.start("r1");
      // Not valid base64: a decode would throw a different error.
      f.run.onChunk("r1", {
        type: "chunk",
        kind: "asset",
        key: H1,
        index: 0,
        total: 1,
        data: "!".repeat(40),
      });
      expect(last(f.statuses)).toMatchObject({
        state: "error",
        message: expect.stringContaining("more image data"),
      });
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

describe("a labelled capture", () => {
  test("the saved status carries the page's width and the file's label", async () => {
    const t = setup();
    t.run.start("r1");
    const labelled = { ...CAPTURE, version: { label: "1440 Dark", kind: "viewport" } };
    sendCapture(t.run, "r1", JSON.stringify(labelled));
    t.run.onEnd("r1");
    await tick();
    expect(last(t.statuses)).toMatchObject({ state: "saved", width: 1440, label: "1440 Dark" });
  });
});
