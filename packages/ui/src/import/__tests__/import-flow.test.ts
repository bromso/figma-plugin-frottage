import { afterEach, describe, expect, test } from "bun:test";
import { FrottageFileError } from "@repo/capture-schema";
import { type ImportState, messageForError, runImport, yieldToPaint } from "../import-flow";
import { fakePort, frottageFile, imageFile, namedFile } from "./helpers";

async function run(file: File, port = fakePort()) {
  const states: ImportState[] = [];
  await runImport(file, port, (s) => states.push(s));
  return { port, states };
}

describe("messageForError", () => {
  test("too-large names both limits, so oversized page data is not told only 256 MB", () => {
    const text = messageForError(new FrottageFileError("too-large"));
    expect(text).toContain("256 MB");
    expect(text).toContain("64 MB");
  });
});

describe("yieldToPaint", () => {
  const original = globalThis.requestAnimationFrame;
  afterEach(() => {
    globalThis.requestAnimationFrame = original;
  });

  test("moves on when the hidden iframe never fires requestAnimationFrame", async () => {
    globalThis.requestAnimationFrame = () => 0;
    const outcome = await Promise.race([
      yieldToPaint().then(() => "resumed"),
      new Promise((r) => setTimeout(() => r("stalled"), 1000)),
    ]);
    expect(outcome).toBe("resumed");
  });

  test("resumes soon after a frame without waiting out the fallback", async () => {
    globalThis.requestAnimationFrame = (fn) => {
      queueMicrotask(() => fn(0));
      return 0;
    };
    const start = performance.now();
    await yieldToPaint();
    expect(performance.now() - start).toBeLessThan(80);
  });
});

describe("runImport", () => {
  test.each([
    ["Pricing | Acme", "https://acme.example/pricing", "Pricing | Acme"],
    ["  Spaced  ", "https://acme.example/", "Spaced"],
    ["", "https://acme.example/pricing", "acme.example"],
    ["   ", "http://localhost:4173/a", "localhost"],
    ["", "file:///a/b.html", "Frottage import"],
    ["", "not a url", "Frottage import"],
  ])("title %p at %s names the root %p", async (title, url, name) => {
    const { port } = await run(namedFile(title, url));
    expect(port.beginMeta?.name).toBe(name);
  });

  test("sends images before ops, and ops in batches of 50", async () => {
    const port = fakePort();
    await runImport(frottageFile(119), port, () => {});
    expect(port.log[0]).toBe("listFonts");
    expect(port.batchSizes).toEqual([50, 50, 20]);
    expect(port.log.indexOf("begin")).toBeLessThan(port.log.indexOf("batch"));
  });

  test("sends the tokens after begin and before any image or batch", async () => {
    const { port } = await run(await imageFile(true));
    expect(port.log.indexOf("tokens")).toBe(port.log.indexOf("begin") + 1);
    expect(port.log.indexOf("tokens")).toBeLessThan(port.log.indexOf("image"));
    expect(port.tokensSent?.collection).toBe(new URL("https://example.com").hostname);
  });

  test("the done state carries the token counts", async () => {
    const port = fakePort();
    port.endResult = {
      ...port.endResult,
      stylesCreated: 1,
      stylesReused: 2,
      variablesCreated: 3,
      variablesReused: 4,
      tokenFailures: 5,
    };
    const states: ImportState[] = [];
    await runImport(frottageFile(1), port, (s) => states.push(s));
    expect(states.at(-1)).toMatchObject({
      step: "done",
      stylesCreated: 1,
      stylesReused: 2,
      variablesCreated: 3,
      variablesReused: 4,
      tokenFailures: 5,
    });
  });

  test("sends each image before the first batch", async () => {
    const { port } = await run(await imageFile(true));
    expect(port.log.indexOf("image")).toBeGreaterThan(-1);
    expect(port.log.indexOf("image")).toBeLessThan(port.log.indexOf("batch"));
  });

  test("a newer file says to update and creates nothing", async () => {
    const { port, states } = await run(frottageFile(1, 2));
    expect(states.at(-1)).toEqual({
      step: "error",
      message: "This file needs a newer version of Frottage. Update the plugin and try again.",
    });
    expect(port.log).not.toContain("begin");
  });

  test("a corrupt asset fails before begin", async () => {
    const { port, states } = await run(await imageFile(false));
    expect(states.at(-1)).toMatchObject({ step: "error" });
    expect(port.log).not.toContain("begin");
    expect(port.log).not.toContain("image");
  });

  test("an intact asset passes the hash check", async () => {
    const { states } = await run(await imageFile(true));
    expect(states.at(-1)?.step).toBe("done");
  });

  test("verifies images where crypto.subtle is unavailable", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
    Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
    try {
      const { states } = await run(await imageFile(true));
      expect(states.at(-1)?.step).toBe("done");
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, "subtle", original);
    }
  });

  test("progress counts ops and finishes at the total", async () => {
    const { states } = await run(frottageFile(119));
    const working = states.filter((s) => s.step === "working");
    expect(working.at(-1)).toEqual({ step: "working", done: 120, total: 120 });
    expect(working.map((s) => s.done)).toContain(50);
  });

  test("done carries the report and failed counts", async () => {
    const port = fakePort();
    port.endResult = {
      rootId: "1:2",
      failedOps: 3,
      missingImages: 1,
      rewrappedTexts: 4,
      textDriftCount: 6,
      autoLayoutFrames: 5,
      fallbackFrames: 2,
    };
    const { states } = await run(frottageFile(2), port);
    const last = states.at(-1);
    expect(last).toMatchObject({
      step: "done",
      failedOps: 3,
      missingImages: 1,
      rewrappedTexts: 4,
      textDriftCount: 6,
      autoLayoutFrames: 5,
      fallbackFrames: 2,
    });
    if (last?.step === "done") expect(last.report.texts).toBe(2);
  });

  test("a failing batch cancels and shows the generic message", async () => {
    const port = fakePort();
    port.failOn = "batch";
    const { states } = await run(frottageFile(3), port);
    expect(port.log).toContain("cancel");
    expect(states.at(-1)).toEqual({
      step: "error",
      message: "Something went wrong importing this file. Nothing was added to your file.",
    });
  });

  test("an empty rootId is a failure and cancels", async () => {
    const port = fakePort();
    port.endResult = { rootId: "", failedOps: 0 };
    const { states } = await run(frottageFile(1), port);
    expect(states.at(-1)?.step).toBe("error");
    expect(port.log).toContain("cancel");
  });

  test("a file over 300 MB is refused before reading", async () => {
    const big = {
      size: 300 * 1024 * 1024 + 1,
      arrayBuffer: () => Promise.reject(new Error("read")),
    };
    const { port, states } = await run(big as unknown as File);
    expect(states.at(-1)).toMatchObject({ step: "error" });
    expect((states.at(-1) as { message: string }).message).toContain("256 MB");
    expect(port.log).toEqual([]);
  });

  test("garbage with a wrong extension gets the container check", async () => {
    const { states } = await run(new File([new Uint8Array([1, 2, 3])], "x.txt"));
    expect(states.at(-1)).toEqual({
      step: "error",
      message:
        "This isn't a Frottage file. Capture a page with the extension, then choose its .frottage file.",
    });
  });
});

describe("messageForError", () => {
  test("a non-frottage file gets a clear message", () => {
    expect(messageForError(new FrottageFileError("not-a-frottage-file"))).toBe(
      "This isn't a Frottage file. Capture a page with the extension, then choose its .frottage file."
    );
  });
  test("too large names the limit", () => {
    expect(messageForError(new FrottageFileError("too-large"))).toContain("256 MB");
  });
  test("every code has a plain sentence without technical detail", () => {
    const codes = [
      "not-a-frottage-file",
      "too-large",
      "too-many-nodes",
      "too-deep",
      "invalid-capture",
      "newer-version",
      "missing-asset",
      "corrupt-asset",
    ] as const;
    for (const code of codes) {
      const msg = messageForError(new FrottageFileError(code, "ZodError at root.children[3]"));
      expect(msg).not.toContain("Zod");
      expect(msg.endsWith(".")).toBe(true);
    }
  });
  test("other errors get the generic message", () => {
    expect(messageForError(new Error("secret"))).toBe(
      "Something went wrong importing this file. Nothing was added to your file."
    );
  });
});
