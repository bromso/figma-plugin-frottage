import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type PlanEffect,
  type PlanLayers,
  type PlanOp,
  type PlanRun,
  type PlanTokens,
  type PlanVariable,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { type FakeNode, fakeFigma } from "./fake-figma";

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

test("effects Figma refuses leave the frame and its children, and are counted", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const huge = [{ type: "LAYER_BLUR", radius: Number.POSITIVE_INFINITY }];
  await a.applyBatch([
    frame("a", null, { childCount: 1 }),
    frame("blurred", "a", { effects: huge, name: "blurred", childCount: 1 }),
    frame("inner", "blurred"),
  ]);
  const r = await a.end();
  expect(r).toMatchObject({ failedOps: 0, paintFailures: 1 });
  const blurred = f.created.find((n) => n.name === "blurred");
  expect(blurred?.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
  expect(blurred?.effects).toEqual([]);
  expect(blurred?.children).toHaveLength(1);
  expect(blurred?.opacity).toBe(1);
});

test("fills Figma refuses leave the frame and its children, and are counted", async () => {
  const f = fakeFigma();
  const create = f.figma.createFrame.bind(f.figma);
  f.figma.createFrame = () => {
    const node = create();
    let held: unknown[] = [];
    Object.defineProperty(node, "fills", {
      get: () => held,
      set(v: { opacity?: number }[]) {
        if (v.some((p) => p.opacity === 0.25)) throw new Error("refused paint");
        held = v;
      },
    });
    return node;
  };
  const a = createApplier(f.figma);
  await a.begin(meta);
  const refused = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.25 }];
  await a.applyBatch([
    frame("a", null, { childCount: 1 }),
    frame("painted", "a", { fills: refused, name: "painted", childCount: 1 }),
    frame("inner", "painted"),
  ]);
  const r = await a.end();
  expect(r).toMatchObject({ failedOps: 0, paintFailures: 1 });
  expect(f.created.find((n) => n.name === "painted")?.children).toHaveLength(1);
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
    componentsCreated: 0,
    instancesCreated: 0,
    overrideFailures: 0,
    overrideFailuresInMains: 0,
    layoutFailures: 0,
    hoverVariants: 0,
    hoverFailures: 0,
    paintFailures: 0,
    resizedFallbacks: 0,
    stylesCreated: 0,
    stylesReused: 0,
    variablesCreated: 0,
    variablesReused: 0,
    tokenFailures: 0,
    modes: 0,
    modesDropped: 0,
    droppedVersions: [],
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

test("blur effects set blurType NORMAL and carry no shadow fields", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    frame("a", null, {
      effects: [
        { type: "LAYER_BLUR", radius: 8 },
        { type: "BACKGROUND_BLUR", radius: 20 },
      ],
    }),
  ]);
  const r = await a.end();
  expect(r.failedOps).toBe(0);
  expect(f.node(r.rootId).effects).toEqual([
    { type: "LAYER_BLUR", blurType: "NORMAL", radius: 8, visible: true },
    { type: "BACKGROUND_BLUR", blurType: "NORMAL", radius: 20, visible: true },
  ]);
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

test("wrapped text stays inside a clipping parent it fitted, and counts the rewrap", async () => {
  const f = fakeFigma({ charWidth: 10 });
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([{ ...frame("a"), w: 207 }, wrapped({ x: 100, align: "LEFT" })]);
  const r = await a.end();
  expect(textNodeOf(f).width).toBeLessThanOrEqual(107);
  expect(r.rewrappedTexts).toBe(1);
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

test("gradient fills become gradient paints with their transform and stops", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const transform: [[number, number, number], [number, number, number]] = [
    [1, 0, 0],
    [0, 1, 0],
  ];
  const stops = [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
  ];
  await a.applyBatch([
    frame("a", null, {
      fills: [
        { type: "SOLID", color: { r: 0, g: 1, b: 0 }, opacity: 1 },
        { type: "GRADIENT_LINEAR", transform, stops },
      ],
    }),
  ]);
  expect((await a.end()).failedOps).toBe(0);
  expect(f.lastFrame().fills).toEqual([
    { type: "SOLID", color: { r: 0, g: 1, b: 0 }, opacity: 1 },
    { type: "GRADIENT_LINEAR", gradientTransform: transform, gradientStops: stops },
  ]);
});

/** Where the middle of a node's box is in its parent, which a turn must not move. */
function centreOf(n: FakeNode): [number, number] {
  const [[a, b, tx], [c, d, ty]] = n.relativeTransform as [
    [number, number, number],
    [number, number, number],
  ];
  return [tx + (a * n.width) / 2 + (b * n.height) / 2, ty + (c * n.width) / 2 + (d * n.height) / 2];
}

test("a rotated frame turns about the centre the capture had", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), frame("b", "a", { x: 20, y: 30, w: 80, h: 40, rotation: 30 })]);
  const r = await a.end();
  const b = f.node(r.rootId).children[0];
  const [cx, cy] = centreOf(b);
  expect(cx).toBeCloseTo(20 + 40, 6);
  expect(cy).toBeCloseTo(30 + 20, 6);
  // Clockwise on screen: Figma's `rotation` reads back as the negative angle.
  expect(b.rotation).toBeCloseTo(-30, 6);
  expect([b.width, b.height]).toEqual([80, 40]);
});

test("a frame without rotation never has its transform written", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), frame("b", "a")]);
  await a.end();
  expect(f.count("relativeTransform")).toBe(0);
});

test("image, svg and missing-image layers rotate too", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("abc", png);
  await a.applyBatch([
    frame("a"),
    { ...imageOp("abc"), x: 10, y: 10, w: 40, h: 20, rotation: 90 } as PlanOp,
    svgOp("<svg/>", { rotation: -15 }),
    { ...imageOp("gone"), id: "gone", rotation: 45 } as PlanOp,
  ]);
  const r = await a.end();
  const [img, vec, gone] = f.node(r.rootId).children;
  expect(img.rotation).toBeCloseTo(-90, 6);
  expect(vec.rotation).toBeCloseTo(15, 6);
  expect(gone.rotation).toBeCloseTo(-45, 6);
  const [cx, cy] = centreOf(img);
  expect([cx, cy].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([30, 20]);
});

describe("binding to the layered collections", () => {
  type Rgba = { r: number; g: number; b: number; a: number };
  const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
  const SHADE: Rgba = { r: 0, g: 0, b: 0, a: 0.5 };
  const BLACK = { r: 0, g: 0, b: 0 };
  const rawRadius: PlanVariable = {
    key: "radius:radius/lg",
    name: "radius/lg",
    collection: "radius",
    type: "FLOAT",
    values: [8],
    description: "From the site: --radius",
    scopes: ["CORNER_RADIUS"],
    cssVar: "--radius",
  };
  const paper: PlanVariable = {
    key: "palette:white",
    name: "white",
    collection: "palette",
    type: "COLOR",
    values: [WHITE],
    description: "From the site: --white",
    scopes: ["ALL_SCOPES"],
  };
  const shade: PlanVariable = { ...paper, key: "palette:shade", name: "shade", values: [SHADE] };
  // Opaque in Light, translucent in Dark: the variable carries the alpha.
  const modeCard: PlanVariable = {
    key: "colorMode:card",
    name: "card",
    collection: "colorMode",
    type: "COLOR",
    values: [{ alias: paper.key }, { alias: shade.key }],
    description: "From the site: --card",
    scopes: ["ALL_SCOPES"],
    cssVar: "--card",
  };
  const themeOf = (source: PlanVariable, name: string, from: string): PlanVariable => ({
    ...source,
    key: `theme:${name}`,
    name,
    collection: "theme",
    values: [{ alias: source.key }],
    description: `Final theme token; source: ${from}`,
  });
  // Layers bind only to Theme.
  const card = themeOf(modeCard, "color/card", "Color Mode");
  const radius = themeOf(rawRadius, "radius/lg", "Border radius");
  const shadow: PlanEffect = {
    type: "DROP_SHADOW",
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 1 },
    radius: 2,
    spread: 0,
  };
  const gradientPaint = {
    type: "GRADIENT_LINEAR" as const,
    transform: [
      [1, 0, 0],
      [0, 1, 0],
    ] as [[number, number, number], [number, number, number]],
    stops: [
      { position: 0, color: WHITE },
      { position: 1, color: { ...BLACK, a: 1 } },
    ],
  };
  const layers: PlanLayers = {
    hostname: "example.com",
    modes: ["Light", "Dark"],
    themeSource: "site",
    collections: [
      { kind: "palette", name: "Palette", modes: ["Base"] },
      { kind: "radius", name: "Border radius", modes: ["Base"] },
      { kind: "colorMode", name: "Color Mode", modes: ["Light", "Dark"] },
      { kind: "theme", name: "Theme", modes: ["Default"] },
    ],
    variables: [paper, shade, rawRadius, modeCard, card, radius],
    effectStyles: [{ key: "shadow:sm", name: "shadow/sm", shadows: [shadow], colorKeys: [null] }],
    gradientStyles: [
      { key: "gradient:1", name: "gradient/1", paint: gradientPaint, stopKeys: [card.key, null] },
    ],
    notes: { twins: [], inferred: [], droppedPrimitives: 0 },
  };
  const plan: PlanTokens = { textStyles: [], colors: [], collection: "example.com", layers };

  async function layered(ops: PlanOp[], over: object = {}, tokens = true, with_ = plan) {
    const f = fakeFigma(over);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(with_, { ...DEFAULT_IMPORT_OPTIONS, tokens });
    await a.applyBatch(ops);
    const r = await a.end();
    return { f, r, root: f.node(r.rootId) };
  }
  const collectionNamed = (f: ReturnType<typeof fakeFigma>, name: string): any =>
    [...f.tokens.collections.values()].find((c) => c.name === name);
  /** A Theme variable by name: the only ones a layer binds to. */
  const variableNamed = (f: ReturnType<typeof fakeFigma>, name: string): any =>
    [...f.tokens.variables.values()].find(
      (v) => v.name === name && v.variableCollectionId === collectionNamed(f, "Theme")?.id
    );
  const allKeys = [radius.key, radius.key, radius.key, radius.key] as [
    string,
    string,
    string,
    string,
  ];

  test("a frame's four corners bind to their radius variables", async () => {
    const { f, root } = await layered([frame("a", null, { radiusKeys: allKeys })]);
    const id = variableNamed(f, "radius/lg").id;
    for (const corner of [
      "topLeftRadius",
      "topRightRadius",
      "bottomRightRadius",
      "bottomLeftRadius",
    ]) {
      expect(root.boundVariables?.[corner]?.id).toBe(id);
    }
    expect(root.topLeftRadius).toBe(1);
  });

  test("a corner without a key, or one Figma refuses, keeps its raw value", async () => {
    const keys = [radius.key, undefined, "theme:radius/none", radius.key];
    const { f, root, r } = await layered([frame("a", null, { radiusKeys: keys })], {
      failRadiusBinding: "bottomLeftRadius",
    });
    expect(Object.keys(root.boundVariables ?? {})).toEqual(["topLeftRadius"]);
    expect(root.bottomLeftRadius).toBe(4);
    expect(r.tokenFailures).toBe(1);
    expect(variableNamed(f, "radius/lg")).toBeDefined();
  });

  test("an image's corners bind to their radius variables, and a missing image's too", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens(plan, { ...DEFAULT_IMPORT_OPTIONS, tokens: true });
    await a.addImage("abc", png);
    const rounded = (hash: string, id: string): PlanOp => ({
      ...(imageOp(hash) as Extract<PlanOp, { op: "image" }>),
      id,
      radius: [16, 16, 16, 16],
      radiusKeys: allKeys,
    });
    await a.applyBatch([frame("a"), rounded("abc", "img"), rounded("gone", "img2")]);
    await a.end();
    const id = variableNamed(f, "radius/lg").id;
    const picture = f.lastRectangle();
    const missing = f.lastFrame();
    expect(missing.name).toContain("Image (missing)");
    for (const node of [picture, missing]) {
      for (const corner of [
        "topLeftRadius",
        "topRightRadius",
        "bottomRightRadius",
        "bottomLeftRadius",
      ]) {
        expect(node.boundVariables?.[corner]?.id).toBe(id);
      }
    }
  });

  test("a translucent paint bound to a variable holding alpha takes opacity 1", async () => {
    const fills = [{ type: "SOLID", color: BLACK, opacity: 0.5, colorKey: card.key }];
    const stroke = {
      color: BLACK,
      opacity: 0.5,
      colorKey: card.key,
      weights: { top: 1, right: 1, bottom: 1, left: 1 },
    };
    const run_ = { ...run(0, 5, inter), opacity: 0.5, colorKey: card.key };
    const { f, root } = await layered([
      frame("a", null, { fills, strokes: stroke, childCount: 1 }),
      textOp("t", "a", [run_]),
    ]);
    const id = variableNamed(f, "color/card").id;
    const runFill = root.children[0].ranges.find((x: any) => x.m === "setRangeFills").v[0];
    for (const paint of [root.fills[0], root.strokes[0], runFill]) {
      expect(paint.boundVariables.color.id).toBe(id);
      expect(paint.opacity).toBe(1);
    }
  });

  test("a paint whose binding fails keeps its captured opacity", async () => {
    const fills = [{ type: "SOLID", color: BLACK, opacity: 0.5, colorKey: card.key }];
    const { root, r } = await layered([frame("a", null, { fills })], {
      failTokens: ["setBoundVariableForPaint"],
    });
    expect(root.fills[0].boundVariables).toBeUndefined();
    expect(root.fills[0].opacity).toBe(0.5);
    expect(r.tokenFailures).toBe(1);
  });

  test("a frame whose shadows match an effect style links it and sets no loose effects", async () => {
    const { f, root } = await layered([
      frame("a", null, { effects: [shadow], effectStyleKey: "shadow:sm" }),
    ]);
    const [style] = [...f.tokens.effectStyles.values()];
    expect(root.effectStyleId).toBe(style.id);
    expect(root.effects).toBe(style.effects);
  });

  test("a frame whose effect style is missing keeps its effects loose", async () => {
    const { root } = await layered([
      frame("a", null, { effects: [shadow], effectStyleKey: "shadow:nothing" }),
    ]);
    expect(root.effectStyleId).toBeUndefined();
    expect(root.effects).toHaveLength(1);
    expect(root.effects[0].radius).toBe(2);
  });

  test("a frame whose effect style won't link keeps its effects loose", async () => {
    const { root, r } = await layered(
      [frame("a", null, { effects: [shadow], effectStyleKey: "shadow:sm" })],
      { failTokens: ["setEffectStyleIdAsync"] }
    );
    expect(root.effectStyleId).toBeUndefined();
    expect(root.effects).toHaveLength(1);
    expect(r.tokenFailures).toBe(1);
  });

  test("a gradient fill with a style links the paint style", async () => {
    const fills = [{ ...gradientPaint, gradientStyleKey: "gradient:1" }];
    const { f, root } = await layered([frame("a", null, { fills })]);
    const [style] = [...f.tokens.paintStyles.values()];
    expect(root.fillStyleId).toBe(style.id);
  });

  test("a raw color links to the user's matching paint style; a bound one stays bound", async () => {
    const INK = { r: 0.2, g: 0.4, b: 0.6 };
    const styled = {
      ...plan,
      layers: {
        ...layers,
        styleColors: [{ key: "paint:#336699", rgba: { ...INK, a: 1 }, uses: 3 }],
      },
    };
    const raw = [{ type: "SOLID", color: INK, opacity: 1, colorKey: "paint:#336699" }];
    const bound = [{ type: "SOLID", color: WHITE, opacity: 1, colorKey: card.key }];
    const run_ = { ...run(0, 5, inter), color: INK, colorKey: "paint:#336699" };
    const setup = (useLocalStyles: boolean) => {
      const f = fakeFigma();
      const ink = f.tokens.seedPaintStyle("Ink", [
        { type: "SOLID", color: INK, opacity: 1, blendMode: "NORMAL", visible: true },
      ]);
      // A paint style of the card's color too: the variable still wins.
      f.tokens.seedPaintStyle("Paper", [{ type: "SOLID", color: WHITE, opacity: 1 }]);
      return { f, ink, useLocalStyles };
    };
    for (const on of [true, false]) {
      const { f, ink } = setup(on);
      const a = createApplier(f.figma);
      await a.begin(meta);
      await a.importTokens(styled, { ...DEFAULT_IMPORT_OPTIONS, useLocalStyles: on });
      await a.applyBatch([
        frame("a", null, { fills: raw, childCount: 2 }),
        frame("b", "a", { fills: bound }),
        textOp("t", "a", [run_]),
      ]);
      const r = await a.end();
      const root = f.node(r.rootId);
      expect(root.fillStyleId).toBe(on ? ink.id : undefined);
      const text = root.children[1];
      const linked = (text.ranges ?? []).find((x: any) => x.m === "setRangeFillStyleIdAsync");
      expect(linked?.v).toBe(on ? ink.id : undefined);
      expect(root.children[0].fillStyleId).toBeUndefined();
      expect(root.children[0].fills[0].boundVariables.color.id).toBe(
        variableNamed(f, "color/card").id
      );
      expect(r.stylesReused).toBe(on ? 1 : 0);
    }
  });

  test("the imported root opens on Color Mode's Light mode", async () => {
    const { f, root } = await layered([frame("a", null, { childCount: 1 }), frame("b", "a")]);
    const theme = collectionNamed(f, "Color Mode");
    const light = theme.modes.find((m: { name: string }) => m.name === "Light").modeId;
    expect(root.explicitModes).toEqual({ [theme.id]: light });
    expect(root.children[0].explicitModes).toEqual({});
  });

  test("a page captured in Dark opens on Color Mode's Dark mode", async () => {
    const dark = { ...plan, layers: { ...layers, activeMode: "Dark" } };
    const { f, root } = await layered([frame("a")], {}, true, dark);
    const theme = collectionNamed(f, "Color Mode");
    const mode = theme.modes.find((m: { name: string }) => m.name === "Dark").modeId;
    expect(root.explicitModes).toEqual({ [theme.id]: mode });
  });

  test("an active mode the file had no room for opens on Light", async () => {
    const sepia = { ...plan, layers: { ...layers, activeMode: "Sepia" } };
    const { f, root } = await layered([frame("a")], {}, true, sepia);
    const theme = collectionNamed(f, "Color Mode");
    const light = theme.modes.find((m: { name: string }) => m.name === "Light").modeId;
    expect(root.explicitModes).toEqual({ [theme.id]: light });
  });

  test("a refused Light mode counts and the page still imports", async () => {
    const { root, r } = await layered([frame("a")], { failExplicitMode: true });
    expect(root.explicitModes).toEqual({});
    expect(r.tokenFailures).toBe(1);
  });

  test("with tokens off nothing is bound", async () => {
    const fills = [{ type: "SOLID", color: BLACK, opacity: 0.5, colorKey: card.key }];
    const { f, root } = await layered(
      [
        frame("a", null, {
          fills,
          radiusKeys: allKeys,
          effects: [shadow],
          effectStyleKey: "shadow:sm",
        }),
      ],
      {},
      false
    );
    expect(f.tokens.variables.size).toBe(0);
    expect(root.boundVariables).toBeUndefined();
    expect(root.fills[0]).toEqual({ type: "SOLID", color: BLACK, opacity: 0.5 });
    expect(root.effectStyleId).toBeUndefined();
    expect(root.effects).toHaveLength(1);
    expect(root.explicitModes).toEqual({});
  });
});

describe("a device set", () => {
  type Rgba = { r: number; g: number; b: number; a: number };
  const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
  const NIGHT: Rgba = { r: 0.125, g: 0.125, b: 0.25, a: 1 };
  const base = { description: "", scopes: ["ALL_SCOPES"] };
  const paper: PlanVariable = {
    ...base,
    key: "palette:white",
    name: "white",
    collection: "palette",
    type: "COLOR",
    values: [WHITE],
  };
  const night: PlanVariable = { ...paper, key: "palette:night", name: "night", values: [NIGHT] };
  const deviceWidth: PlanVariable = {
    ...base,
    key: "device:device/width",
    name: "device/width",
    collection: "device",
    type: "FLOAT",
    values: [1440, 768, 390],
  };
  const minWidth: PlanVariable = {
    ...base,
    key: "breakpoint:breakpoint/min-width",
    name: "breakpoint/min-width",
    collection: "breakpoint",
    type: "FLOAT",
    values: [0, 768, 1024],
  };
  const gap: PlanVariable = {
    ...minWidth,
    key: "breakpoint:gap",
    name: "gap",
    values: [16, 24, 32],
  };
  const modeCard: PlanVariable = {
    ...base,
    key: "colorMode:card",
    name: "card",
    collection: "colorMode",
    type: "COLOR",
    values: [{ alias: paper.key }, { alias: night.key }],
  };
  const card: PlanVariable = {
    ...modeCard,
    key: "theme:color/card",
    name: "color/card",
    collection: "theme",
    values: [{ alias: modeCard.key }],
  };
  const themeGap: PlanVariable = {
    ...gap,
    key: "theme:spacing/gap",
    name: "spacing/gap",
    collection: "theme",
    values: [{ alias: gap.key }],
  };
  const layers: PlanLayers = {
    hostname: "example.com",
    modes: ["Light", "Dark"],
    themeSource: "site",
    collections: [
      { kind: "palette", name: "Palette", modes: ["Base"] },
      { kind: "device", name: "Device", modes: ["Desktop", "Tablet", "Phone"] },
      { kind: "breakpoint", name: "Breakpoint", modes: ["base", "md", "lg"] },
      { kind: "colorMode", name: "Color Mode", modes: ["Light", "Dark"] },
      { kind: "theme", name: "Theme", modes: ["Default"] },
    ],
    variables: [paper, night, deviceWidth, minWidth, gap, modeCard, card, themeGap],
    effectStyles: [],
    gradientStyles: [],
    notes: { twins: [], inferred: [], droppedPrimitives: 0 },
  };
  // As the mapper gives them, without breakpoints: no Breakpoint collection, and Theme reads raw.
  const flat: PlanLayers = {
    ...layers,
    collections: layers.collections.filter((c) => c.kind !== "breakpoint"),
    variables: [paper, night, deviceWidth, modeCard, card],
  };
  const DEVICES = [
    { device: "Desktop", breakpoint: "lg", w: 1440 },
    { device: "Tablet", breakpoint: "md", w: 768 },
    { device: "Phone", breakpoint: "base", w: 390 },
  ];
  const fills = [{ type: "SOLID", color: WHITE, opacity: 1, colorKey: card.key }];
  const TITLE = "Pricing | Acme";

  type Run = {
    placement?: "new-page" | "current-page";
    plan?: PlanLayers;
    devices?: { device: string; breakpoint: string | null; w: number }[];
    /** Cancels after this many devices have begun, before that one ends. */
    cancelAt?: number;
  };
  async function importDevices(f: ReturnType<typeof fakeFigma>, run_: Run = {}) {
    const plan = run_.plan ?? layers;
    const a = createApplier(f.figma);
    await a.beginDeviceSet({
      name: TITLE,
      layers: plan,
      options: DEFAULT_IMPORT_OPTIONS,
      placement: run_.placement ?? "current-page",
    });
    for (const [index, d] of (run_.devices ?? DEVICES).entries()) {
      await a.begin({
        ...meta,
        name: TITLE,
        version: { index, label: d.device },
        device: { mode: d.device, breakpoint: d.breakpoint },
      });
      await a.importTokens(
        { textStyles: [], colors: [], collection: "example.com", layers: plan },
        DEFAULT_IMPORT_OPTIONS
      );
      await a.applyBatch([
        frame("a", null, { w: d.w, h: 800, fills, childCount: 1 }),
        frame("b", "a", { fills, layout: { mode: "NONE" } }),
      ]);
      if (run_.cancelAt === index) {
        await a.cancel();
        return { a, r: null };
      }
      await a.end();
    }
    return { a, r: await a.endSet() };
  }
  const collections = (f: ReturnType<typeof fakeFigma>): any[] => [
    ...f.tokens.collections.values(),
  ];
  const collectionNamed = (f: ReturnType<typeof fakeFigma>, name: string): any =>
    collections(f).find((c) => c.name === name);
  const modeIn = (c: any, name: string) =>
    c.modes.find((m: { name: string }) => m.name === name)?.modeId;
  const sectionOf = (f: ReturnType<typeof fakeFigma>): FakeNode =>
    f.created.find((n) => n.type === "SECTION" && n.name === TITLE) as FakeNode;
  const themeVariable = (f: ReturnType<typeof fakeFigma>, name: string): any =>
    [...f.tokens.variables.values()].find(
      (v) => v.name === name && v.variableCollectionId === collectionNamed(f, "Theme")?.id
    );

  test("puts one frame per device side by side in one section on the current page", async () => {
    const f = fakeFigma();
    const { r } = await importDevices(f);
    const section = sectionOf(f);
    expect(section.parent).toBe(f.page);
    const frames = section.children;
    expect(frames.map((n: FakeNode) => n.name)).toEqual([
      `${TITLE} — Desktop`,
      `${TITLE} — Tablet`,
      `${TITLE} — Phone`,
    ]);
    expect(r?.rootIds).toEqual(frames.map((n: FakeNode) => n.id));
    expect(r?.plainVersions).toEqual([]);
    for (const [i, n] of frames.entries()) {
      expect(n.width).toBe(DEVICES[i]?.w as number);
      expect(n.y).toBe(frames[0].y);
      if (i > 0) expect(n.x).toBe(frames[i - 1].x + frames[i - 1].width + 200);
    }
    const last = frames[2];
    expect(section.width).toBeGreaterThanOrEqual(last.x + last.width);
    expect(section.height).toBeGreaterThanOrEqual(last.y + last.height);
    expect(f.page.selection).toEqual([section]);
    expect(f.pages).toHaveLength(1);
  });

  test("each frame takes its Device and Breakpoint modes; the section takes Color Mode", async () => {
    const f = fakeFigma();
    await importDevices(f);
    const device = collectionNamed(f, "Device");
    const breakpoint = collectionNamed(f, "Breakpoint");
    const colorMode = collectionNamed(f, "Color Mode");
    const section = sectionOf(f);
    for (const [i, n] of section.children.entries()) {
      const d = DEVICES[i] as (typeof DEVICES)[number];
      expect(n.explicitModes).toEqual({
        [device.id]: modeIn(device, d.device),
        [breakpoint.id]: modeIn(breakpoint, d.breakpoint),
      });
      expect(n.children[0].explicitModes).toEqual({});
    }
    expect(section.explicitModes).toEqual({ [colorMode.id]: modeIn(colorMode, "Light") });
  });

  test("a page captured in Dark opens its section on Dark", async () => {
    const f = fakeFigma();
    await importDevices(f, { plan: { ...layers, activeMode: "Dark" } });
    const colorMode = collectionNamed(f, "Color Mode");
    expect(sectionOf(f).explicitModes).toEqual({ [colorMode.id]: modeIn(colorMode, "Dark") });
  });

  test("makes each collection once, and every frame binds to the same Theme variables", async () => {
    const f = fakeFigma();
    const { r } = await importDevices(f);
    expect(collections(f).map((c) => c.name)).toEqual([
      "Palette",
      "Device",
      "Breakpoint",
      "Color Mode",
      "Theme",
    ]);
    expect(f.tokens.variables.size).toBe(layers.variables.length);
    expect(r?.variablesCreated).toBe(layers.variables.length);
    expect(r?.variablesReused).toBe(0);
    const id = themeVariable(f, "color/card").id;
    for (const n of sectionOf(f).children) {
      expect(n.fills[0].boundVariables.color.id).toBe(id);
      expect(n.children[0].fills[0].boundVariables.color.id).toBe(id);
    }
  });

  test("the devices share their text styles: the first settles each, once", async () => {
    const f = fakeFigma();
    const body = {
      key: "body-key",
      name: "body/1",
      uses: 3,
      fontName: inter,
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0,
      decoration: "NONE" as const,
      textCase: "ORIGINAL" as const,
    };
    const a = createApplier(f.figma);
    await a.beginDeviceSet({
      name: TITLE,
      layers,
      options: DEFAULT_IMPORT_OPTIONS,
      placement: "current-page",
    });
    for (const [index, d] of DEVICES.entries()) {
      await a.begin({
        ...meta,
        version: { index, label: d.device },
        device: { mode: d.device, breakpoint: d.breakpoint },
      });
      await a.importTokens(
        { textStyles: [body], colors: [], collection: "example.com", layers },
        DEFAULT_IMPORT_OPTIONS
      );
      await a.applyBatch([frame("a", null, { fills })]);
      await a.end();
    }
    const r = await a.endSet();
    expect(f.tokens.textStyles.size).toBe(1);
    expect(r.stylesCreated).toBe(1);
    expect(r.stylesReused).toBe(0);
    expect(r.variablesCreated).toBe(layers.variables.length);
  });

  test("a set without breakpoints sets no Breakpoint mode", async () => {
    const f = fakeFigma();
    const devices = DEVICES.map((d) => ({ ...d, breakpoint: null }));
    await importDevices(f, { plan: flat, devices });
    expect(collectionNamed(f, "Breakpoint")).toBeUndefined();
    const device = collectionNamed(f, "Device");
    for (const [i, n] of sectionOf(f).children.entries()) {
      expect(n.explicitModes).toEqual({ [device.id]: modeIn(device, DEVICES[i]?.device) });
    }
  });

  test("new-page puts the section on a new page named after the site, and opens it", async () => {
    const f = fakeFigma();
    await importDevices(f, { placement: "new-page" });
    expect(f.pages).toHaveLength(2);
    const made = f.pages[1] as FakeNode;
    expect(made.name).toBe("example.com");
    expect(sectionOf(f).parent).toBe(made);
    expect(made.children).toEqual([sectionOf(f)]);
    expect(f.figma.currentPage).toBe(made as unknown as PageNode);
    expect(made.selection).toEqual([sectionOf(f)]);
    expect(f.page.children.some((n: FakeNode) => n.type === "FRAME")).toBe(false);
  });

  test("new-page numbers the page when one is named after the site already", async () => {
    const f = fakeFigma();
    const first = await importDevices(f, { placement: "new-page" });
    expect(first.r?.rootIds).toHaveLength(3);
    await importDevices(f, { placement: "new-page" });
    expect(f.pages.map((p: FakeNode) => p.name)).toEqual([
      "Page 1",
      "example.com",
      "example.com (2)",
    ]);
  });

  test("cancel mid-set removes the section, its frames and the collections it made", async () => {
    for (const placement of ["current-page", "new-page"] as const) {
      const f = fakeFigma();
      await importDevices(f, { placement, cancelAt: 1 });
      const section = sectionOf(f);
      expect(section.removed).toBe(true);
      expect(
        f.created.filter((n) => n.type === "FRAME" && !n.removed && !n.parent?.removed)
      ).toEqual([]);
      expect(f.page.children).toEqual([]);
      expect(f.tokens.collections.size).toBe(0);
      expect(f.tokens.variables.size).toBe(0);
      // Back on the page the user was on: Figma won't remove the open page.
      expect(f.pages).toEqual([f.page]);
      expect(f.figma.currentPage).toBe(f.page as unknown as PageNode);
    }
  });

  /** Nothing of an import is left: no section, frame, page, collection or variable. */
  const nothingLeft = (f: ReturnType<typeof fakeFigma>) => {
    expect(
      f.created.filter((n) => !n.removed && !n.parent?.removed && n.parent === f.page)
    ).toEqual([]);
    expect(f.pages).toEqual([f.page]);
    expect(f.figma.currentPage).toBe(f.page as unknown as PageNode);
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.variables.size).toBe(0);
  };
  const open = (placement: "new-page" | "current-page") => ({
    name: TITLE,
    layers,
    options: DEFAULT_IMPORT_OPTIONS,
    placement,
  });

  test("a cancel while an earlier import is being taken back stops the set opening", async () => {
    for (const placement of ["current-page", "new-page"] as const) {
      const f = fakeFigma();
      const a = createApplier(f.figma);
      await a.beginDeviceSet(open("current-page"));
      // Takes the first set's collections back, which it waits for before making anything.
      const second = a.beginDeviceSet(open(placement));
      await a.cancel();
      await second;
      expect(f.count("createPage")).toBe(0);
      expect(f.created.filter((n) => n.type === "SECTION")).toHaveLength(1);
      nothingLeft(f);
    }
  });

  test("a cancel while the new page loads removes it and makes nothing", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    f.hold("page.loadAsync", (done) => {
      void a.cancel().then(done);
    });
    await a.beginDeviceSet(open("new-page"));
    expect(f.count("createPage")).toBe(1);
    expect(f.count("createSection")).toBe(0);
    expect(f.tokens.log).not.toContain("createVariableCollection");
    nothingLeft(f);
  });

  test("a cancel while switching to the new page goes back and removes it", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    f.hold("setCurrentPageAsync", (done) => {
      f.hold("setCurrentPageAsync", null);
      void a.cancel().then(done);
    });
    await a.beginDeviceSet(open("new-page"));
    expect(f.count("createSection")).toBe(0);
    nothingLeft(f);
  });

  test("a device's mains sit under the section from the start, on its Color Mode", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginDeviceSet({ ...open("current-page"), layers: { ...layers, activeMode: "Dark" } });
    await a.begin({
      ...meta,
      version: { index: 0, label: "Desktop" },
      device: { mode: "Desktop", breakpoint: "lg" },
    });
    await a.applyBatch([
      frame("btn/n", null, {
        name: "btn",
        x: 0,
        y: 0,
        fills,
        component: { key: "btn", name: "btn" },
      }),
      frame("a", null, { w: 1440, h: 800, fills }),
    ]);
    await a.end();
    const section = sectionOf(f);
    const mains = f.created.find((n) => n.type === "SECTION" && n !== section) as FakeNode;
    // Before endSet: under the section, not near the page's origin over what is there.
    expect(mains.y).toBeGreaterThanOrEqual(section.y + section.height);
    expect(mains.x).toBe(section.x + section.children[0].x);
    const colorMode = collectionNamed(f, "Color Mode");
    expect(mains.explicitModes).toEqual({ [colorMode.id]: modeIn(colorMode, "Dark") });
    expect(section.explicitModes).toEqual(mains.explicitModes);
    await a.endSet();
    expect(mains.y).toBeGreaterThanOrEqual(section.y + section.height);
  });

  test("a frame the file had no Breakpoint mode for stays plain; no Device mode still binds", async () => {
    // Room for two modes: Phone has no Device mode, and lg (Desktop's range) no Breakpoint mode.
    const f = fakeFigma({ modeLimit: 2 });
    const { r } = await importDevices(f);
    const device = collectionNamed(f, "Device");
    const breakpoint = collectionNamed(f, "Breakpoint");
    const [desktop, tablet, phone] = sectionOf(f).children;
    expect(desktop.fills[0].boundVariables).toBeUndefined();
    expect(desktop.explicitModes).toEqual({});
    expect(tablet.fills[0].boundVariables).toBeDefined();
    expect(tablet.explicitModes).toEqual({
      [device.id]: modeIn(device, "Tablet"),
      [breakpoint.id]: modeIn(breakpoint, "md"),
    });
    expect(phone.fills[0].boundVariables).toBeDefined();
    expect(phone.explicitModes).toEqual({ [breakpoint.id]: modeIn(breakpoint, "base") });
    expect(f.storage.get("modeLimit")).toBe(2);
    expect(r?.plainVersions).toEqual([0]);
  });

  test("with Breakpoint modes in the mapper's order, a limit drops the extras' ranges first", async () => {
    // Frames' ranges first, widest device's first; `sm`, an extra's, last.
    const ordered: PlanLayers = {
      ...layers,
      collections: layers.collections.map((c) =>
        c.kind === "breakpoint" ? { ...c, modes: ["lg", "md", "base", "sm"] } : c
      ),
      variables: layers.variables.map((v) =>
        v.collection === "breakpoint" ? { ...v, values: [...[...v.values].reverse(), 0] } : v
      ),
    };
    const run = async (modeLimit: number) => {
      const f = fakeFigma({ modeLimit });
      const { r } = await importDevices(f, { plan: ordered });
      return { f, r, breakpoint: collectionNamed(f, "Breakpoint") };
    };
    const four = await run(4);
    expect(four.breakpoint.modes.map((m: { name: string }) => m.name)).toEqual([
      "lg",
      "md",
      "base",
      "sm",
    ]);
    expect(four.r?.plainVersions).toEqual([]);
    const three = await run(3);
    expect(three.breakpoint.modes.map((m: { name: string }) => m.name)).toEqual([
      "lg",
      "md",
      "base",
    ]);
    expect(three.r?.plainVersions).toEqual([]);
    const one = await run(1);
    const [desktop] = sectionOf(one.f).children;
    expect(desktop.explicitModes).toEqual({
      [collectionNamed(one.f, "Device").id]: modeIn(collectionNamed(one.f, "Device"), "Desktop"),
      [one.breakpoint.id]: modeIn(one.breakpoint, "lg"),
    });
    expect(one.r?.plainVersions).toEqual([1, 2]);
  });

  test("a refused Device mode leaves the frame plain and counts", async () => {
    // The section's Color Mode is the first explicit mode; Desktop's Device mode the second.
    const f = fakeFigma({ failExplicitMode: 2 });
    const { r } = await importDevices(f, {
      plan: flat,
      devices: DEVICES.map((d) => ({ ...d, breakpoint: null })),
    });
    for (const n of sectionOf(f).children) {
      expect(n.fills[0].boundVariables).toBeUndefined();
      expect(n.explicitModes).toEqual({});
    }
    expect(r?.tokenFailures).toBe(3);
    expect(r?.plainVersions).toEqual([0, 1, 2]);
  });

  test("a Stage 3 set still lays its frames on the page, with no section", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    for (const [index, label] of ["Light", "Dark"].entries()) {
      await a.begin({ ...meta, version: { index, label } });
      await a.applyBatch([frame("a")]);
      await a.end();
    }
    const r = await a.endSet();
    expect(r.rootIds).toHaveLength(2);
    expect(f.created.some((n) => n.type === "SECTION")).toBe(false);
    expect(r.rootIds.map((id) => f.node(id).parent)).toEqual([f.page, f.page]);
  });
});
