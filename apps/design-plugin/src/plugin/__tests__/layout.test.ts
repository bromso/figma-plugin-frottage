import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { FontRef, PlanChildLayout, PlanLayout, PlanOp, PlanRun } from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { fakeFigma } from "./fake-figma";

const inter: FontRef = { family: "Inter", style: "Regular" };
const meta = { name: "", fonts: [inter], totalOps: 0 };

type Box = [x: number, y: number, w: number, h: number];
type Auto = Extract<PlanLayout, { mode: "HORIZONTAL" | "VERTICAL" }>;

const row = (over: Partial<Auto> = {}): Auto => ({
  mode: "HORIZONTAL",
  wrap: false,
  itemSpacing: 10,
  counterSpacing: null,
  padding: [0, 0, 0, 0],
  primaryAlign: "MIN",
  counterAlign: "MIN",
  sizingH: "FIXED",
  sizingV: "FIXED",
  ...over,
});
const stack = (over: Partial<Auto> = {}) => row({ mode: "VERTICAL", ...over });

const flowChild = (over: Partial<PlanChildLayout> = {}): PlanChildLayout => ({
  positioning: "AUTO",
  sizingH: "FIXED",
  sizingV: "FIXED",
  ...over,
});

const frameOp = (
  id: string,
  parent: string | null,
  box: Box,
  layout: PlanLayout,
  childCount: number,
  childLayout?: PlanChildLayout
): PlanOp => ({
  op: "frame",
  id,
  parent,
  name: id,
  x: box[0],
  y: box[1],
  w: box[2],
  h: box[3],
  fills: [],
  strokes: null,
  radius: [0, 0, 0, 0],
  opacity: 1,
  effects: [],
  clips: false,
  layout,
  childCount,
  ...(childLayout ? { childLayout } : {}),
});

/** A plain box: what a placeholder op makes, and the simplest non-text child there is. */
const boxOp = (
  id: string,
  parent: string,
  box: Box,
  childLayout: PlanChildLayout | undefined = flowChild()
): PlanOp => ({
  op: "placeholder",
  id,
  parent,
  name: id,
  x: box[0],
  y: box[1],
  w: box[2],
  h: box[3],
  opacity: 1,
  label: id,
  ...(childLayout ? { childLayout } : {}),
});

const run = (end: number): PlanRun => ({
  start: 0,
  end,
  fontName: inter,
  fontSize: 12,
  lineHeight: null,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0 },
  opacity: 1,
  decoration: "NONE",
  textCase: "ORIGINAL",
});

/** Measured as the fake measures it: 5 px a character, 12 px a line. */
const textOp = (
  id: string,
  parent: string,
  box: Box,
  text: string,
  extra: Partial<Extract<PlanOp, { op: "text" }>> = {},
  childLayout: PlanChildLayout = flowChild({ sizingH: "HUG", sizingV: "HUG" })
): PlanOp => ({
  op: "text",
  id,
  parent,
  name: id,
  x: box[0],
  y: box[1],
  w: box[2],
  h: box[3],
  text,
  runs: [run(text.length)],
  align: "LEFT",
  wrap: false,
  lineCount: 1,
  childLayout,
  ...extra,
});

type Fake = ReturnType<typeof fakeFigma>;

async function importOps(f: Fake, ops: PlanOp[], batch = ops.length) {
  const a = createApplier(f.figma);
  await a.begin(meta);
  for (let i = 0; i < ops.length; i += batch) await a.applyBatch(ops.slice(i, i + batch));
  return a.end();
}

const flexFrameOps: PlanOp[] = [
  frameOp("row", null, [0, 0, 200, 40], row(), 2),
  boxOp("a", "row", [0, 0, 50, 40]),
  boxOp("b", "row", [60, 0, 50, 40]),
];

describe("building auto layout", () => {
  test("sets layoutMode at creation, before children", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(flexFrameOps.slice(0, 2));
    expect(f.order("layoutMode", "appendChild")).toBe("before");
  });
  test("sets layoutMode once per frame and never across a built tree", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("root", null, [0, 0, 200, 100], stack(), 2),
      frameOp("one", "root", [0, 0, 200, 40], row(), 1),
      boxOp("a", "one", [0, 0, 50, 40]),
      frameOp("two", "root", [0, 50, 200, 40], row(), 1),
      boxOp("b", "two", [0, 0, 50, 40]),
    ]);
    expect(r.failedOps).toBe(0);
    expect(f.count("layoutMode")).toBe(3);
    // Each frame's mode is set as it is created, before the next frame exists.
    expect(f.calls.filter((c) => c === "createFrame" || c === "layoutMode").slice(0, 6)).toEqual([
      "createFrame",
      "layoutMode",
      "createFrame",
      "layoutMode",
      "createFrame",
      "createFrame",
    ]);
  });
  test("carries the plan's padding, spacing and alignment", async () => {
    const f = fakeFigma();
    await importOps(f, [
      frameOp(
        "row",
        null,
        [0, 0, 200, 60],
        row({
          itemSpacing: 7,
          padding: [1, 2, 3, 4],
          primaryAlign: "MAX",
          counterAlign: "CENTER",
        }),
        1
      ),
      boxOp("a", "row", [144, 16, 54, 26]),
    ]);
    const n = f.frame("row");
    expect([n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft]).toEqual([1, 2, 3, 4]);
    expect(n.itemSpacing).toBe(7);
    expect(n.primaryAxisAlignItems).toBe("MAX");
    expect(n.counterAxisAlignItems).toBe("CENTER");
    expect(n.layoutMode).toBe("HORIZONTAL");
  });
  test("a frame sized by resize still ends up hugging", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 60, 40], row({ sizingH: "HUG", sizingV: "HUG" }), 1),
      boxOp("a", "row", [0, 0, 60, 40]),
    ]);
    const n = f.frame("row");
    expect(n.layoutSizingHorizontal).toBe("HUG");
    expect(n.layoutSizingVertical).toBe("HUG");
    expect([n.width, n.height]).toEqual([60, 40]);
    expect(r.fallbackFrames).toBe(0);
  });
  test("space-between keeps its FIXED axis", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row({ primaryAlign: "SPACE_BETWEEN" }), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [150, 0, 50, 40]),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0, autoLayoutFrames: 1 });
    expect(f.frame("row").primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    expect(f.frame("row").layoutSizingHorizontal).toBe("FIXED");
  });
  test("axes are made FIXED outright, not by resize's side effect", async () => {
    const f = fakeFigma({ resizeKeepsSizing: true });
    const r = await importOps(f, flexFrameOps);
    expect(f.frame("row").width).toBe(200);
    expect(f.frame("row").layoutSizingHorizontal).toBe("FIXED");
    expect(r).toMatchObject({ fallbackFrames: 0, autoLayoutFrames: 1 });
  });
  test("a grid's axes are made FIXED the same way", async () => {
    const f = fakeFigma({ resizeKeepsSizing: true });
    const r = await importOps(f, [
      frameOp(
        "grid",
        null,
        [0, 0, 200, 40],
        {
          mode: "GRID",
          rows: [{ type: "FLEX", value: 1 }],
          columns: [{ type: "FLEX", value: 1 }],
          rowGap: 0,
          columnGap: 0,
          padding: [0, 0, 0, 0],
        },
        1
      ),
      boxOp("a", "grid", [0, 0, 50, 40], flowChild({ cell: { row: 0, column: 0 } })),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0 });
    expect(f.frame("grid").width).toBe(200);
  });
  test("a child's FILL sizing is set after it joins the parent", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      frameOp(
        "grow",
        "row",
        [60, 0, 140, 40],
        { mode: "NONE" },
        0,
        flowChild({ sizingH: "FILL", sizingV: "FILL" })
      ),
    ]);
    expect(r.failedOps).toBe(0);
    expect(f.frame("grow").layoutSizingHorizontal).toBe("FILL");
    expect(f.frame("grow").layoutSizingVertical).toBe("FILL");
    expect(f.frame("grow").width).toBe(140);
    expect(r.fallbackFrames).toBe(0);
  });
  test("an absolute child leaves the flow and keeps its captured place", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 50, 40], row({ sizingH: "HUG" }), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("pin", "row", [150, 5, 20, 20], flowChild({ positioning: "ABSOLUTE" })),
    ]);
    const pin = f.created.find((n) => n.name === "pin") as any;
    expect(pin.layoutPositioning).toBe("ABSOLUTE");
    expect([pin.x, pin.y]).toEqual([150, 5]);
    expect(f.frame("row").width).toBe(50);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0 });
  });
  test("a child under a frame that kept no layout takes no child layout", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("plain", null, [0, 0, 200, 40], { mode: "NONE" }, 1),
      boxOp("a", "plain", [9, 8, 50, 40], flowChild({ positioning: "ABSOLUTE" })),
    ]);
    expect(r.failedOps).toBe(0);
    expect(f.frame("a").x).toBe(9);
  });
  test("wrapping sets its counter spacing and no other frame touches it", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 110, 100], row({ wrap: true, counterSpacing: 8 }), 3),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
      boxOp("c", "row", [0, 48, 50, 40]),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0 });
    expect(f.frame("row").layoutWrap).toBe("WRAP");
    expect(f.frame("row").counterAxisSpacing).toBe(8);
  });
  test("strokes stay out of layout and inside the frame", async () => {
    const f = fakeFigma();
    const op = frameOp("row", null, [0, 0, 200, 40], row(), 1);
    if (op.op !== "frame") throw new Error("frame expected");
    op.strokes = {
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
      weights: { top: 1, right: 1, bottom: 1, left: 1 },
    };
    await importOps(f, [op, boxOp("a", "row", [0, 0, 50, 40])]);
    expect(f.frame("row").strokesIncludedInLayout).toBe(false);
    expect(f.frame("row").strokeAlign).toBe("INSIDE");
  });
});

describe("building grids", () => {
  const grid: PlanLayout = {
    mode: "GRID",
    rows: [
      { type: "FIXED", value: 40 },
      { type: "FIXED", value: 40 },
    ],
    columns: [
      { type: "FLEX", value: 1 },
      { type: "HUG", value: 50 },
    ],
    rowGap: 6,
    columnGap: 10,
    padding: [0, 0, 0, 0],
  };
  const cellChild = (row: number, column: number, over: Partial<PlanChildLayout> = {}) =>
    flowChild({ cell: { row, column }, ...over });

  test("children reach their cells in whatever order they arrive", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("grid", null, [0, 0, 200, 86], grid, 2),
      boxOp("late", "grid", [150, 46, 50, 40], cellChild(1, 1)),
      boxOp("early", "grid", [0, 0, 140, 40], cellChild(0, 0, { sizingH: "FILL" })),
    ]);
    const n = f.frame("grid");
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0, autoLayoutFrames: 1 });
    expect(n.layoutMode).toBe("GRID");
    expect(n.gridRowCount).toBe(2);
    expect(n.gridColumnCount).toBe(2);
    expect(n.gridRowSizes.map((t: any) => t.type)).toEqual(["FIXED", "FIXED"]);
    expect(n.gridColumnSizes.map((t: any) => t.type)).toEqual(["FLEX", "HUG"]);
    expect(n.gridRowGap).toBe(6);
    expect(n.gridColumnGap).toBe(10);
    expect(n.layoutSizingHorizontal).toBe("FIXED");
    const late = n.children[0];
    expect([late.gridRowAnchorIndex, late.gridColumnAnchorIndex]).toEqual([1, 1]);
    expect([late.x, late.y]).toEqual([150, 46]);
  });
  test("a grid that lands wrongly falls back", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("grid", null, [0, 0, 200, 86], grid, 1),
      boxOp("a", "grid", [0, 0, 50, 40], cellChild(1, 1)),
    ]);
    expect(r.fallbackReasons).toEqual({ cell: 1 });
    expect(f.frame("grid").layoutMode).toBe("NONE");
    expect(f.frame("grid").children[0].x).toBe(0);
  });
});

describe("verification", () => {
  test("a frame that matches stays in auto layout", async () => {
    const f = fakeFigma();
    const r = await importOps(f, flexFrameOps);
    expect(f.frame("row").layoutMode).toBe("HORIZONTAL");
    expect(r).toMatchObject({ autoLayoutFrames: 1, fallbackFrames: 0, fallbackReasons: {} });
  });
  test("a frame whose children land wrongly falls back to absolute", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(flexFrameOps);
    const r = await a.end();
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect(r.fallbackFrames).toBe(1);
    expect(r.autoLayoutFrames).toBe(0);
    expect(r.fallbackReasons).toEqual({ gap: 1 });
    expect(f.frame("row").children.map((c: any) => [c.x, c.y])).toEqual([
      [0, 0],
      [60, 0],
    ]);
  });
  test("a fallback restores the frame's captured size", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    await importOps(f, [
      frameOp("row", null, [0, 0, 300, 40], row({ sizingH: "HUG", sizingV: "HUG" }), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
    ]);
    const n = f.frame("row");
    expect([n.width, n.height]).toEqual([300, 40]);
    expect(n.layoutSizingHorizontal).toBe("FIXED");
  });
  test("a fallback stays local: child auto layout survives", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 300, 40], row(), 2),
      frameOp("inner", "row", [0, 0, 50, 40], row(), 1),
      boxOp("a", "inner", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
    ]);
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect(f.frame("inner").layoutMode).toBe("HORIZONTAL");
    expect(r).toMatchObject({ fallbackFrames: 1, autoLayoutFrames: 1 });
  });
  test("a fallback below leaves the frames above in auto layout", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const r = await importOps(f, [
      frameOp("outer", null, [0, 0, 300, 40], row({ sizingV: "HUG" }), 1),
      frameOp("inner", "outer", [0, 0, 110, 40], row(), 2),
      boxOp("a", "inner", [0, 0, 50, 40]),
      boxOp("b", "inner", [60, 0, 50, 40]),
    ]);
    expect(f.frame("inner").layoutMode).toBe("NONE");
    expect(f.frame("outer").layoutMode).toBe("HORIZONTAL");
    expect(r).toMatchObject({ fallbackFrames: 1, autoLayoutFrames: 1 });
  });
  test("a FILL child of a fallback frame gets its captured size", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      frameOp("grow", "row", [60, 0, 140, 40], { mode: "NONE" }, 0, flowChild({ sizingH: "FILL" })),
    ]);
    const grow = f.frame("grow");
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect([grow.x, grow.width]).toEqual([60, 140]);
    expect(grow.layoutSizingHorizontal).toBe("FIXED");
  });
  test("a FILL frame that falls back keeps its FILL under a parent still in auto layout", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const r = await importOps(f, [
      frameOp("outer", null, [0, 0, 200, 40], row(), 1),
      frameOp("inner", "outer", [0, 0, 200, 40], row(), 2, flowChild({ sizingH: "FILL" })),
      boxOp("a", "inner", [0, 0, 50, 40]),
      boxOp("b", "inner", [60, 0, 50, 40]),
    ]);
    expect(r.fallbackFrames).toBe(1);
    expect(f.frame("inner").layoutMode).toBe("NONE");
    expect(f.frame("inner").layoutSizingHorizontal).toBe("FILL");
    expect(f.frame("outer").layoutMode).toBe("HORIZONTAL");
  });
  test("a fallback happens inside the import's undo step", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    await importOps(f, flexFrameOps);
    expect(f.calls.lastIndexOf("commitUndo")).toBeGreaterThan(f.calls.lastIndexOf("layoutMode"));
  });
  test("an absolute child returns to its captured place in a fallback", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 3),
      ...flexFrameOps.slice(1),
      boxOp("pin", "row", [150, 5, 20, 20], flowChild({ positioning: "ABSOLUTE" })),
    ]);
    const pin = f.created.find((n) => n.name === "pin") as any;
    expect([pin.x, pin.y]).toEqual([150, 5]);
  });
  test("a text child returns to where its alignment puts it", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    await importOps(f, [
      frameOp("row", null, [0, 0, 300, 40], row(), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      textOp("t", "row", [60, 0, 100, 12], "hello", { align: "RIGHT" }),
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.x).toBe(60 + 100 - 25);
  });
  test("a child that cannot be placed does not stop the others", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([
      frameOp("row", null, [0, 0, 300, 40], row(), 4),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
      boxOp("c", "row", [120, 0, 50, 40]),
    ]);
    Object.defineProperty(f.frame("b"), "y", {
      get: () => 0,
      set: () => {
        throw new Error("boom");
      },
    });
    await a.applyBatch([boxOp("d", "row", [180, 0, 50, 40])]);
    const r = await a.end();
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect(f.frame("c").x).toBe(120);
    expect(f.frame("d").x).toBe(180);
    expect(r).toMatchObject({ fallbackFrames: 1, fallbackReasons: { gap: 1, error: 1 } });
  });
  test("a frame that cannot be read is an error, and still goes back to absolute", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([frameOp("row", null, [0, 0, 200, 40], row(), 3), ...flexFrameOps.slice(1)]);
    const n = f.frame("row");
    const { get } = Object.getOwnPropertyDescriptor(n, "children") as PropertyDescriptor;
    let broken = true;
    Object.defineProperty(n, "children", {
      get() {
        if (!broken) return get?.call(n);
        broken = false;
        throw new Error("gone");
      },
    });
    const r = await a.end();
    expect(r).toMatchObject({ autoLayoutFrames: 0, fallbackFrames: 1 });
    expect(r.fallbackReasons).toEqual({ error: 1 });
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect(f.frame("b").x).toBe(60);
  });
  test("FILL text in a fallback goes back to its captured width", async () => {
    const f = fakeFigma({ shiftChild: 7 });
    const r = await importOps(f, [
      frameOp("root", null, [0, 0, 500, 100], row({ itemSpacing: 0 }), 2),
      frameOp(
        "card",
        "root",
        [0, 0, 300, 100],
        stack({ itemSpacing: 4 }),
        2,
        flowChild({ sizingH: "FILL", sizingV: "FILL" })
      ),
      textOp(
        "t",
        "card",
        [0, 0, 95, 12],
        "aaaa bbbb cccc dddd",
        { wrap: true, lineCount: 1 },
        flowChild({ sizingH: "FILL", sizingV: "HUG" })
      ),
      boxOp("k", "card", [0, 20, 300, 20]),
      boxOp("side", "root", [300, 0, 200, 100]),
    ]);
    expect(f.frame("card").layoutMode).toBe("NONE");
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.width).toBe(95);
    expect(t.height).toBe(12);
    expect(t.textAutoResize).toBe("HEIGHT");
    expect(r.failedOps).toBe(0);
  });
  test("what Figma refuses leaves the frame absolute, with its layers", async () => {
    const f = fakeFigma({ failLayout: "itemSpacing" });
    const r = await importOps(f, flexFrameOps);
    expect(r).toMatchObject({
      failedOps: 0,
      autoLayoutFrames: 0,
      fallbackFrames: 1,
      fallbackReasons: { apply: 1 },
    });
    const n = f.frame("row");
    expect(n.layoutMode).toBe("NONE");
    expect([n.width, n.height]).toEqual([200, 40]);
    expect(n.children.map((c: any) => c.x)).toEqual([0, 60]);
  });
});

describe("verifying around text", () => {
  const textRow = [
    frameOp("row", null, [0, 0, 300, 12], row(), 2),
    textOp("t", "row", [0, 0, 500, 12], "x".repeat(100)),
    boxOp("b", "row", [510, 0, 40, 12]),
  ];

  test("text wider in Figma doesn't fail verification", async () => {
    const f = fakeFigma({ textWiderBy: 0.01 });
    const r = await importOps(f, textRow);
    expect(f.created.find((n) => n.type === "TEXT")?.width).toBeCloseTo(505);
    expect(r.fallbackFrames).toBe(0);
    expect(f.frame("row").layoutMode).toBe("HORIZONTAL");
  });
  test("HUG ancestors inherit a text change without failing", async () => {
    const f = fakeFigma({ textWiderBy: 0.04 });
    const r = await importOps(f, [
      frameOp("page", null, [0, 0, 700, 100], stack(), 2),
      frameOp(
        "outer",
        "page",
        [0, 0, 516, 28],
        row({ padding: [4, 4, 4, 4], sizingH: "HUG", sizingV: "HUG" }),
        1,
        flowChild({ sizingH: "HUG", sizingV: "HUG" })
      ),
      frameOp(
        "inner",
        "outer",
        [4, 4, 508, 20],
        row({ padding: [4, 4, 4, 4], sizingH: "HUG", sizingV: "HUG" }),
        1,
        flowChild({ sizingH: "HUG", sizingV: "HUG" })
      ),
      textOp("t", "inner", [4, 4, 500, 12], "x".repeat(100)),
      boxOp("next", "page", [0, 38, 80, 40]),
    ]);
    expect(f.frame("outer").width).toBeCloseTo(536);
    expect(r).toMatchObject({ autoLayoutFrames: 3, fallbackFrames: 0 });
  });
  test("a HUG frame with no text to blame fails itself, and its parent is unaffected", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("outer", null, [0, 0, 300, 40], row(), 2),
      frameOp(
        "hug",
        "outer",
        [0, 0, 80, 40],
        row({ sizingH: "HUG" }),
        1,
        flowChild({ sizingH: "HUG" })
      ),
      boxOp("a", "hug", [0, 0, 50, 40]),
      boxOp("b", "outer", [90, 0, 50, 40]),
    ]);
    expect(r.fallbackReasons).toEqual({ size: 1 });
    expect(f.frame("hug").layoutMode).toBe("NONE");
    expect(f.frame("hug").width).toBe(80);
    expect(f.frame("outer").layoutMode).toBe("HORIZONTAL");
  });
  test("wrapped text in a stack fills the width and keeps its lines", async () => {
    const f = fakeFigma();
    const words = "aaaaaaaa bbbbbbbb";
    const r = await importOps(f, [
      frameOp("col", null, [0, 0, 50, 24], stack(), 1),
      textOp(
        "t",
        "col",
        [0, 0, 40, 24],
        words,
        { wrap: true, lineCount: 2 },
        flowChild({ sizingH: "FILL", sizingV: "HUG" })
      ),
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.layoutSizingHorizontal).toBe("FILL");
    expect(t.width).toBe(50);
    expect(t.height).toBe(24);
    expect(r).toMatchObject({ rewrappedTexts: 0, fallbackFrames: 0 });
  });
  const words = "aaaa bbbb cccc dddd eeee ffff gggg hhhh";
  const fillColumn = (x: number) =>
    frameOp(
      "col",
      "root",
      [x, 0, 100, 24],
      stack(),
      1,
      flowChild({ sizingH: "FILL", sizingV: "FILL" })
    );
  const fillText = textOp(
    "t",
    "col",
    [0, 0, 100, 24],
    words,
    { wrap: true, lineCount: 2 },
    flowChild({ sizingH: "FILL", sizingV: "HUG" })
  );
  const rootRow = frameOp("root", null, [0, 0, 300, 24], row({ itemSpacing: 0 }), 2);

  test("FILL text is measured at its final width, not at the width it had alone", async () => {
    const f = fakeFigma({ textWiderBy: 0.1 });
    const r = await importOps(f, [
      rootRow,
      fillColumn(0),
      fillText,
      boxOp("side", "root", [100, 0, 200, 24]),
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.layoutSizingHorizontal).toBe("FIXED");
    expect(t.width).toBeGreaterThan(100);
    expect(t.height).toBe(24);
    expect(r.rewrappedTexts).toBe(0);
  });
  test("FILL text that no widening can save is counted", async () => {
    const f = fakeFigma({ textWiderBy: 0.2 });
    const r = await importOps(f, [
      rootRow,
      fillColumn(0),
      fillText,
      boxOp("side", "root", [100, 0, 200, 24]),
    ]);
    expect(r.rewrappedTexts).toBe(1);
  });
  test("FILL text gives the same answer whichever sibling comes first", async () => {
    const f = fakeFigma({ textWiderBy: 0.1 });
    const r = await importOps(f, [
      rootRow,
      boxOp("side", "root", [0, 0, 200, 24]),
      fillColumn(200),
      fillText,
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.layoutSizingHorizontal).toBe("FIXED");
    expect(t.height).toBe(24);
    expect(r.rewrappedTexts).toBe(0);
  });
  test("FILL text that fits at its final width stays FILL", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      rootRow,
      fillColumn(0),
      fillText,
      boxOp("side", "root", [100, 0, 200, 24]),
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.layoutSizingHorizontal).toBe("FILL");
    expect(t.width).toBe(100);
    expect(r).toMatchObject({ rewrappedTexts: 0, fallbackFrames: 0 });
  });
  test("counts text that came out another size, once", async () => {
    const f = fakeFigma({ textWiderBy: 0.04 });
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 700, 12], row(), 2),
      textOp("t", "row", [0, 0, 500, 12], "x".repeat(100)),
      textOp("same", "row", [510, 0, 20, 12], "xxxx"),
    ]);
    expect(r.textDriftCount).toBe(1);
  });
  test("a filled box wider than its captured text is not drift", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("col", null, [0, 0, 300, 24], stack(), 1),
      textOp(
        "t",
        "col",
        [0, 0, 40, 24],
        "aaaaaaaa bbbbbbbb",
        { wrap: true, lineCount: 1 },
        flowChild({ sizingH: "FILL", sizingV: "HUG" })
      ),
    ]);
    expect(r.textDriftCount).toBe(1); // the height: one line where the capture had two
    const g = fakeFigma();
    const s = await importOps(g, [
      frameOp("col", null, [0, 0, 300, 12], stack(), 1),
      textOp(
        "t",
        "col",
        [0, 0, 40, 12],
        "aaaaaaaa bbbbbbbb",
        { wrap: true, lineCount: 1 },
        flowChild({ sizingH: "FILL", sizingV: "HUG" })
      ),
    ]);
    expect(s.textDriftCount).toBe(0);
  });
  test("wrapped text too wide to fill goes back to a widened fixed box", async () => {
    const f = fakeFigma({ textWiderBy: 0.05 });
    const r = await importOps(f, [
      frameOp("col", null, [0, 0, 100, 24], stack(), 1),
      textOp(
        "t",
        "col",
        [0, 0, 100, 24],
        "x".repeat(10).concat(" ", "y".repeat(9), " ", "z".repeat(19)),
        { wrap: true, lineCount: 2 },
        flowChild({ sizingH: "FILL", sizingV: "HUG" })
      ),
    ]);
    const t = f.created.find((n) => n.type === "TEXT") as any;
    expect(t.layoutSizingHorizontal).toBe("FIXED");
    expect(t.height).toBe(24);
    expect(r).toMatchObject({ failedOps: 0, rewrappedTexts: 0 });
  });
});

describe("when to verify", () => {
  test("a frame waits for the content of its last child", async () => {
    const f = fakeFigma();
    const r = await importOps(
      f,
      [
        frameOp("outer", null, [0, 0, 300, 40], row(), 1),
        frameOp(
          "hug",
          "outer",
          [0, 0, 110, 40],
          row({ sizingH: "HUG", sizingV: "HUG" }),
          2,
          flowChild({ sizingH: "HUG", sizingV: "HUG" })
        ),
        boxOp("a", "hug", [0, 0, 50, 40]),
        boxOp("b", "hug", [60, 0, 50, 40]),
      ],
      2
    );
    expect(r).toMatchObject({ autoLayoutFrames: 2, fallbackFrames: 0 });
  });
  test("a FILL frame waits for the siblings that decide its size", async () => {
    const f = fakeFigma();
    const r = await importOps(
      f,
      [
        frameOp("outer", null, [0, 0, 170, 100], row(), 2),
        frameOp(
          "grow",
          "outer",
          [0, 0, 110, 100],
          row({ wrap: true, counterSpacing: 8 }),
          3,
          flowChild({ sizingH: "FILL" })
        ),
        boxOp("a", "grow", [0, 0, 50, 40]),
        boxOp("b", "grow", [60, 0, 50, 40]),
        boxOp("c", "grow", [0, 48, 50, 40]),
        boxOp("side", "outer", [120, 0, 50, 40]),
      ],
      5
    );
    expect(r).toMatchObject({ fallbackFrames: 0, autoLayoutFrames: 2 });
  });
  test("a FILL frame is judged at its final size, not at the size it had alone", async () => {
    const f = fakeFigma();
    // Alone in the row, the frame is wide enough for all three on a line, which its extra width
    // would excuse. Beside its sibling two fit, which is still not what was captured.
    const r = await importOps(
      f,
      [
        frameOp("outer", null, [0, 0, 170, 140], row(), 2),
        frameOp(
          "grow",
          "outer",
          [0, 0, 110, 140],
          row({ wrap: true, counterSpacing: 8 }),
          3,
          flowChild({ sizingH: "FILL" })
        ),
        boxOp("a", "grow", [0, 0, 50, 40]),
        boxOp("b", "grow", [0, 48, 50, 40]),
        boxOp("c", "grow", [0, 96, 50, 40]),
        boxOp("side", "outer", [120, 0, 50, 40]),
      ],
      5
    );
    expect(r.fallbackReasons).toEqual({ wrap: 1 });
    expect(f.frame("grow").layoutMode).toBe("NONE");
  });
  test("verifies before end when every child arrived", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(flexFrameOps);
    expect(f.frame("row").layoutMode).toBe("NONE");
    await a.end();
  });
  test("a child op that failed does not hold the frame back", async () => {
    const f = fakeFigma({ failOn: "b" });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([
      frameOp("row", null, [0, 0, 200, 40], row(), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
    ]);
    const r = await a.end();
    expect(r).toMatchObject({ failedOps: 1, autoLayoutFrames: 1, fallbackFrames: 0 });
  });
  test("a failed child in the middle leaves its siblings where they were", async () => {
    const f = fakeFigma({ failOn: "b" });
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 3),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
      boxOp("c", "row", [120, 0, 50, 40]),
    ]);
    expect(r).toMatchObject({ failedOps: 1, fallbackFrames: 1, fallbackReasons: { gap: 1 } });
    expect(f.frame("row").children.map((c: any) => c.x)).toEqual([0, 120]);
  });
  test("a frame that lost every child goes back to its captured size", async () => {
    const f = fakeFigma({ failOn: "a" });
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row({ sizingH: "HUG", sizingV: "HUG" }), 1),
      boxOp("a", "row", [0, 0, 50, 40]),
    ]);
    expect(r.fallbackReasons).toEqual({ children: 1 });
    expect(f.frame("row").width).toBe(200);
  });
  test("children of a failed frame do not stall the frames above", async () => {
    const f = fakeFigma({ failOn: "bad" });
    const r = await importOps(f, [
      frameOp("root", null, [0, 0, 200, 40], row(), 2),
      boxOp("a", "root", [0, 0, 50, 40]),
      frameOp("bad", "root", [60, 0, 50, 40], row(), 1),
      boxOp("c", "bad", [0, 0, 50, 40]),
    ]);
    expect(r.failedOps).toBe(2);
    expect(r.autoLayoutFrames).toBe(1);
  });
  test("end verifies a frame whose ops never arrived, deepest first", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([
      frameOp("outer", null, [0, 0, 300, 40], row({ sizingV: "HUG" }), 3),
      frameOp("inner", "outer", [0, 0, 110, 40], row(), 3),
      boxOp("a", "inner", [0, 0, 50, 40]),
      boxOp("b", "inner", [60, 0, 50, 40]),
    ]);
    expect(f.frame("inner").layoutMode).toBe("HORIZONTAL");
    const r = await a.end();
    expect(f.frame("inner").layoutMode).toBe("NONE");
    expect(f.frame("outer").layoutMode).toBe("HORIZONTAL");
    expect(r).toMatchObject({ fallbackFrames: 1, autoLayoutFrames: 1 });
  });
  test("end keeps a frame's text in view for the frames above it", async () => {
    const f = fakeFigma({ textWiderBy: 0.04 });
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch([
      frameOp("outer", null, [0, 0, 700, 12], row(), 3),
      frameOp(
        "hug",
        "outer",
        [0, 0, 500, 12],
        row({ sizingH: "HUG" }),
        3,
        flowChild({ sizingH: "HUG" })
      ),
      textOp("t", "hug", [0, 0, 500, 12], "x".repeat(100)),
    ]);
    expect(await a.end()).toMatchObject({ autoLayoutFrames: 2, fallbackFrames: 0 });
  });
  test("end with no root skips verification", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    expect(await a.end()).toEqual({
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
});

describe("staying responsive", () => {
  const timers = spyOn(globalThis, "setTimeout");
  afterEach(() => timers.mockClear());

  /** A chain: nothing is complete until the last op, which then completes every frame at once. */
  const chain = (n: number): PlanOp[] => {
    const ops: PlanOp[] = [frameOp("f0", null, [0, 0, 300, 40], stack(), 1)];
    for (let i = 1; i < n; i++) {
      ops.push(frameOp(`f${i}`, `f${i - 1}`, [0, 0, 300, 40], stack(), 1));
    }
    ops.push(boxOp("leaf", `f${n - 1}`, [0, 0, 300, 40]));
    return ops;
  };

  test("verifying 2,000 frames yields between batches", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ops = chain(2000);
    await a.applyBatch(ops.slice(0, -1));
    timers.mockClear();
    await a.applyBatch(ops.slice(-1));
    // One for the batch itself, the rest within it: 2,000 frames all finish on this one op.
    expect(timers.mock.calls.length).toBeGreaterThanOrEqual(5);
    timers.mockClear();
    const r = await a.end();
    expect(r).toMatchObject({ autoLayoutFrames: 2000, fallbackFrames: 0 });
  });
  test("a slow verification yields on time, not only on count", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ops = chain(20);
    await a.applyBatch(ops.slice(0, -1));
    let t = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => {
      t += 3000;
      return t;
    });
    timers.mockClear();
    await a.applyBatch(ops.slice(-1));
    clock.mockRestore();
    expect(timers.mock.calls.length).toBeGreaterThanOrEqual(20);
    await a.end();
  });
  test("slow ops yield inside a batch", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ops = [
      frameOp("root", null, [0, 0, 300, 40], { mode: "NONE" }, 10),
      ...Array.from({ length: 10 }, (_, i) => boxOp(`b${i}`, "root", [0, 0, 10, 10])),
    ];
    let t = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => {
      t += 3000;
      return t;
    });
    timers.mockClear();
    await a.applyBatch(ops);
    clock.mockRestore();
    expect(timers.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect((await a.end()).failedOps).toBe(0);
  });
  test("cancelling while a batch yields stops the batch", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ops = [
      frameOp("root", null, [0, 0, 300, 40], { mode: "NONE" }, 3),
      boxOp("a", "root", [0, 0, 10, 10]),
      boxOp("b", "root", [0, 0, 10, 10]),
      boxOp("c", "root", [0, 0, 10, 10]),
    ];
    let t = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => {
      t += 3000;
      return t;
    });
    const batch = a.applyBatch(ops);
    a.cancel();
    await batch;
    clock.mockRestore();
    expect(f.page.children).toHaveLength(0);
    expect(f.calls.filter((c) => c === "createFrame").length).toBeLessThan(4);
  });
  test("end yields as well, for what never completed", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(chain(2000).slice(0, -1));
    timers.mockClear();
    const r = await a.end();
    expect(timers.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(r.failedOps).toBe(0);
  });
  test("cancelling during the end's yields stops the verification", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(chain(2000).slice(0, -1));
    const ending = a.end();
    a.cancel();
    const r = await ending;
    expect(r.rootId).toBe("");
    expect(f.page.children).toHaveLength(0);
    expect(a.isActive()).toBe(false);
  });
  test("a new import started during the old one's yields is left alone", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.applyBatch(chain(2000).slice(0, -1));
    const ending = a.end();
    a.cancel();
    await a.begin(meta);
    await ending;
    expect(a.isActive()).toBe(true);
  });
});

describe("rotation", () => {
  const turned = (op: PlanOp, rotation = 30): PlanOp => ({ ...op, rotation }) as PlanOp;

  test("a row the mapper made NONE for a rotated child is reported as transformed-child", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], { mode: "NONE", reason: "transformed-child" }, 2),
      boxOp("a", "row", [0, 0, 50, 40], undefined),
      turned(frameOp("b", "row", [60, 0, 50, 40], { mode: "NONE" }, 0)),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 1, autoLayoutFrames: 0 });
    expect(r.fallbackReasons).toEqual({ "transformed-child": 1 });
    expect(f.frame("row").layoutMode).toBe("NONE");
    expect(f.frame("row").children[1].rotation).toBeCloseTo(-30, 6);
  });
  test("a rotated absolute child stays in an auto layout parent and keeps its centre", async () => {
    const f = fakeFigma();
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 3),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
      turned(
        frameOp(
          "pin",
          "row",
          [150, 5, 20, 20],
          { mode: "NONE" },
          0,
          flowChild({ positioning: "ABSOLUTE" })
        ),
        90
      ),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0, autoLayoutFrames: 1 });
    const pin = f.frame("row").children[2];
    expect(pin.layoutPositioning).toBe("ABSOLUTE");
    expect(pin.rotation).toBeCloseTo(-90, 6);
    // Turned 90 degrees about (160, 15): the unturned corner lands at (170, 5).
    expect(pin.x).toBeCloseTo(170, 6);
    expect(pin.y).toBeCloseTo(5, 6);
  });
  test("a parent that falls back leaves a rotated absolute child on its centre", async () => {
    const f = fakeFigma({ shiftChild: 5 });
    const r = await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 3),
      boxOp("a", "row", [0, 0, 50, 40]),
      boxOp("b", "row", [60, 0, 50, 40]),
      turned(
        frameOp(
          "pin",
          "row",
          [150, 5, 20, 10],
          { mode: "NONE" },
          0,
          flowChild({ positioning: "ABSOLUTE" })
        ),
        90
      ),
    ]);
    expect(r.fallbackFrames).toBe(1);
    const pin = f.frame("row").children[2];
    // Turned 90 degrees about (160, 10); its unturned corner is at (165, 0).
    expect(pin.rotation).toBeCloseTo(-90, 6);
    expect(pin.x).toBeCloseTo(165, 6);
    expect(pin.y).toBeCloseTo(0, 6);
  });
  test("a turned frame that auto layout resizes keeps its centre", async () => {
    const f = fakeFigma({ textWiderBy: 0.2 });
    const hug = row({ sizingH: "HUG", sizingV: "HUG" });
    const r = await importOps(f, [
      frameOp("root", null, [0, 0, 400, 300], { mode: "NONE" }, 1),
      turned(frameOp("box", "root", [100, 50, 25, 12], hug, 1), 30),
      textOp("t", "box", [0, 0, 25, 12], "hello"),
    ]);
    expect(r).toMatchObject({ failedOps: 0, fallbackFrames: 0 });
    const n = f.frame("box");
    // Figma's text came out wider than the capture's, so the frame hugged wider than 25.
    expect(n.width).toBeGreaterThan(25);
    const t = (30 * Math.PI) / 180;
    const [[a, b, tx], [c, d, ty]] = n.relativeTransform;
    expect(tx + (a * n.width) / 2 + (b * n.height) / 2).toBeCloseTo(112.5, 6);
    expect(ty + (c * n.width) / 2 + (d * n.height) / 2).toBeCloseTo(56, 6);
    expect(Math.cos(t)).toBeCloseTo(a, 6);
  });
  test("a child that auto layout places is not rotated", async () => {
    const f = fakeFigma();
    await importOps(f, [
      frameOp("row", null, [0, 0, 200, 40], row(), 2),
      boxOp("a", "row", [0, 0, 50, 40]),
      turned(frameOp("b", "row", [60, 0, 50, 40], { mode: "NONE" }, 0, flowChild())),
    ]);
    expect(f.count("relativeTransform")).toBe(0);
  });
});
