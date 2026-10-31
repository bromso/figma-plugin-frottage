import { describe, expect, test } from "bun:test";
import type { PlanLayout } from "@repo/figma-mapper";
import { type ExpectedChild, type ExpectedLayout, verifyFrame } from "../verify-layout";

type Auto = Extract<PlanLayout, { mode: "HORIZONTAL" | "VERTICAL" }>;
type Box = [x: number, y: number, w: number, h: number];

const auto = (over: Partial<Auto> = {}): Auto => ({
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

const child = (box: Box, over: Partial<ExpectedChild> = {}): ExpectedChild => ({
  x: box[0],
  y: box[1],
  w: box[2],
  h: box[3],
  absolute: false,
  text: false,
  containsText: false,
  sizingH: "FIXED",
  sizingV: "FIXED",
  ...over,
});

const expected = (
  layout: ExpectedLayout["layout"],
  children: ExpectedChild[],
  over: Partial<ExpectedLayout> = {}
): ExpectedLayout => ({
  layout,
  w: 200,
  h: 100,
  sizingH: "FIXED",
  sizingV: "FIXED",
  children,
  ...over,
});

/** A frame as read back from Figma: size, and each child's box in the frame. */
const frame = (boxes: Box[], width = 200, height = 100) => ({
  width,
  height,
  children: boxes.map(([x, y, w, h]) => ({ x, y, width: w, height: h })),
});

const a = child([0, 0, 50, 20]);
const b = child([60, 0, 50, 20]);

describe("verifyFrame: arrangement", () => {
  test("a frame that matches the capture passes", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [60, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r).toEqual({ ok: true });
  });
  test("children count against the frame, so 1 px of rounding passes", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [61, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r.ok).toBe(true);
  });
  test("a wrong gap fails", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [65, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r).toEqual({ ok: false, reason: "gap" });
  });
  test("children in the opposite order fail", () => {
    const r = verifyFrame(
      frame([
        [60, 0, 50, 20],
        [0, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r).toEqual({ ok: false, reason: "order" });
  });
  test("an offset from the padding edge fails", () => {
    const r = verifyFrame(
      frame([
        [5, 0, 50, 20],
        [65, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r).toEqual({ ok: false, reason: "padding" });
  });
  test("a vertical frame checks its gaps downwards", () => {
    const top = child([0, 0, 50, 20]);
    const below = child([0, 30, 50, 20]);
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [0, 35, 50, 20],
      ]),
      expected(auto({ mode: "VERTICAL" }), [top, below])
    );
    expect(r).toEqual({ ok: false, reason: "gap" });
  });
  test.each([
    ["MIN", 5, false],
    ["MIN", 0, true],
    ["CENTER", 40, true],
    ["CENTER", 45, false],
    ["MAX", 80, true],
    ["MAX", 70, false],
  ] as const)("counter alignment %s with the child at %d: %s", (counterAlign, y, ok) => {
    const at = { MIN: 0, CENTER: 40, MAX: 80 }[counterAlign];
    const r = verifyFrame(
      frame([[0, y, 50, 20]]),
      expected(auto({ counterAlign }), [child([0, at, 50, 20])])
    );
    expect(r.ok).toBe(ok);
    if (!ok) expect(r.reason).toBe("cross");
  });
  test("absolute children sit outside the flow", () => {
    const pin = child([150, 5, 20, 20], { absolute: true });
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [60, 0, 50, 20],
        [150, 5, 20, 20],
      ]),
      expected(auto(), [a, b, pin])
    );
    expect(r.ok).toBe(true);
  });
  test("a frame missing a child fails", () => {
    const r = verifyFrame(frame([[0, 0, 50, 20]]), expected(auto(), [a, b]));
    expect(r).toEqual({ ok: false, reason: "children" });
  });
  test("a frame left with nothing in its flow fails: it has no size to hug", () => {
    expect(verifyFrame(frame([]), expected(auto(), []))).toEqual({
      ok: false,
      reason: "children",
    });
  });
});

describe("verifyFrame: size", () => {
  test("a non-text child of another size fails", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 55, 20],
        [65, 0, 50, 20],
      ]),
      expected(auto(), [a, b])
    );
    expect(r).toEqual({ ok: false, reason: "size" });
  });
  test("a HUG child with no text gets no allowance", () => {
    const hug = child([0, 0, 50, 20], { sizingH: "HUG" });
    const r = verifyFrame(frame([[0, 0, 55, 20]]), expected(auto(), [hug]));
    expect(r).toEqual({ ok: false, reason: "size" });
  });
  test("a FIXED child holding text gets no allowance", () => {
    const fixed = child([0, 0, 50, 20], { containsText: true });
    const r = verifyFrame(frame([[0, 0, 55, 20]]), expected(auto(), [fixed]));
    expect(r).toEqual({ ok: false, reason: "size" });
  });
  test("a FILL child takes up what its text sibling gave away", () => {
    const text = child([0, 0, 50, 20], { text: true, sizingH: "HUG" });
    const fill = child([60, 0, 140, 20], { sizingH: "FILL" });
    const r = verifyFrame(
      frame([
        [0, 0, 53, 20],
        [63, 0, 137, 20],
      ]),
      expected(auto(), [text, fill])
    );
    expect(r.ok).toBe(true);
  });
  test("a FILL child that lost more than text explains fails", () => {
    const text = child([0, 0, 50, 20], { text: true, sizingH: "HUG" });
    const fill = child([60, 0, 140, 20], { sizingH: "FILL" });
    const r = verifyFrame(
      frame([
        [0, 0, 53, 20],
        [63, 0, 120, 20],
      ]),
      expected(auto(), [text, fill])
    );
    expect(r).toEqual({ ok: false, reason: "size" });
  });
  test("a FILL frame that its parent narrowed lets its children follow", () => {
    const fill = child([0, 0, 200, 20], { sizingH: "FILL" });
    const r = verifyFrame(
      frame([[0, 0, 190, 20]], 190),
      expected(auto(), [fill], { sizingH: "FILL" })
    );
    expect(r.ok).toBe(true);
  });
});

describe("verifyFrame: text", () => {
  const text = (box: Box) => child(box, { text: true, sizingH: "HUG", sizingV: "HUG" });

  test("wider text pushes its sibling along without failing", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 80, 20],
        [90, 0, 50, 20],
      ]),
      expected(auto(), [text([0, 0, 50, 20]), child([60, 0, 50, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("taller text in a stack pushes what follows", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 40],
        [0, 50, 50, 20],
      ]),
      expected(auto({ mode: "VERTICAL" }), [text([0, 0, 50, 20]), child([0, 30, 50, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("text moves a centred row by half of its drift", () => {
    const r = verifyFrame(
      frame([
        [43, 0, 56, 20],
        [109, 0, 48, 20],
      ]),
      expected(auto({ primaryAlign: "CENTER" }), [text([46, 0, 50, 20]), child([106, 0, 48, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("a row set to the end moves by all of its drift", () => {
    const r = verifyFrame(
      frame([
        [84, 0, 56, 20],
        [150, 0, 50, 20],
      ]),
      expected(auto({ primaryAlign: "MAX" }), [text([90, 0, 50, 20]), child([150, 0, 50, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("space-between absorbs the drift in its gaps", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 56, 20],
        [150, 0, 50, 20],
      ]),
      expected(auto({ primaryAlign: "SPACE_BETWEEN" }), [
        text([0, 0, 50, 20]),
        child([150, 0, 50, 20]),
      ])
    );
    expect(r.ok).toBe(true);
  });
  test("drift only explains what it could have caused", () => {
    const r = verifyFrame(
      frame([
        [70, 0, 56, 20],
        [136, 0, 48, 20],
      ]),
      expected(auto({ primaryAlign: "CENTER" }), [text([46, 0, 50, 20]), child([106, 0, 48, 20])])
    );
    expect(r).toEqual({ ok: false, reason: "padding" });
  });
  test("a HUG child holding text may change size, and moves what follows", () => {
    const hug = child([0, 0, 50, 20], { containsText: true, sizingH: "HUG", sizingV: "HUG" });
    const r = verifyFrame(
      frame([
        [0, 0, 90, 24],
        [100, 0, 50, 20],
      ]),
      expected(auto(), [hug, child([60, 0, 50, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("a hugging frame's padding stays exact whatever its text does", () => {
    const r = verifyFrame(
      frame([[5, 0, 80, 20]], 90),
      expected(auto({ primaryAlign: "MAX" }), [text([0, 0, 50, 20])], { w: 60, sizingH: "HUG" })
    );
    expect(r).toEqual({ ok: false, reason: "padding" });
  });
  test("centred on the counter axis, taller text keeps its centre", () => {
    const r = verifyFrame(
      frame([
        [0, 25, 50, 50],
        [60, 40, 50, 20],
      ]),
      expected(auto({ counterAlign: "CENTER" }), [text([0, 40, 50, 20]), child([60, 40, 50, 20])])
    );
    expect(r.ok).toBe(true);
  });
  test("a baseline row allows what the text's own height moved", () => {
    const row = auto({ counterAlign: "BASELINE" });
    const ok = verifyFrame(
      frame([
        [0, 0, 50, 24],
        [60, 3, 50, 20],
      ]),
      expected(row, [text([0, 0, 50, 20]), child([60, 0, 50, 20])])
    );
    expect(ok.ok).toBe(true);
    const moved = verifyFrame(
      frame([
        [0, 0, 50, 24],
        [60, 9, 50, 20],
      ]),
      expected(row, [text([0, 0, 50, 20]), child([60, 0, 50, 20])])
    );
    expect(moved).toEqual({ ok: false, reason: "cross" });
  });
});

describe("verifyFrame: wrap", () => {
  const wrap = auto({ wrap: true, counterSpacing: 8 });
  const lines: ExpectedChild[] = [
    child([0, 0, 90, 20]),
    child([100, 0, 90, 20]),
    child([0, 28, 90, 20]),
  ];

  test("lines that match pass", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 90, 20],
        [100, 0, 90, 20],
        [0, 28, 90, 20],
      ]),
      expected(wrap, lines)
    );
    expect(r.ok).toBe(true);
  });
  test("a different break with no text to blame fails", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 90, 20],
        [0, 28, 90, 20],
        [0, 56, 90, 20],
      ]),
      expected(wrap, lines)
    );
    expect(r).toEqual({ ok: false, reason: "wrap" });
  });
  test("a break moved by wider text passes", () => {
    const text = child([0, 0, 90, 20], { text: true, sizingH: "HUG" });
    const r = verifyFrame(
      frame([
        [0, 0, 110, 20],
        [0, 28, 90, 20],
        [100, 28, 90, 20],
      ]),
      expected(wrap, [text, ...lines.slice(1)])
    );
    expect(r.ok).toBe(true);
  });
  test("a line in the wrong place fails", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 90, 20],
        [100, 0, 90, 20],
        [0, 40, 90, 20],
      ]),
      expected(wrap, lines)
    );
    expect(r).toEqual({ ok: false, reason: "cross" });
  });
  test("each line keeps its own alignment", () => {
    const centred = auto({ wrap: true, counterSpacing: 8, counterAlign: "CENTER" });
    const r = verifyFrame(
      frame([
        [0, 0, 90, 40],
        [100, 0, 90, 20],
      ]),
      expected(centred, [child([0, 0, 90, 40]), child([100, 10, 90, 20])])
    );
    expect(r).toEqual({ ok: false, reason: "cross" });
  });
});

describe("verifyFrame: grid", () => {
  const grid: ExpectedLayout["layout"] = {
    mode: "GRID",
    rows: [{ type: "FIXED", value: 40 }],
    columns: [
      { type: "HUG", value: 50 },
      { type: "FIXED", value: 100 },
    ],
    rowGap: 0,
    columnGap: 10,
    padding: [0, 0, 0, 0],
  };
  const text = child([0, 0, 50, 20], { text: true, sizingH: "HUG", sizingV: "HUG" });
  const cell = child([60, 0, 100, 40]);

  test("children in their cells pass", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [60, 0, 100, 40],
      ]),
      expected(grid, [text, cell])
    );
    expect(r.ok).toBe(true);
  });
  test("a child out of its cell fails", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 50, 20],
        [60, 40, 100, 40],
      ]),
      expected(grid, [text, cell])
    );
    expect(r).toEqual({ ok: false, reason: "cell" });
  });
  test("a HUG column that text widened moves the next column", () => {
    const r = verifyFrame(
      frame([
        [0, 0, 56, 20],
        [66, 0, 100, 40],
      ]),
      expected(grid, [text, cell])
    );
    expect(r.ok).toBe(true);
  });
  test("with no HUG tracks text explains nothing", () => {
    const fixed = { ...grid, columns: [grid.columns[1], grid.columns[1]] } as typeof grid;
    const r = verifyFrame(
      frame([
        [0, 0, 56, 20],
        [66, 0, 100, 40],
      ]),
      expected(fixed, [text, cell])
    );
    expect(r).toEqual({ ok: false, reason: "cell" });
  });
});
