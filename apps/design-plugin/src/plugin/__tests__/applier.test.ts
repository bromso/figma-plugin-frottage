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
});

test("applies frames and text in order under one root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([frame("a"), textOp("t", "a", [run(0, 5, inter)])]);
  const r = await a.end();
  expect(f.node(r.rootId).children).toHaveLength(1);
  expect(f.node(r.rootId).children[0].children).toHaveLength(1);
  expect(f.node(r.rootId).children[0].clipsContent).toBe(true);
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
      label: "Video",
    },
  ]);
  expect(f.lastFrame().name).toBe("Video");
  expect(f.lastFrame().fills[0].opacity).toBe(0.08);
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
  expect(f.node(r.rootId).children[0].children).toHaveLength(1);
});

test("commits undo once around the import and selects the root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
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
  const r = await a.end();
  expect(f.node(r.rootId).x).toBe(400);
  expect(f.node(r.rootId).y).toBe(0);
});

test("a second begin removes the partial root", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  const first = f.created[0];
  await a.begin(meta);
  expect(first.removed).toBe(true);
});
