import { afterEach, describe, expect, test } from "bun:test";
import { FrottageFileError, packFrottage } from "@repo/capture-schema";
import { DEFAULT_IMPORT_OPTIONS } from "@repo/figma-mapper";
import {
  type ImportState,
  messageForError,
  type ReviewDecision,
  type ReviewSession,
  runImports,
  sanitizeOptions,
  yieldToPaint,
} from "../import-flow";
import {
  captureWithTexts,
  fakePort,
  fontFile,
  frottageFile,
  imageFile,
  namedFile,
  versionFile,
} from "./helpers";

async function run(file: File, port = fakePort()) {
  const states: ImportState[] = [];
  await runImports([file], port, (s) => states.push(s));
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

describe("runImports", () => {
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
    await runImports([frottageFile(119)], port, () => {});
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
    await runImports([frottageFile(1)], port, (s) => states.push(s));
    expect(states.at(-1)).toMatchObject({
      step: "done",
      stylesCreated: 1,
      stylesReused: 2,
      variablesCreated: 3,
      variablesReused: 4,
      tokenFailures: 5,
    });
  });

  test("the done state carries the component counts", async () => {
    const port = fakePort();
    port.endResult = {
      ...port.endResult,
      componentsCreated: 2,
      instancesCreated: 4,
      overrideFailures: 3,
      overrideFailuresInMains: 1,
      layoutFailures: 1,
    };
    const states: ImportState[] = [];
    await runImports([frottageFile(1)], port, (s) => states.push(s));
    expect(states.at(-1)).toMatchObject({
      componentsCreated: 2,
      instancesCreated: 4,
      overrideFailures: 3,
      overrideFailuresInMains: 1,
      layoutFailures: 1,
    });
  });

  test("the done state carries the hover counts", async () => {
    const port = fakePort();
    port.endResult = { ...port.endResult, hoverVariants: 3, hoverFailures: 2 };
    const states: ImportState[] = [];
    await runImports([frottageFile(1)], port, (s) => states.push(s));
    expect(states.at(-1)).toMatchObject({ hoverVariants: 3, hoverFailures: 2 });
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
    expect(working.at(-1)).toMatchObject({ step: "working", done: 120, total: 120 });
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

const fonts = [
  { family: "Inter", style: "Regular" },
  { family: "Roboto", style: "Regular" },
];

/** Two side-by-side texts in a flex row, the first one linked. */
function linkedFlexFile(): File {
  const capture = captureWithTexts(2);
  const root = capture.root as unknown as {
    layout: { display: string };
    children: { box: { x: number; w: number }; runs: { href?: string }[] }[];
  };
  root.layout.display = "flex";
  for (const [i, child] of root.children.entries()) child.box = { ...child.box, x: i * 50, w: 50 };
  if (root.children[0]?.runs[0]) root.children[0].runs[0].href = "https://example.com/x";
  return new File([packFrottage(capture, new Map()) as BlobPart], "p.frottage");
}

function confirm(decision: ReviewDecision | null, forceReview = false) {
  const session: ReviewSession & { asked: number } = {
    forceReview,
    asked: 0,
    async decide() {
      session.asked += 1;
      return decision;
    },
  };
  return session;
}

async function runWith(file: File, port: ReturnType<typeof fakePort>, session: ReviewSession) {
  const states: ImportState[] = [];
  await runImports([file], port, (s) => states.push(s), session);
  return states;
}

describe("DEFAULT_IMPORT_OPTIONS", () => {
  test("defaults match the design", () => {
    expect(DEFAULT_IMPORT_OPTIONS).toMatchObject({
      autoLayout: true,
      htmlNames: false,
      components: true,
      hoverComponents: false,
    });
  });
});

describe("the review step", () => {
  test("no missing fonts means no review step", async () => {
    const port = fakePort(fonts);
    const session = confirm(null);
    const states = await runWith(frottageFile(1), port, session);
    expect(session.asked).toBe(0);
    expect(states.some((s) => s.step === "review")).toBe(false);
    expect(states.at(-1)?.step).toBe("done");
    expect(port.tokensOptions).toEqual(DEFAULT_IMPORT_OPTIONS);
  });

  test("missing fonts show the nearest match pre-filled", async () => {
    const port = fakePort(fonts);
    const states = await runWith(fontFile("Nimbus Sans"), port, confirm(null));
    const review = states.find((s) => s.step === "review");
    expect(review).toMatchObject({
      step: "review",
      hostname: "example.com",
      missing: [{ family: "Nimbus Sans", choice: "Inter" }],
      families: ["Inter", "Roboto"],
      options: DEFAULT_IMPORT_OPTIONS,
    });
  });

  test("Import works with the pre-filled choice and never blocks", async () => {
    const port = fakePort(fonts);
    const states = await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map() })
    );
    expect(states.at(-1)?.step).toBe("done");
    expect(port.beginMeta?.fonts).toEqual([{ family: "Inter", style: "Regular" }]);
  });

  test("a chosen font flows into the plan", async () => {
    const port = fakePort(fonts);
    await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map([["Nimbus Sans", "Roboto"]]) })
    );
    expect(port.beginMeta?.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
  });

  test("a font choice is remembered per family", async () => {
    const port = fakePort(fonts);
    await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map([["Nimbus Sans", "Roboto"]]) })
    );
    expect(port.prefs.get("font:Nimbus Sans")).toBe("Roboto");
    const states = await runWith(fontFile("Nimbus Sans"), port, confirm(null));
    expect(states.find((s) => s.step === "review")).toMatchObject({
      missing: [{ family: "Nimbus Sans", choice: "Roboto" }],
    });
  });

  test("a stored font that is no longer available is ignored", async () => {
    const port = fakePort(fonts);
    port.prefs.set("font:Nimbus Sans", "Gone");
    port.prefs.set("font:Other", 42);
    const states = await runWith(fontFile("Nimbus Sans"), port, confirm(null));
    expect(states.find((s) => s.step === "review")).toMatchObject({
      missing: [{ family: "Nimbus Sans", choice: "Inter" }],
    });
  });

  test("options are remembered per domain", async () => {
    const port = fakePort(fonts);
    const chosen = { ...DEFAULT_IMPORT_OPTIONS, autoLayout: false, htmlNames: true };
    await runWith(frottageFile(1), port, confirm({ options: chosen, fonts: new Map() }, true));
    expect(port.prefs.get("options:example.com")).toEqual(chosen);
    expect(port.tokensOptions).toEqual(chosen);
    // A plain drop uses them without asking.
    const session = confirm(null);
    await runWith(frottageFile(1), port, session);
    expect(session.asked).toBe(0);
    expect(port.tokensOptions).toEqual(chosen);
    // Another domain keeps the defaults.
    await runWith(fontFile("Inter", "https://other.example/"), port, confirm(null));
    expect(port.tokensOptions).toEqual(DEFAULT_IMPORT_OPTIONS);
  });

  test("malformed stored options are ignored field by field", async () => {
    const port = fakePort(fonts);
    port.prefs.set("options:example.com", { autoLayout: "no", htmlNames: true, extra: 1 });
    await runWith(frottageFile(1), port, confirm(null));
    expect(port.tokensOptions).toEqual({ ...DEFAULT_IMPORT_OPTIONS, htmlNames: true });
    port.prefs.set("options:example.com", "garbage");
    await runWith(frottageFile(1), port, confirm(null));
    expect(port.tokensOptions).toEqual(DEFAULT_IMPORT_OPTIONS);
  });

  test("failing prefs never block an import", async () => {
    const port = fakePort(fonts);
    port.getPrefs = async () => {
      throw new Error("no storage");
    };
    port.setPrefs = async () => {
      throw new Error("no storage");
    };
    const states = await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map() })
    );
    expect(states.at(-1)?.step).toBe("done");
  });

  test("opening options reviews even with no missing fonts", async () => {
    const port = fakePort(fonts);
    const states = await runWith(frottageFile(1), port, confirm(null, true));
    expect(states.find((s) => s.step === "review")).toMatchObject({ missing: [] });
  });

  test("cancel returns to idle and creates nothing", async () => {
    const port = fakePort(fonts);
    const states = await runWith(fontFile("Nimbus Sans"), port, confirm(null));
    expect(states.at(-1)).toEqual({ step: "idle" });
    expect(port.log).not.toContain("begin");
    expect(port.log.some((l) => l.startsWith("setPrefs"))).toBe(false);
  });

  test("an accepted prefilled font is applied but not remembered", async () => {
    const port = fakePort(fonts);
    const states = await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map([["Nimbus Sans", "Inter"]]) })
    );
    expect(states.at(-1)?.step).toBe("done");
    expect(port.log.some((l) => l.startsWith("setPrefs font:"))).toBe(false);
  });

  test("a stored choice accepted unchanged keeps its pref", async () => {
    const port = fakePort(fonts);
    port.prefs.set("font:Nimbus Sans", "Roboto");
    await runWith(
      fontFile("Nimbus Sans"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map([["Nimbus Sans", "Roboto"]]) })
    );
    expect(port.prefs.get("font:Nimbus Sans")).toBe("Roboto");
    expect(port.beginMeta?.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
  });

  test("families named like Object members keep their choice", async () => {
    const port = fakePort(fonts);
    await runWith(
      fontFile("constructor"),
      port,
      confirm({ options: DEFAULT_IMPORT_OPTIONS, fonts: new Map([["constructor", "Roboto"]]) })
    );
    expect(port.beginMeta?.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
    expect(port.prefs.get("font:constructor")).toBe("Roboto");
  });

  test("switching options off changes the plan, not only the options", async () => {
    const run = async (over: Partial<typeof DEFAULT_IMPORT_OPTIONS>) => {
      const port = fakePort(fonts);
      const ops: unknown[] = [];
      port.batch = async (b) => {
        ops.push(...b);
      };
      await runWith(
        linkedFlexFile(),
        port,
        confirm({ options: { ...DEFAULT_IMPORT_OPTIONS, ...over }, fonts: new Map() }, true)
      );
      return JSON.stringify(ops);
    };
    const base = await run({});
    expect(await run({ htmlNames: true })).not.toBe(base);
    expect(await run({ autoLayout: false })).not.toBe(base);
    expect(await run({ hyperlinks: false })).not.toBe(base);
  });
});

describe("sanitizeOptions", () => {
  test("a preference stored before Components existed takes the defaults for them", () => {
    const stored = { autoLayout: false, tokens: true };
    expect(sanitizeOptions(stored)).toEqual({ ...DEFAULT_IMPORT_OPTIONS, autoLayout: false });
  });

  test("a stored components: false is respected", () => {
    expect(sanitizeOptions({ components: false }).components).toBe(false);
  });
});

describe("a user Cancel", () => {
  test("during begin waits for it, then cancels the sandbox and goes idle", async () => {
    const port = fakePort();
    const controller = new AbortController();
    const begin = port.begin.bind(port);
    port.begin = async (meta) => {
      controller.abort();
      await new Promise((r) => setTimeout(r, 5));
      await begin(meta);
    };
    const states: ImportState[] = [];
    await runImports([frottageFile(1)], port, (s) => states.push(s), undefined, controller.signal);
    expect(port.log.indexOf("begin")).toBeLessThan(port.log.indexOf("cancel"));
    expect(port.log).not.toContain("batch");
    expect(port.log).not.toContain("end");
    expect(states.at(-1)).toEqual({ step: "idle" });
  });

  test("between batches stops the loop", async () => {
    const port = fakePort();
    const controller = new AbortController();
    const batch = port.batch.bind(port);
    port.batch = async (ops) => {
      await batch(ops);
      controller.abort();
    };
    const states: ImportState[] = [];
    await runImports(
      [frottageFile(120)],
      port,
      (s) => states.push(s),
      undefined,
      controller.signal
    );
    expect(port.batchSizes).toHaveLength(1);
    expect(port.log).toContain("cancel");
    expect(states.at(-1)).toEqual({ step: "idle" });
  });
});

describe("runImports with several files", () => {
  async function runMany(files: File[], port = fakePort(), session?: ReviewSession) {
    const states: ImportState[] = [];
    await runImports(files, port, (s) => states.push(s), session);
    return { port, states };
  }

  test("files from one page import one after another, widest first", async () => {
    const { port, states } = await runMany([
      versionFile({ name: "narrow", width: 834, label: "834" }),
      versionFile({ name: "wide", width: 1512, label: "1512" }),
    ]);
    expect(port.log.filter((l) => l === "begin")).toHaveLength(2);
    const done = states.at(-1);
    if (done?.step !== "done") throw new Error("not done");
    expect(done.versions.map((v) => v.name)).toEqual(["wide", "narrow"]);
    expect(done.versions.map((v) => v.label)).toEqual(["1512", "834"]);
    const files = states.flatMap((s) => (s.step === "working" ? [s.file.index] : []));
    expect(files).toContain(2);
  });

  test("files from two pages import as two sets", async () => {
    const { port, states } = await runMany([
      versionFile({ name: "a", url: "https://one.example/" }),
      versionFile({ name: "b", url: "https://two.example/" }),
    ]);
    expect(port.log.filter((l) => l === "end")).toHaveLength(2);
    expect(states.at(-1)).toMatchObject({ step: "done" });
  });

  test("a bad file is reported by name and the rest import", async () => {
    const { port, states } = await runMany([
      new File([new Uint8Array([1, 2, 3])], "junk.txt"),
      versionFile({ name: "good", label: "1280" }),
    ]);
    expect(port.log.filter((l) => l === "begin")).toHaveLength(1);
    const done = states.at(-1);
    if (done?.step !== "done") throw new Error("not done");
    expect(done.failures.map((f) => f.name)).toEqual(["junk.txt"]);
    expect(done.versions).toHaveLength(1);
  });

  test("a set with no good file reports only the failures", async () => {
    const { port, states } = await runMany([
      new File([new Uint8Array([1])], "a.txt"),
      new File([new Uint8Array([2])], "b.txt"),
    ]);
    expect(port.log).toEqual([]);
    const last = states.at(-1);
    expect(last?.step).toBe("error");
    expect((last as { message: string }).message).toContain("a.txt");
    expect((last as { message: string }).message).toContain("b.txt");
  });

  test("the review step shows once, with missing fonts across all files", async () => {
    let decided = 0;
    const session: ReviewSession = {
      forceReview: false,
      decide: async () => {
        decided += 1;
        return { options: DEFAULT_IMPORT_OPTIONS, fonts: new Map() };
      },
    };
    const { states } = await runMany(
      [
        versionFile({ name: "a", width: 1512, label: "1512", family: "Brand Sans" }),
        versionFile({ name: "b", width: 834, label: "834", family: "Brand Serif" }),
        versionFile({ name: "c", width: 600, label: "600", family: "Brand Sans" }),
      ],
      fakePort(),
      session
    );
    const reviews = states.filter((s) => s.step === "review");
    expect(reviews).toHaveLength(1);
    expect(decided).toBe(1);
    const review = reviews[0];
    if (review?.step !== "review") throw new Error("no review");
    expect(review.missing.map((m) => m.family).sort()).toEqual(["Brand Sans", "Brand Serif"]);
  });

  test("the report lists each version", async () => {
    const { states } = await runMany([
      versionFile({ name: "a", width: 1512, label: "1512" }),
      versionFile({ name: "b", width: 834, label: "834" }),
    ]);
    const done = states.at(-1);
    if (done?.step !== "done") throw new Error("not done");
    expect(done.versions).toHaveLength(2);
    expect(done.versions[0]?.report.texts).toBe(1);
  });

  test("more than 8 files are refused before reading", async () => {
    const read = () => Promise.reject(new Error("read"));
    const many = Array.from(
      { length: 9 },
      () => ({ size: 1, arrayBuffer: read }) as unknown as File
    );
    const { port, states } = await runMany(many);
    expect(port.log).toEqual([]);
    expect(states.at(-1)).toMatchObject({ step: "error" });
  });

  test("total bytes over the limit are refused before reading", async () => {
    const read = () => Promise.reject(new Error("read"));
    const big = (n: number) => ({ size: n, arrayBuffer: read }) as unknown as File;
    const { port, states } = await runMany([big(300 * 1024 * 1024), big(300 * 1024 * 1024 + 1)]);
    expect(port.log).toEqual([]);
    expect((states.at(-1) as { message: string }).message).toContain("600 MB");
  });

  test("Cancel stops the run and undoes the version in hand", async () => {
    const port = fakePort();
    const controller = new AbortController();
    const batch = port.batch.bind(port);
    port.batch = async (ops) => {
      await batch(ops);
      controller.abort();
    };
    const states: ImportState[] = [];
    await runImports(
      [
        versionFile({ name: "a", width: 1512, label: "1512" }),
        versionFile({ name: "b", label: "834", width: 834 }),
      ],
      port,
      (s) => states.push(s),
      undefined,
      controller.signal
    );
    expect(port.log.filter((l) => l === "begin")).toHaveLength(1);
    expect(port.log).toContain("cancel");
    expect(states.at(-1)).toEqual({ step: "idle" });
  });
});
