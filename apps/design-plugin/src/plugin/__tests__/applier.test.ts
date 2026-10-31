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
const textOp = (id: string, parent: string, runs: PlanRun[], wrap = false): PlanOp => ({
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
  expect(r).toEqual({ rootId: "", failedOps: 1, missingImages: 0 });
});

test("a failed root op is counted once and fails its children", async () => {
  const f = fakeFigma({ failOn: "a" });
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

test("centred single-line text keeps the captured box width", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const op = { ...textOp("t", "a", [run(0, 5, inter)]), align: "CENTER" } as PlanOp;
  await a.applyBatch([frame("a"), op]);
  const t = f.created.find((n) => n.type === "TEXT") as any;
  expect(t.textAutoResize).toBe("HEIGHT");
  expect(t.width).toBe(80);
  expect(t.textAlignHorizontal).toBe("CENTER");
});
