import { expect, test } from "bun:test";
import type { FontRef, PlanOp, PlanRun } from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { fakeFigma } from "./fake-figma";

const inter: FontRef = { family: "Inter", style: "Regular" };
const bold: FontRef = { family: "Inter", style: "Bold" };
const meta = { name: "Import", fonts: [inter, bold], totalOps: 2 };
const png = new Uint8Array([1, 2, 3]);

const frame = (id: string, parent: string | null = null, extra: object = {}): PlanOp => ({
  op: "frame",
  id,
  parent,
  name: id,
  x: 5,
  y: 6,
  w: 100,
  h: 50,
  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
  strokes: null,
  radius: [1, 2, 3, 4],
  opacity: 1,
  effects: [],
  clips: true,
  layout: { mode: "NONE" },
  childCount: 0,
  ...extra,
});
const run = (start: number, end: number, fontName: FontRef): PlanRun => ({
  start,
  end,
  fontName,
  fontSize: 12,
  lineHeight: null,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0 },
  opacity: 1,
  decoration: "NONE",
  textCase: "ORIGINAL",
});
const textOp = (
  id: string,
  parent: string,
  runs: PlanRun[],
  wrap = false,
  extra: object = {}
): PlanOp => ({
  op: "text",
  id,
  parent,
  name: id,
  x: 1,
  y: 2,
  w: 80,
  h: 20,
  text: "hello",
  runs,
  align: "LEFT",
  wrap,
  lineCount: 1,
  ...extra,
});
const imageOp = (hash: string): PlanOp => ({
  op: "image",
  id: "img",
  parent: "a",
  name: "pic",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  hash,
  fit: "FILL",
  opacity: 1,
  radius: [0, 0, 0, 0],
  strokes: null,
});

test("applies frames and text in order under one root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, inter)])]);
  const r = await a.end();
  expect(f.node(r.rootId).children).toHaveLength(1);
  expect(f.node(r.rootId).children[0].type).toBe("TEXT");
  expect(f.node(r.rootId).clipsContent).toBe(true);
  expect(f.page.children).toHaveLength(1);
  expect(r.failedOps).toBe(0);
});

test("the root layer takes the import's name, not its tag", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin({ ...meta, name: "Pricing | Acme" });
  await a.applyBatch([frame("a"), frame("b", "a")]);
  const r = await a.end();
  expect(f.node(r.rootId).name).toBe("Pricing | Acme");
  expect(f.node(r.rootId).children[0].name).toBe("b");
});

test("an empty import name keeps the root op's name", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin({ ...meta, name: "" });
  await a.applyBatch([frame("a")]);
  expect(f.node((await a.end()).rootId).name).toBe("a");
});

test("loads every font before any text", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, inter)])]);
  expect(f.calls.indexOf("loadFontAsync")).toBeLessThan(f.calls.indexOf("createText"));
  expect(f.calls.lastIndexOf("loadFontAsync")).toBeLessThan(f.calls.indexOf("createText"));
});

test("sets ranges per run, font before characters", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 2, inter), run(2, 5, bold)])]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(
    t.ranges.filter((r: any) => r.m === "setRangeFontName").map((r: any) => r.v.style)
  ).toEqual(["Regular", "Bold"]);
  expect(t.ranges.filter((r: any) => r.m === "setRangeFills")).toHaveLength(2);
  expect(t.ranges.find((r: any) => r.m === "setRangeLineHeight").v).toEqual({ unit: "AUTO" });
  expect(t.fontName).toEqual(inter);
  expect(t.characters).toBe("hello");
  expect(t.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  expect(t.x).toBe(1);
});

test("wrapping text fixes width", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, inter)], true)]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.textAutoResize).toBe("HEIGHT");
  expect(t.width).toBe(80);
});

test("a font that fails to load falls back to Inter Regular", async () => {
  const f = fakeFigma({ failFonts: ["Inter|Bold"] });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, bold)])]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.fontName).toEqual(inter);
  expect((await a.end()).failedOps).toBe(0);
});

test("text fails when the fallback font fails too", async () => {
  const f = fakeFigma({ failFonts: ["Inter|Bold", "Inter|Regular"] });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, bold)])]);
  expect((await a.end()).failedOps).toBe(1);
});

test("image ops use the hash from addImage", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  expect((await a.addImage("abc", png)).ok).toBe(true);
  await a.applyBatch([frame("a"), imageOp("abc")]);
  expect(f.lastRectangle().fills[0]).toMatchObject({ type: "IMAGE", imageHash: f.hashOf(png) });
});

test("a rejected image becomes a placeholder", async () => {
  const f = fakeFigma({ createImageThrows: true });
  const a = createApplier(f.figma);
  await a.begin(meta);
  expect((await a.addImage("abc", png)).ok).toBe(false);
  await a.applyBatch([frame("a"), imageOp("abc")]);
  expect(f.lastFrame().name).toContain("Image");
  expect((await a.end()).missingImages).toBe(1);
});

test("an unknown image hash in a frame fill is dropped and counted", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a", null, { fills: [{ type: "IMAGE", hash: "zzz", fit: "FILL" }] })]);
  const r = await a.end();
  expect(f.lastFrame().fills ?? []).toEqual([]);
  expect(r.missingImages).toBe(1);
  expect(r.failedOps).toBe(0);
});

test("placeholder op is a faint grey frame named by label", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    {
      op: "placeholder",
      id: "p",
      parent: "a",
      name: "p",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      opacity: 0.5,
      label: "Video",
    },
  ]);
  expect(f.lastFrame().name).toBe("Video");
  expect(f.lastFrame().fills[0].opacity).toBe(0.08);
  expect(f.lastFrame().opacity).toBe(0.5);
});

const styled = {
  opacity: 0.5,
  radius: [1, 2, 3, 4],
  strokes: {
    color: { r: 1, g: 0, b: 0 },
    opacity: 1,
    weights: { top: 4, right: 3, bottom: 2, left: 1 },
  },
};

test("an image rectangle takes opacity, radius and border", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("abc", png);
  await a.applyBatch([frame("a"), { ...imageOp("abc"), ...styled } as PlanOp]);
  expect(f.lastRectangle()).toMatchObject({
    opacity: 0.5,
    topLeftRadius: 1,
    topRightRadius: 2,
    bottomRightRadius: 3,
    bottomLeftRadius: 4,
    strokeAlign: "INSIDE",
    strokeTopWeight: 4,
    strokeRightWeight: 3,
    strokeBottomWeight: 2,
    strokeLeftWeight: 1,
  });
  expect(f.lastRectangle().strokes).toEqual([
    { type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 },
  ]);
});

test("an image with opacity 0 stays in the file at opacity 0", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("abc", png);
  await a.applyBatch([frame("a"), { ...imageOp("abc"), opacity: 0 } as PlanOp]);
  expect(f.lastRectangle().opacity).toBe(0);
});

test("a missing image keeps its opacity and radius", async () => {
  const f = fakeFigma({ createImageThrows: true });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("abc", png);
  await a.applyBatch([frame("a"), { ...imageOp("abc"), ...styled } as PlanOp]);
  expect(f.lastFrame()).toMatchObject({ opacity: 0.5, topLeftRadius: 1, bottomLeftRadius: 4 });
});

test("one failing op is counted, its children fail too, the rest continue", async () => {
  const f = fakeFigma({ failOn: "op-2" });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("op-1"),
    frame("op-2", "op-1"),
    frame("child", "op-2"),
    frame("op-4", "op-1"),
  ]);
  const r = await a.end();
  expect(r.failedOps).toBe(2);
  expect(f.node(r.rootId).children).toHaveLength(1);
});

test("commits undo once around the import and selects the root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a")]);
  const r = await a.end();
  expect(f.count("commitUndo")).toBe(2);
  expect(f.page.selection[0].id).toBe(r.rootId);
  expect(f.count("scrollAndZoomIntoView")).toBe(1);
});

test("root sits 100px right of existing content", async () => {
  const f = fakeFigma({
    existingBounds: [
      { x: 0, width: 300 },
      { x: 50, width: 100 },
    ],
  });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a")]);
  const r = await a.end();
  expect(f.node(r.rootId).x).toBe(400);
  expect(f.node(r.rootId).y).toBe(0);
});

test("a second begin removes the partial root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a")]);
  const first = f.created[0];
  await a.begin(meta);
  expect(first.removed).toBe(true);
});

test("begin creates no node; the root op is the root and ignores its captured offset", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  expect(f.created).toHaveLength(0);
  await a.applyBatch([frame("a", null, { x: 77, y: 88 })]);
  const r = await a.end();
  expect(r.rootId).toBe(f.created[0].id);
  expect([f.node(r.rootId).x, f.node(r.rootId).y]).toEqual([0, 0]);
});

test("an import with no root op returns an empty rootId and counts a failure", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const r = await a.end();
  expect(r).toEqual({
    rootId: "",
    failedOps: 1,
    missingImages: 0,
    rewrappedTexts: 0,
    autoLayoutFrames: 0,
    fallbackFrames: 0,
    fallbackReasons: {},
    textDriftCount: 0,
    stylesCreated: 0,
    stylesReused: 0,
    variablesCreated: 0,
    variablesReused: 0,
    tokenFailures: 0,
  });
});

test("a failed root op is counted once and fails its children", async () => {
  const f = fakeFigma({ failOn: meta.name });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), frame("b", "a")]);
  const r = await a.end();
  expect(r.rootId).toBe("");
  expect(r.failedOps).toBe(2);
  expect(f.page.children).toHaveLength(0);
});

test("cancel removes the partial root, commits undo, and ignores an idle applier", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  a.cancel();
  expect(f.count("commitUndo")).toBe(0);
  await a.begin(meta);
  await a.applyBatch([frame("a")]);
  a.cancel();
  expect(f.page.children).toHaveLength(0);
  expect(f.count("commitUndo")).toBe(2);
  expect(a.isActive()).toBe(false);
});

test("end keeps the result when selecting throws, and resets state", async () => {
  const f = fakeFigma({ viewportThrows: true });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a")]);
  const r = await a.end();
  expect(r.rootId).not.toBe("");
  expect(f.node(r.rootId).removed).toBe(false);
  expect(a.isActive()).toBe(false);
  await expect(a.end()).rejects.toThrow();
});

test("text is created only after its font is loaded (fake enforces it)", async () => {
  const f = fakeFigma();
  const t = f.raw_createText();
  expect(() => {
    t.characters = "x";
  }).toThrow();
  expect(() => {
    t.fontName = bold;
  }).toThrow();
});

test("run ranges are clamped to the text and empty ones skipped", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    textOp("t", "a", [run(0, 3, inter), run(3, 99, bold), run(5, 9, inter), run(4, 4, inter)]),
  ]);
  expect((await a.end()).failedOps).toBe(0);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  const spans = t.ranges.filter((r: any) => r.m === "setRangeFontSize").map((r: any) => [r.s, r.e]);
  expect(spans).toEqual([
    [0, 3],
    [3, 5],
  ]);
});

test("a font outside the loaded set uses the fallback", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const other = { family: "Nope", style: "Thin" };
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, other)])]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.fontName).toEqual(inter);
  expect((await a.end()).failedOps).toBe(0);
});

test("frame effects carry visible and blendMode, sizes clamp, default fill is replaced", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a", null, {
      w: 0,
      h: 0,
      fills: [],
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
        },
      ],
    }),
  ]);
  const r = await a.end();
  expect(r.failedOps).toBe(0);
  const n = f.node(r.rootId);
  expect(n.width).toBe(0.01);
  expect(n.fills).toEqual([]);
  expect(n.effects[0]).toMatchObject({ visible: true, blendMode: "NORMAL" });
});

test("a bad stroke weight drops the stroke, not the frame", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const strokes = {
    color: { r: 0, g: 0, b: 0 },
    opacity: 1,
    weights: { top: 1, right: Number.NaN, bottom: 1, left: 1 },
  };
  await a.applyBatch([frame("a", null, { strokes })]);
  const r = await a.end();
  expect(r.failedOps).toBe(0);
  expect(f.node(r.rootId).strokes).toBeUndefined();
});

const textNodeOf = (f: ReturnType<typeof fakeFigma>) =>
  f.created.find((n) => n.type === "TEXT") as any;

test("centred single-line text wider than w stays one line, centred on the captured box", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  // 11 chars at 5 per char = 55 wide in a captured box of 40 at x=100.
  const op = textOp("t", "a", [run(0, 11, inter)], false, {
    text: "hello world",
    align: "CENTER",
    x: 100,
    w: 40,
  });
  await a.applyBatch([frame("a"), op]);
  const t = textNodeOf(f);
  expect(t.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  expect(t.height).toBe(12);
  expect(t.width).toBe(55);
  expect(t.x + t.width / 2).toBe(120);
  expect(t.y).toBe(2);
  expect(t.textAlignHorizontal).toBe("CENTER");
});

test("right-aligned single-line text stays anchored to the right edge", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const op = textOp("t", "a", [run(0, 11, inter)], false, {
    text: "hello world",
    align: "RIGHT",
    x: 100,
    w: 40,
  });
  await a.applyBatch([frame("a"), op]);
  const t = textNodeOf(f);
  expect(t.x + t.width).toBe(140);
  expect(t.height).toBe(12);
});

test("left and justified single-line text keep x", async () => {
  for (const align of ["LEFT", "JUSTIFIED"]) {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const op = textOp("t", "a", [run(0, 11, inter)], false, {
      text: "hello world",
      align,
      x: 100,
      w: 40,
    });
    await a.applyBatch([frame("a"), op]);
    expect(textNodeOf(f).x).toBe(100);
  }
});

const wrapped = (extra: object) =>
  textOp("t", "a", [run(0, 17, inter)], true, {
    text: "aaaaa bbbbb ccccc",
    x: 100,
    w: 105,
    h: 24,
    lineCount: 2,
    align: "CENTER",
    ...extra,
  });

test("wrapped text that needs 3 lines widens until 2 lines, keeping its centre", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({})]);
  const r = await a.end();
  const t = textNodeOf(f);
  expect(t.textAutoResize).toBe("HEIGHT");
  expect(t.height).toBe(24);
  expect(t.width).toBeGreaterThan(105);
  expect(t.width).toBeLessThanOrEqual(105 * 1.08 + 1e-9);
  expect(t.x + t.width / 2).toBeCloseTo(100 + 105 / 2, 9);
  expect(t.y).toBe(2);
  expect(r.rewrappedTexts).toBe(0);
});

test("widening right-aligned wrapped text moves x left by the whole added width", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({ align: "RIGHT" })]);
  const t = textNodeOf(f);
  expect(t.height).toBe(24);
  expect(t.x + t.width).toBeCloseTo(205, 9);
});

test("widening left-aligned wrapped text keeps x", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({ align: "LEFT" })]);
  const t = textNodeOf(f);
  expect(t.height).toBe(24);
  expect(t.x).toBe(100);
});

test("wrapped text that cannot fit at 8% stops there and counts rewrappedTexts", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({ w: 100 })]);
  const r = await a.end();
  const t = textNodeOf(f);
  expect(t.width).toBeCloseTo(108, 9);
  expect(t.height).toBe(36);
  expect(t.x + t.width / 2).toBeCloseTo(150, 9);
  expect(r.rewrappedTexts).toBe(1);
  expect(r.failedOps).toBe(0);
});

test("wrapped text that already fits is not widened", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({ w: 120 })]);
  const r = await a.end();
  expect(textNodeOf(f).width).toBe(120);
  expect(r.rewrappedTexts).toBe(0);
});

test("wrapped text uses the first run's pixel line height to judge the line count", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    wrapped({ runs: [{ ...run(0, 17, inter), lineHeight: 20 }], h: 40 }),
  ]);
  expect(textNodeOf(f).height).toBe(40);
});

test("a larger later run sets the line height, so the first run's smaller one does not force widening", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    wrapped({
      w: 120,
      h: 40,
      runs: [
        { ...run(0, 5, inter), lineHeight: 10 },
        { ...run(5, 17, inter), lineHeight: 20 },
      ],
    }),
  ]);
  const r = await a.end();
  expect(textNodeOf(f).width).toBe(120);
  expect(r.rewrappedTexts).toBe(0);
});

test("the line check counts lines, not pixels, for long paragraphs with fractional line heights", async () => {
  const f = fakeFigma({ charWidth: 10, lineHeightDrift: 0.05 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  const words = Array.from({ length: 12 }, () => "aaaaa").join(" ");
  await a.applyBatch([
    frame("a"),
    wrapped({
      text: words,
      runs: [{ ...run(0, words.length, inter), lineHeight: 12.4 }],
      w: 50,
      h: 150,
      lineCount: 12,
    }),
  ]);
  const r = await a.end();
  expect(textNodeOf(f).width).toBe(50);
  expect(r.rewrappedTexts).toBe(0);
});

test("wrapped text ends in HEIGHT mode with the captured line count, even when h differs", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), wrapped({ h: 99 })]);
  const r = await a.end();
  const t = textNodeOf(f);
  expect(t.textAutoResize).toBe("HEIGHT");
  expect(t.height).toBe(24);
  expect(r.rewrappedTexts).toBe(0);
});

const svgOp = (markup = "<svg/>", extra: object = {}): PlanOp => ({
  op: "svg",
  id: "vec",
  parent: "a",
  name: "Svg",
  x: 7,
  y: 8,
  w: 24,
  h: 16,
  markup,
  opacity: 0.5,
  ...extra,
});

test("applier creates a vector frame and sizes it", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp("<svg>ok</svg>")]);
  expect(f.calls).toContain("createNodeFromSvg");
  expect(f.svgSources).toEqual(["<svg>ok</svg>"]);
  const r = await a.end();
  const v = f.node(r.rootId).children[0];
  expect(v.name).toBe("Svg");
  expect([v.x, v.y, v.width, v.height, v.opacity]).toEqual([7, 8, 24, 16, 0.5]);
  expect(v.parent).toBe(f.node(r.rootId));
  expect(v.clipsContent).toBe(true);
  expect(r.failedOps).toBe(0);
});

test("an svg whose overflow was visible does not clip", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp("<svg/>", { clips: false })]);
  expect(f.node((await a.end()).rootId).children[0].clipsContent).toBe(false);
});

test("an svg shown at another size scales its vectors", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp("<svg/>", { w: 48, h: 12 })]);
  const v = f.node((await a.end()).rootId).children[0];
  expect(v.children[0].constraints).toEqual({ horizontal: "SCALE", vertical: "SCALE" });
  expect([v.children[0].width, v.children[0].height]).toEqual([48, 12]);
});

test("an svg already at its size keeps its default constraints", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp("<svg/>", { w: 24.3, h: 24 })]);
  const v = f.node((await a.end()).rootId).children[0];
  expect(v.children[0].constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
});

test("a rejected svg becomes a placeholder and the import continues", async () => {
  const f = fakeFigma({ svgThrows: true });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp(), textOp("t", "a", [run(0, 5, inter)])]);
  const r = await a.end();
  const kids = f.node(r.rootId).children;
  expect(kids.map((n: any) => n.type)).toEqual(["FRAME", "TEXT"]);
  expect(kids[0].name).toContain("SVG");
  expect([kids[0].x, kids[0].y, kids[0].width, kids[0].height]).toEqual([7, 8, 24, 16]);
  expect(r.failedOps).toBe(0);
});

test("svg markup over 256 KiB is not handed to Figma", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp(`<svg>${"x".repeat(256 * 1024)}</svg>`)]);
  const r = await a.end();
  expect(f.count("createNodeFromSvg")).toBe(0);
  expect(f.node(r.rootId).children[0].name).toContain("SVG");
  expect(r.failedOps).toBe(0);
});

test("a multi-byte svg is measured in bytes", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  // 100,000 characters but 300,000 bytes.
  await a.applyBatch([frame("a"), svgOp(`<svg>${"\u20ac".repeat(100_000)}</svg>`)]);
  expect(f.count("createNodeFromSvg")).toBe(0);
});

test("an svg with no parent fails like any other op", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp("<svg/>", { parent: "missing" })]);
  expect(f.count("createNodeFromSvg")).toBe(0);
  expect((await a.end()).failedOps).toBe(1);
});

test("an svg frame whose setup fails is removed and counted", async () => {
  const f = fakeFigma({ failOn: "Svg" });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), svgOp()]);
  const r = await a.end();
  expect(r.failedOps).toBe(1);
  expect(f.node(r.rootId).children).toHaveLength(0);
});

const linkedRuns = (...parts: [number, number, string?][]) =>
  parts.map(([s, e, href]) => ({ ...run(s, e, inter), ...(href ? { href } : {}) }));

test("setRangeHyperlink is called per linked run, only over that range", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    textOp(
      "t",
      "a",
      linkedRuns([0, 2], [2, 4, "https://a.test/x"], [4, 5], [5, 99, "https://a.test/y"])
    ),
  ]);
  expect((await a.end()).failedOps).toBe(0);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  const links = t.ranges.filter((r: any) => r.m === "setRangeHyperlink");
  // The run at 5-99 starts at the end of the 5-character text, so it is empty and never linked.
  expect(links.map((r: any) => [r.s, r.e, r.v])).toEqual([
    [2, 4, { type: "URL", value: "https://a.test/x" }],
  ]);
});

test("a link is set after fonts and fills, and fills and decoration are reapplied", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", linkedRuns([0, 5, "https://a.test/x"]))]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  const order = t.ranges.map((r: any) => r.m);
  const at = order.indexOf("setRangeHyperlink");
  expect(at).toBeGreaterThan(order.indexOf("setRangeFontName"));
  expect(at).toBeGreaterThan(order.indexOf("setRangeFills"));
  expect(order.slice(at + 1)).toEqual(["setRangeFills", "setRangeTextDecoration"]);
});

test("a rejected URL drops only the link; the run keeps its style", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    textOp("t", "a", linkedRuns([0, 2, "not a url"], [2, 5, "https://a.test/ok"])),
  ]);
  expect((await a.end()).failedOps).toBe(0);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.ranges.filter((r: any) => r.m === "setRangeFontSize")).toHaveLength(2);
  expect(
    t.ranges.filter((r: any) => r.m === "setRangeHyperlink" && r.v).map((r: any) => r.v.value)
  ).toEqual(["https://a.test/ok"]);
});

test("runs with no href set no hyperlink", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, inter)])]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.ranges.some((r: any) => r.m === "setRangeHyperlink")).toBe(false);
});

test("a javascript: href that reaches the applier is not set", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", linkedRuns([0, 5, "javascript:alert(1)"]))]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.ranges.some((r: any) => r.m === "setRangeHyperlink")).toBe(false);
});

test("a link running past the text is clamped", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a"),
    textOp("t", "a", linkedRuns([0, 2], [2, 99, "https://a.test/x"])),
  ]);
  expect((await a.end()).failedOps).toBe(0);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(
    t.ranges.filter((r: any) => r.m === "setRangeHyperlink").map((r: any) => [r.s, r.e])
  ).toEqual([[2, 5]]);
});
