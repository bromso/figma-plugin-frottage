import { describe, expect, test } from "bun:test";
import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { mapCapture, type PlanLayout, type PlanOp } from "../index";
import { collapseTarget, inferChildLayout, inferLayout } from "../layout";
import { cap, el, imageStyle, inter, run, textNode } from "./fixtures";

type Layout = ElementNode["layout"];
type FrameOp = Extract<PlanOp, { op: "frame" }>;

const box = (id: string, x: number, y: number, w: number, h: number, over = {}) =>
  el(id, [x, y], [], over, [w, h]);

const withLayout = (over: Partial<Layout>) => ({
  layout: { ...el("x", [0, 0]).layout, ...over },
});

/** A child whose layout differs from the defaults. */
const item = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  over: Partial<Layout>,
  rest: Partial<ElementNode> = {}
) => box(id, x, y, w, h, { ...withLayout(over), ...rest });

/** A flex row of 600 by 100 at the origin, or any other size or display. */
function flex(over: Partial<Layout> = {}, size: [number, number] = [600, 100]): ElementNode {
  return el(
    "parent",
    [0, 0],
    [],
    withLayout({
      display: "flex",
      flexDirection: "row",
      flexWrap: "nowrap",
      justifyContent: "normal",
      alignItems: "flex-start",
      gap: [0, 0],
      ...over,
    }),
    size
  );
}
const flexCol = (over: Partial<Layout> = {}, size: [number, number] = [600, 400]) =>
  flex({ flexDirection: "column", ...over }, size);

function grid(columns: string, over: Partial<Layout> = {}, size: [number, number] = [500, 100]) {
  const resolved = columns.includes("fr") ? "300px 200px" : columns;
  return flex(
    {
      display: "grid",
      flexDirection: undefined,
      flexWrap: undefined,
      gridTemplateColumns: resolved,
      gridTemplateRows: "100px",
      rowGap: 0,
      columnGap: 0,
      ...(columns.includes("fr") ? { authoredGridTemplateColumns: columns } : {}),
      ...over,
    },
    size
  );
}

// Three 100 px boxes with a 10 px gap, flush left in the parent.
const kids = [box("a", 0, 0, 100, 50), box("b", 110, 0, 100, 50), box("c", 220, 0, 100, 50)];
const stackKids = [box("a", 0, 0, 600, 50), box("b", 0, 60, 600, 50), box("c", 0, 120, 600, 50)];
const row = (over: Partial<Layout> = {}, size?: [number, number]) =>
  flex({ gap: [0, 10], ...over }, size);

function single(text: string, x = 0, y = 0, w = 100, h = 20, over: Partial<TextNode> = {}) {
  return textNode(`t-${text}`, { box: { x, y, w, h }, text, ...over });
}
function wrapped(x: number, y: number, w: number, h: number, align = "left") {
  return textNode("wrapped", {
    box: { x, y, w, h },
    text: "Two lines",
    lines: [
      { x, y, w, h: h / 2 },
      { x, y: y + h / 2, w: w - 10, h: h / 2 },
    ],
    runs: [run({ end: 9, align })],
  });
}

const frameOp = (root: ElementNode, id: string) =>
  mapCapture(cap(root), inter).ops.find((o) => o.id === id) as FrameOp;

const opIds = (root: ElementNode) => mapCapture(cap(root), inter).ops.map((o) => o.id);

describe("display: flex, row or column", () => {
  test("a row is HORIZONTAL", () => {
    expect(inferLayout(row(), kids)).toMatchObject({
      mode: "HORIZONTAL",
      wrap: false,
      itemSpacing: 10,
    });
  });
  test("inline-flex counts as flex", () => {
    expect(inferLayout(row({ display: "inline-flex" }), kids).mode).toBe("HORIZONTAL");
  });
  test("a column is VERTICAL", () => {
    expect(inferLayout(flexCol({ gap: [10, 0] }), stackKids)).toMatchObject({
      mode: "VERTICAL",
      itemSpacing: 10,
    });
  });
  test("display: flex that does not look like a row is NONE", () => {
    const stacked = [box("a", 0, 0, 100, 40), box("b", 0, 40, 100, 40)];
    expect(inferLayout(flex(), stacked)).toEqual({ mode: "NONE" });
  });
  test("no children, or only absolute ones, is NONE", () => {
    expect(inferLayout(flex(), [])).toEqual({ mode: "NONE" });
    expect(inferLayout(flex(), [item("a", 0, 0, 10, 10, { position: "absolute" })])).toEqual({
      mode: "NONE",
    });
  });
  test("an RTL row, whose order the capture cannot explain, is NONE", () => {
    const rtl = [
      box("a", 500, 0, 100, 50, { paintOrder: 1 }),
      box("b", 390, 0, 100, 50, { paintOrder: 2 }),
    ];
    expect(inferLayout(row(), rtl)).toEqual({ mode: "NONE" });
  });
  test("a hidden leaf does not take part, but its hole in the row is noticed", () => {
    const hole = [
      box("a", 0, 0, 100, 50),
      box("gone", 110, 0, 100, 50, { visible: false }),
      box("c", 220, 0, 100, 50),
    ];
    expect(inferLayout(row(), hole)).toEqual({ mode: "NONE" });
  });
});

describe("row-reverse, column-reverse and order", () => {
  const reversed = () => [
    box("first", 500, 0, 100, 50, { paintOrder: 1 }),
    box("second", 390, 0, 100, 50, { paintOrder: 2 }),
  ];

  test("row-reverse orders children by position, not DOM", () => {
    const parent = row({ flexDirection: "row-reverse", justifyContent: "normal" });
    parent.children = reversed();
    expect(frameOp(parent, "parent").layout).toMatchObject({ mode: "HORIZONTAL" });
    expect(opIds(parent)).toEqual(["parent", "second", "first"]);
  });
  test("row-reverse starts at the right, so its flex-start is MAX and flex-end is MIN", () => {
    expect(inferLayout(row({ flexDirection: "row-reverse" }), reversed())).toMatchObject({
      primaryAlign: "MAX",
    });
    const left = [
      box("first", 110, 0, 100, 50, { paintOrder: 1 }),
      box("second", 0, 0, 100, 50, { paintOrder: 2 }),
    ];
    expect(
      inferLayout(row({ flexDirection: "row-reverse", justifyContent: "flex-end" }), left)
    ).toMatchObject({ primaryAlign: "MIN" });
  });
  test("column-reverse orders children by position", () => {
    const parent = flexCol({ flexDirection: "column-reverse", justifyContent: "flex-end" });
    parent.children = [
      box("first", 0, 60, 100, 50, { paintOrder: 1 }),
      box("second", 0, 0, 100, 50, { paintOrder: 2 }),
    ];
    parent.layout.gap = [10, 0];
    expect(frameOp(parent, "parent").layout).toMatchObject({
      mode: "VERTICAL",
      primaryAlign: "MIN",
    });
    expect(opIds(parent)).toEqual(["parent", "second", "first"]);
  });
  test("order moves children, and the ops follow", () => {
    const parent = row();
    parent.children = [
      item("late", 110, 0, 100, 50, { order: 2 }, { paintOrder: 1 }),
      item("early", 0, 0, 100, 50, { order: 1 }, { paintOrder: 2 }),
    ];
    expect(frameOp(parent, "parent").layout.mode).toBe("HORIZONTAL");
    expect(opIds(parent)).toEqual(["parent", "early", "late"]);
  });
  test("a frame that stays NONE keeps DOM order, so paint order survives", () => {
    const parent = flex();
    parent.children = [
      box("first", 50, 0, 100, 50, { paintOrder: 1 }),
      box("second", 0, 0, 100, 50, { paintOrder: 2 }),
    ];
    expect(opIds(parent)).toEqual(["parent", "first", "second"]);
  });
  test("reordering around an absolute child that overlaps the flow is NONE", () => {
    const badge = item("badge", 500, 0, 10, 10, { position: "absolute" }, { paintOrder: 2 });
    const [first, second] = reversed();
    expect(
      inferLayout(row({ flexDirection: "row-reverse" }), [
        first as ElementNode,
        badge,
        { ...(second as ElementNode), paintOrder: 3 },
      ])
    ).toEqual({ mode: "NONE" });
  });
  test("paint order disagreeing with visual order stays NONE", () => {
    const flipped = [
      box("a", 0, 0, 100, 50, { paintOrder: 2 }),
      box("b", 110, 0, 100, 50, { paintOrder: 1 }),
    ];
    expect(inferLayout(row(), flipped)).toEqual({ mode: "NONE" });
  });
});

describe("gap", () => {
  test("row gap and column gap apply to the right axis", () => {
    expect(inferLayout(flex({ gap: [99, 10] }), kids)).toMatchObject({ itemSpacing: 10 });
    expect(inferLayout(flexCol({ gap: [10, 99] }), stackKids)).toMatchObject({ itemSpacing: 10 });
  });
  test("measured gaps that disagree with CSS gap are NONE", () => {
    expect(inferLayout(flex({ gap: [0, 4] }), kids)).toEqual({ mode: "NONE" });
  });
  test("unequal measured gaps are NONE", () => {
    const uneven = [box("a", 0, 0, 100, 50), box("b", 110, 0, 100, 50), box("c", 230, 0, 100, 50)];
    expect(inferLayout(row(), uneven)).toEqual({ mode: "NONE" });
  });
});

describe("padding", () => {
  test("padding comes through in top, right, bottom, left order", () => {
    const shifted = [box("a", 4, 1, 100, 50), box("b", 114, 1, 100, 50)];
    expect(inferLayout(row({ padding: [1, 2, 3, 4] }), shifted)).toMatchObject({
      padding: [1, 2, 3, 4],
    });
  });
  test("a CSS border takes space, so it counts as padding", () => {
    const parent = row({ padding: [1, 1, 1, 1] });
    const edge = { width: 2, color: { r: 0, g: 0, b: 0, a: 1 }, style: "solid" };
    parent.style.borders = { top: edge, right: edge, bottom: edge, left: edge };
    expect(inferLayout(parent, [box("a", 3, 3, 100, 50)])).toMatchObject({
      padding: [3, 3, 3, 3],
    });
  });
  test("padding that disagrees with the first child is NONE", () => {
    expect(inferLayout(row({ padding: [0, 0, 0, 30] }), kids)).toEqual({ mode: "NONE" });
  });
  test("uniform child margins fold into spacing", () => {
    const m = { margin: [8, 8, 8, 8] as Layout["margin"] };
    const spaced = [item("a", 8, 8, 100, 50, m), item("b", 124, 8, 100, 50, m)];
    expect(inferLayout(flex(), spaced)).toMatchObject({
      itemSpacing: 16,
      padding: [8, 8, 8, 8],
    });
  });
  test("a margin only between children still folds", () => {
    const next = { margin: [0, 0, 0, 8] as Layout["margin"] };
    const spaced = [
      box("a", 0, 0, 100, 50),
      item("b", 108, 0, 100, 50, next),
      item("c", 216, 0, 100, 50, next),
    ];
    expect(inferLayout(flex(), spaced)).toMatchObject({ itemSpacing: 8, padding: [0, 0, 0, 0] });
  });
  test("mixed margins are NONE", () => {
    const spaced = [
      box("a", 0, 0, 100, 50),
      item("b", 108, 0, 100, 50, { margin: [0, 0, 0, 8] }),
      item("c", 224, 0, 100, 50, { margin: [0, 0, 0, 16] }),
    ];
    expect(inferLayout(flex(), spaced)).toEqual({ mode: "NONE" });
  });
});

describe("flex-wrap", () => {
  const lines = [
    box("a", 0, 0, 100, 40),
    box("b", 110, 0, 100, 40),
    box("c", 0, 60, 100, 40),
    box("d", 110, 60, 100, 40),
  ];
  test("a wrapped row gets WRAP, with counterSpacing from the row gap", () => {
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [20, 10] }, [220, 100]), lines)).toMatchObject(
      { mode: "HORIZONTAL", wrap: true, itemSpacing: 10, counterSpacing: 20 }
    );
  });
  test("a wrapped frame is never HUG along the row, or it would not wrap", () => {
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [20, 10] }, [210, 100]), lines)).toMatchObject(
      { sizingH: "FIXED", sizingV: "HUG" }
    );
  });
  test("counterSpacing is null when it matches itemSpacing", () => {
    const even = [box("a", 0, 0, 100, 40), box("b", 0, 50, 100, 40)];
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [10, 10] }, [100, 90]), even)).toMatchObject({
      counterSpacing: null,
    });
  });
  test("a zero row gap cannot be written as a positive spacing, so several lines are NONE", () => {
    const tight = [box("a", 0, 0, 100, 40), box("b", 0, 40, 100, 40)];
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [0, 10] }, [100, 80]), tight)).toEqual({
      mode: "NONE",
    });
  });
  test("a zero row gap on one line is fine, and stays null", () => {
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [0, 10] }), kids)).toMatchObject({
      wrap: true,
      counterSpacing: null,
    });
  });
  test("counterSpacing is null without wrap", () => {
    expect(inferLayout(row(), kids)).toMatchObject({ counterSpacing: null });
  });
  test("a VERTICAL frame cannot wrap", () => {
    expect(inferLayout(flexCol({ flexWrap: "wrap" }), stackKids)).toEqual({ mode: "NONE" });
  });
  test("wrap-reverse is NONE", () => {
    expect(inferLayout(row({ flexWrap: "wrap-reverse" }), kids)).toEqual({ mode: "NONE" });
  });
  test("lines stretched apart by align-content are NONE", () => {
    expect(inferLayout(flex({ flexWrap: "wrap", gap: [5, 10] }, [220, 200]), lines)).toEqual({
      mode: "NONE",
    });
  });
});

describe("justify-content", () => {
  const center = [box("a", 195, 0, 100, 50), box("b", 305, 0, 100, 50)];
  const end = [box("a", 390, 0, 100, 50), box("b", 500, 0, 100, 50)];
  const between = [box("a", 0, 0, 100, 50), box("b", 250, 0, 100, 50), box("c", 500, 0, 100, 50)];

  test.each(["normal", "flex-start", "start", "left"])("%s is MIN", (justifyContent) => {
    expect(inferLayout(row({ justifyContent }), kids)).toMatchObject({ primaryAlign: "MIN" });
  });
  test("center is CENTER", () => {
    expect(inferLayout(row({ justifyContent: "center" }), center)).toMatchObject({
      primaryAlign: "CENTER",
    });
  });
  test("flex-end is MAX", () => {
    expect(inferLayout(row({ justifyContent: "flex-end" }), end)).toMatchObject({
      primaryAlign: "MAX",
    });
  });
  test("space-between is SPACE_BETWEEN on a FIXED primary axis", () => {
    expect(inferLayout(flex({ justifyContent: "space-between" }), between)).toMatchObject({
      primaryAlign: "SPACE_BETWEEN",
      sizingH: "FIXED",
    });
  });
  test("space-around maps to SPACE_AROUND", () => {
    const around = [box("a", 50, 0, 100, 50), box("b", 250, 0, 100, 50), box("c", 450, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-around" }), around)).toMatchObject({
      primaryAlign: "SPACE_AROUND",
      sizingH: "FIXED",
    });
  });
  test("space-evenly maps to SPACE_EVENLY", () => {
    const evenly = [box("a", 75, 0, 100, 50), box("b", 250, 0, 100, 50), box("c", 425, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-evenly" }), evenly)).toMatchObject({
      primaryAlign: "SPACE_EVENLY",
      sizingH: "FIXED",
    });
  });
  test("space-around and space-evenly with a gap are NONE until Figma's sum is known", () => {
    const around = [box("a", 40, 0, 100, 50), box("b", 250, 0, 100, 50), box("c", 460, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-around", gap: [0, 30] }), around)).toEqual({
      mode: "NONE",
    });
    const evenly = [box("a", 60, 0, 100, 50), box("b", 250, 0, 100, 50), box("c", 440, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-evenly", gap: [0, 30] }), evenly)).toEqual({
      mode: "NONE",
    });
  });
  test("space-between keeps its gap", () => {
    const apart = [box("a", 0, 0, 100, 50), box("b", 500, 0, 100, 50)];
    expect(
      inferLayout(flex({ justifyContent: "space-between", gap: [0, 30] }), apart)
    ).toMatchObject({ primaryAlign: "SPACE_BETWEEN", itemSpacing: 30 });
  });
  test("space-between on a primary axis that would hug stays FIXED", () => {
    const tight = [box("a", 0, 0, 100, 50), box("b", 100, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-between" }, [200, 50]), tight)).toMatchObject({
      primaryAlign: "SPACE_BETWEEN",
      sizingH: "FIXED",
    });
  });
  test("one child with a space-* value has the same simple meaning", () => {
    const lone = [box("a", 250, 0, 100, 50)];
    expect(inferLayout(flex({ justifyContent: "space-around" }), lone)).toMatchObject({
      primaryAlign: "CENTER",
    });
    expect(
      inferLayout(flex({ justifyContent: "space-between" }), [box("a", 0, 0, 100, 50)])
    ).toMatchObject({ primaryAlign: "MIN" });
  });
  test("boxes that do not show the distribution are NONE", () => {
    expect(inferLayout(flex({ justifyContent: "space-between" }), kids)).toEqual({ mode: "NONE" });
    expect(inferLayout(row({ justifyContent: "center" }), kids)).toEqual({ mode: "NONE" });
    expect(inferLayout(row({ justifyContent: "flex-end" }), kids)).toEqual({ mode: "NONE" });
    expect(inferLayout(flex({ justifyContent: "space-evenly" }), between)).toEqual({
      mode: "NONE",
    });
  });
});

describe("auto margins", () => {
  const pushed = (auto: Partial<Layout>) => [
    box("a", 0, 0, 100, 50),
    item("b", 500, 0, 100, 50, auto),
  ];
  const left = {
    margin: [0, 0, 0, 400] as Layout["margin"],
    marginAuto: [false, false, false, true] as Layout["marginAuto"],
  };

  test("the last of two children pushed right is SPACE_BETWEEN", () => {
    expect(inferLayout(flex(), pushed(left))).toMatchObject({
      mode: "HORIZONTAL",
      primaryAlign: "SPACE_BETWEEN",
      itemSpacing: 0,
      sizingH: "FIXED",
    });
  });
  test("so is the first of two with an auto margin on its right", () => {
    const first = item("a", 0, 0, 100, 50, {
      margin: [0, 400, 0, 0],
      marginAuto: [false, true, false, false],
    });
    expect(inferLayout(flex(), [first, box("b", 500, 0, 100, 50)])).toMatchObject({
      primaryAlign: "SPACE_BETWEEN",
    });
  });
  test("three children with an auto margin are NONE", () => {
    const three = [
      box("a", 0, 0, 100, 50),
      box("b", 100, 0, 100, 50),
      item("c", 500, 0, 100, 50, { margin: [0, 0, 0, 300], marginAuto: left.marginAuto }),
    ];
    expect(inferLayout(flex(), three)).toEqual({ mode: "NONE" });
  });
  test("one child with an auto margin is NONE", () => {
    expect(
      inferLayout(flex(), [
        item("a", 500, 0, 100, 50, { margin: [0, 0, 0, 500], marginAuto: left.marginAuto }),
      ])
    ).toEqual({ mode: "NONE" });
  });
  test("an auto margin pushing the first child away from the start is NONE", () => {
    const shoved = [
      item("a", 300, 0, 100, 50, { margin: [0, 0, 0, 300], marginAuto: left.marginAuto }),
      box("b", 400, 0, 100, 50),
    ];
    expect(inferLayout(flex(), shoved)).toEqual({ mode: "NONE" });
  });
  test("a cross-axis auto margin is NONE", () => {
    const centred = [
      box("a", 0, 0, 100, 50),
      item("b", 100, 25, 100, 50, {
        margin: [25, 0, 25, 0],
        marginAuto: [true, false, true, false],
      }),
    ];
    expect(inferLayout(flex(), centred)).toEqual({ mode: "NONE" });
  });
  test("a plain margin that happens to fill the row stays ordinary spacing", () => {
    const hug = [box("a", 0, 0, 20, 20), item("b", 28, 0, 40, 20, { margin: [0, 0, 0, 8] })];
    expect(inferLayout(flex({}, [68, 20]), hug)).toMatchObject({
      primaryAlign: "MIN",
      itemSpacing: 8,
      sizingH: "HUG",
    });
  });
  test("margin: 0 auto centres a block child", () => {
    const parent = el("parent", [0, 0], [], {}, [600, 50]);
    const auto = item("a", 100, 0, 400, 50, {
      margin: [0, 100, 0, 100],
      marginAuto: [false, true, false, true],
    });
    expect(inferLayout(parent, [auto])).toMatchObject({ mode: "VERTICAL", counterAlign: "CENTER" });
  });
});

describe("align-items", () => {
  const tall = (y: number) => [box("a", 0, y, 100, 40), box("b", 110, y, 100, 40)];

  test("flex-start is MIN", () => {
    expect(inferLayout(row(), tall(0))).toMatchObject({ counterAlign: "MIN" });
  });
  test("center is CENTER", () => {
    expect(inferLayout(row({ alignItems: "center" }), tall(30))).toMatchObject({
      counterAlign: "CENTER",
    });
  });
  test("flex-end is MAX", () => {
    expect(inferLayout(row({ alignItems: "flex-end" }), tall(60))).toMatchObject({
      counterAlign: "MAX",
    });
  });
  test("boxes that do not sit where align-items says are NONE", () => {
    expect(inferLayout(row({ alignItems: "center" }), tall(0))).toEqual({ mode: "NONE" });
  });
  test("align-self that breaks the shared alignment is NONE", () => {
    const self = [box("a", 0, 0, 100, 40), item("b", 110, 60, 100, 40, { alignSelf: "flex-end" })];
    expect(inferLayout(row(), self)).toEqual({ mode: "NONE" });
  });
  test("stretch is FILL on the cross axis of a child", () => {
    const parent = row({ alignItems: "normal" });
    const children = [box("a", 0, 0, 100, 100), box("b", 110, 0, 100, 100)];
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ counterAlign: "MIN", sizingV: "FIXED" });
    expect(inferChildLayout(children[0] as ElementNode, layout, parent)).toMatchObject({
      sizingV: "FILL",
      sizingH: "FIXED",
    });
  });
  test("a child with align-self: stretch fills inside a centred row", () => {
    const parent = row({ alignItems: "center" });
    const children = [
      box("a", 0, 30, 100, 40),
      item("b", 110, 0, 100, 100, { alignSelf: "stretch" }),
    ];
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ counterAlign: "CENTER" });
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingV).toBe("FILL");
  });
  test("a centred child as tall as the row does not fill", () => {
    const parent = row({ alignItems: "center" }, [600, 40]);
    const children = tall(0);
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ sizingV: "HUG" });
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingV).toBe("FIXED");
  });
  test("baseline is BASELINE on a row, whatever the offsets", () => {
    const offset = [box("a", 0, 12, 100, 20), box("b", 110, 0, 100, 40)];
    expect(inferLayout(row({ alignItems: "baseline" }, [600, 40]), offset)).toMatchObject({
      counterAlign: "BASELINE",
      sizingV: "HUG",
    });
  });
  test("BASELINE only applies to HORIZONTAL", () => {
    expect(inferLayout(flexCol({ alignItems: "baseline", gap: [10, 0] }), stackKids)).toMatchObject(
      {
        counterAlign: "MIN",
      }
    );
  });
});

describe("FILL", () => {
  test("flex-grow is FILL on the primary axis", () => {
    const parent = flex();
    const children = [box("a", 0, 0, 100, 50), item("b", 100, 0, 500, 50, { grow: 1 })];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ sizingH: "FIXED" });
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingH).toBe("FILL");
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingH).toBe("FIXED");
  });
  test("grown children of different sizes keep their width, since FILL shares equally", () => {
    const parent = flex();
    const children = [
      item("a", 0, 0, 200, 50, { grow: 1 }),
      item("b", 200, 0, 400, 50, { grow: 2 }),
    ];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingH).toBe("FIXED");
  });
  test("equally grown children all FILL", () => {
    const parent = flex();
    const children = [
      item("a", 0, 0, 300, 50, { grow: 1 }),
      item("b", 300, 0, 300, 50, { grow: 1 }),
    ];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingH).toBe("FILL");
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingH).toBe("FILL");
  });
  test("a child 100% of the parent content box is FILL", () => {
    const parent = flexCol({ alignItems: "center", padding: [0, 20, 0, 20] });
    const child = box("a", 20, 0, 560, 50);
    const layout = inferLayout(parent, [child]);
    expect(inferChildLayout(child, layout, parent).sizingH).toBe("FILL");
  });
  test("a lone child that fills a block-level row is FILL", () => {
    const parent = flex({}, [600, 50]);
    const child = box("a", 0, 0, 600, 50);
    parent.children = [child];
    expect(inferChildLayout(child, inferLayout(parent, [child]), parent).sizingH).toBe("FILL");
  });
  test("a lone child in an inline-flex row hugs instead", () => {
    const parent = flex({ display: "inline-flex" }, [80, 50]);
    const child = box("a", 0, 0, 80, 50);
    expect(inferLayout(parent, [child])).toMatchObject({ sizingH: "HUG" });
  });
  test("FILL never sits in a HUG axis: the parent goes FIXED", () => {
    const parent = flex({}, [600, 50]);
    const child = item("a", 0, 0, 600, 50, { grow: 1 });
    expect(inferLayout(parent, [child])).toMatchObject({ sizingH: "FIXED" });
  });
  test("a wrapped frame never asks for FILL", () => {
    const parent = flex({ flexWrap: "wrap", alignItems: "normal" }, [600, 50]);
    const child = item("a", 0, 0, 600, 50, { grow: 1 });
    const out = inferChildLayout(child, inferLayout(parent, [child]), parent);
    expect(out).toMatchObject({ sizingH: "FIXED", sizingV: "FIXED" });
  });
  test("an image is never FILL, however large", () => {
    const parent = flexCol({ alignItems: "normal" }, [600, 50]);
    const image = {
      ...imageStyle,
      id: "i",
      kind: "image" as const,
      box: { x: 0, y: 0, w: 600, h: 50 },
      paintOrder: 1,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: "img" },
      fit: "cover" as const,
      objectPosition: "50% 50%",
    };
    expect(inferChildLayout(image, inferLayout(parent, [image]), parent)).toMatchObject({
      sizingH: "FIXED",
      sizingV: "FIXED",
    });
  });
});

describe("HUG and FIXED", () => {
  test("a parent the size of its content hugs on both axes", () => {
    expect(inferLayout(row({}, [320, 50]), kids)).toMatchObject({ sizingH: "HUG", sizingV: "HUG" });
  });
  test("padding counts towards the hug size", () => {
    const shifted = [box("a", 4, 1, 100, 50)];
    const hugging = flex({ display: "inline-flex", padding: [1, 2, 3, 4] }, [106, 54]);
    expect(inferLayout(hugging, shifted)).toMatchObject({
      sizingH: "HUG",
      sizingV: "HUG",
    });
  });
  test("a parent larger than its content is FIXED", () => {
    expect(inferLayout(row(), kids)).toMatchObject({ sizingH: "FIXED", sizingV: "FIXED" });
  });
  test("a child frame takes its own hug, and a NONE frame cannot hug", () => {
    const parent = flexCol({}, [600, 400]);
    const hugging = item(
      "a",
      0,
      0,
      320,
      50,
      { display: "flex", flexDirection: "row", gap: [0, 10], alignItems: "flex-start" },
      { children: kids }
    );
    expect(inferChildLayout(hugging, inferLayout(parent, [hugging]), parent)).toMatchObject({
      sizingH: "HUG",
      sizingV: "HUG",
    });
    const plain = box("b", 0, 0, 320, 50);
    expect(inferChildLayout(plain, inferLayout(parent, [plain]), parent)).toMatchObject({
      sizingH: "FIXED",
      sizingV: "FIXED",
    });
  });
});

describe("absolute children", () => {
  const abs = item("abs", 590, -5, 20, 20, { position: "absolute" });

  test("an absolute child in a flex parent is ABSOLUTE and leaves the flow alone", () => {
    const parent = row();
    const layout = inferLayout(parent, [...kids, abs]);
    expect(layout).toMatchObject({ mode: "HORIZONTAL", itemSpacing: 10 });
    expect(inferChildLayout(abs, layout, parent)).toMatchObject({ positioning: "ABSOLUTE" });
  });
  test("position: fixed is ABSOLUTE too", () => {
    const parent = row();
    const fixed = item("fix", 0, 0, 20, 20, { position: "fixed" });
    expect(inferChildLayout(fixed, inferLayout(parent, [...kids, fixed]), parent).positioning).toBe(
      "ABSOLUTE"
    );
  });
  test("an in-flow child is AUTO, and relative or sticky ones are in flow", () => {
    const parent = row();
    const a = item("a", 0, 0, 100, 50, { position: "relative" });
    const b = item("b", 110, 0, 100, 50, { position: "sticky" });
    const layout = inferLayout(parent, [a, b]);
    expect(layout.mode).toBe("HORIZONTAL");
    expect(inferChildLayout(a, layout, parent).positioning).toBe("AUTO");
    expect(inferChildLayout(b, layout, parent).positioning).toBe("AUTO");
  });
  test("its op keeps x and y relative to the parent", () => {
    const parent = row();
    parent.box = { ...parent.box, x: 100, y: 200 };
    parent.children = [
      box("a", 100, 200, 100, 50),
      item("abs", 690, 195, 20, 20, { position: "absolute" }),
    ];
    const op = frameOp({ ...el("root", [0, 0], [parent], { style: painted() }) }, "abs");
    expect(op).toMatchObject({ x: 590, y: -5, childLayout: { positioning: "ABSOLUTE" } });
  });
});

function painted() {
  return {
    ...el("x", [0, 0]).style,
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
  };
}

describe("normal-flow block stack", () => {
  const stack = (size: [number, number] = [600, 170]) => el("parent", [0, 0], [], {}, size);

  test("a block stack with equal gaps is VERTICAL", () => {
    const margins = { margin: [10, 0, 10, 0] as Layout["margin"] };
    const children = [
      item("a", 0, 10, 600, 50, margins),
      item("b", 0, 70, 600, 50, margins),
      item("c", 0, 130, 600, 50, margins),
    ];
    expect(inferLayout(stack([600, 190]), children)).toMatchObject({
      mode: "VERTICAL",
      itemSpacing: 10,
      padding: [10, 0, 10, 0],
      primaryAlign: "MIN",
    });
  });
  test("collapsed margins are the larger of the two, not the sum", () => {
    const children = [
      item("a", 0, 0, 600, 50, { margin: [0, 0, 24, 0] }),
      item("b", 0, 74, 600, 50, { margin: [16, 0, 0, 0] }),
    ];
    expect(inferLayout(stack([600, 124]), children)).toMatchObject({ itemSpacing: 24 });
  });
  test("margins collapsing through the parent stay outside it", () => {
    const m = { margin: [20, 0, 20, 0] as Layout["margin"] };
    const children = [item("a", 0, 0, 600, 50, m), item("b", 0, 70, 600, 50, m)];
    expect(inferLayout(stack([600, 120]), children)).toMatchObject({
      itemSpacing: 20,
      padding: [0, 0, 0, 0],
      sizingV: "HUG",
    });
  });
  test("a block stack with unequal gaps is NONE", () => {
    const children = [box("a", 0, 0, 600, 50), box("b", 0, 60, 600, 50), box("c", 0, 130, 600, 50)];
    expect(inferLayout(stack(), children)).toEqual({ mode: "NONE" });
  });
  test("gaps from margins inside the children count, since only the boxes show them", () => {
    const children = [box("a", 0, 0, 600, 50), box("b", 0, 70, 600, 50), box("c", 0, 140, 600, 50)];
    expect(inferLayout(stack([600, 190]), children)).toMatchObject({
      mode: "VERTICAL",
      itemSpacing: 20,
    });
  });
  test("the lead above the first child is padding, whatever made it", () => {
    expect(inferLayout(stack([600, 66]), [box("a", 0, 16, 600, 50)])).toMatchObject({
      mode: "VERTICAL",
      padding: [16, 0, 0, 0],
      sizingV: "HUG",
    });
  });
  test("a first child above the content edge is NONE", () => {
    const parent = stack([600, 60]);
    parent.layout.padding = [10, 0, 0, 0];
    expect(inferLayout(parent, [box("a", 0, 2, 600, 50)])).toEqual({ mode: "NONE" });
  });
  test("children with mixed edges are NONE", () => {
    const children = [box("a", 0, 0, 100, 50), box("b", 200, 50, 100, 50)];
    expect(inferLayout(stack(), children)).toEqual({ mode: "NONE" });
  });
  test("right-aligned and centred stacks are read from the boxes", () => {
    expect(
      inferLayout(stack(), [box("a", 500, 0, 100, 50), box("b", 400, 50, 200, 50)])
    ).toMatchObject({ counterAlign: "MAX" });
    expect(
      inferLayout(stack(), [box("a", 250, 0, 100, 50), box("b", 200, 50, 200, 50)])
    ).toMatchObject({ counterAlign: "CENTER" });
  });
  test("block children as wide as the content box FILL", () => {
    const parent = stack();
    const layout = inferLayout(parent, stackKids.slice(0, 1));
    expect(layout).toMatchObject({ sizingH: "FIXED" });
    expect(inferChildLayout(stackKids[0] as ElementNode, layout, parent).sizingH).toBe("FILL");
  });
  test("text beside block children takes part", () => {
    const leading = 2;
    const text = single("lede", 0, leading, 100, 16, {
      lines: [{ x: 0, y: leading, w: 100, h: 16 }],
      runs: [run({ lineHeight: 20 })],
    });
    expect(inferLayout(stack([600, 70]), [text, box("a", 0, 20, 600, 50)])).toMatchObject({
      mode: "VERTICAL",
      itemSpacing: 0,
      sizingV: "HUG",
    });
  });
});

describe("what stays absolute", () => {
  const side = [box("a", 0, 0, 100, 50), box("b", 100, 0, 100, 50)];

  test.each(["table", "table-row", "table-cell", "inline-table", "inline", "ruby"])(
    "display: %s is NONE",
    (display) => {
      expect(inferLayout(flex({ display }), side)).toEqual({ mode: "NONE" });
    }
  );
  test("floats side by side are NONE, which the boxes show", () => {
    expect(inferLayout(el("p", [0, 0], [], {}, [600, 50]), side)).toEqual({ mode: "NONE" });
  });
  test("a run of inline-block children is NONE, even stacked", () => {
    const run2 = [
      item("a", 0, 0, 600, 50, { display: "inline-block" }),
      item("b", 0, 50, 600, 50, { display: "inline-block" }),
    ];
    expect(inferLayout(el("p", [0, 0], [], {}, [600, 100]), run2)).toEqual({ mode: "NONE" });
  });
  test("overlapping in-flow children are NONE", () => {
    const overlap = [box("a", 0, 0, 100, 50), box("b", 60, 0, 100, 50)];
    expect(inferLayout(flex(), overlap)).toEqual({ mode: "NONE" });
    const stacked = [box("a", 0, 0, 100, 50), box("b", 0, 30, 100, 50)];
    expect(inferLayout(el("p", [0, 0], [], {}, [100, 80]), stacked)).toEqual({ mode: "NONE" });
  });
  test("a negative margin is NONE even when nothing overlaps", () => {
    const pulled = [box("a", 0, 0, 100, 50), item("b", 104, 0, 100, 50, { margin: [0, 0, 0, -6] })];
    expect(inferLayout(flex({ gap: [0, 10] }), pulled)).toEqual({ mode: "NONE" });
  });
});

describe("grid", () => {
  const cells = [box("a", 0, 0, 300, 100), box("b", 300, 0, 200, 100)];

  test("a simple grid becomes GRID with FLEX and FIXED tracks", () => {
    expect(inferLayout(grid("1fr 200px"), cells)).toMatchObject({
      mode: "GRID",
      columns: [
        { type: "FLEX", value: 1 },
        { type: "FIXED", value: 200 },
      ],
      rows: [{ type: "FIXED", value: 100 }],
    });
  });
  test("repeat and minmax in the authored value are read", () => {
    const three = grid(
      "repeat(3, minmax(0px, 1fr))",
      { gridTemplateColumns: "100px 100px 100px" },
      [300, 100]
    );
    expect(
      inferLayout(three, [
        box("a", 0, 0, 100, 100),
        box("b", 100, 0, 100, 100),
        box("c", 200, 0, 100, 100),
      ])
    ).toMatchObject({
      columns: [
        { type: "FLEX", value: 1 },
        { type: "FLEX", value: 1 },
        { type: "FLEX", value: 1 },
      ],
    });
  });
  test("fr weights are kept", () => {
    expect(inferLayout(grid("3fr 2fr"), cells)).toMatchObject({
      columns: [
        { type: "FLEX", value: 3 },
        { type: "FLEX", value: 2 },
      ],
    });
  });
  test("without an authored value, equal tracks are FLEX and others FIXED", () => {
    const parent = grid("150px 200px 150px");
    const children = [
      box("a", 0, 0, 150, 100),
      box("b", 150, 0, 200, 100),
      box("c", 350, 0, 150, 100),
    ];
    expect(inferLayout(parent, children)).toMatchObject({
      columns: [
        { type: "FLEX", value: 1 },
        { type: "FIXED", value: 200 },
        { type: "FLEX", value: 1 },
      ],
    });
  });
  test("an authored value that disagrees with the computed tracks is ignored", () => {
    const parent = grid("300px 200px", { authoredGridTemplateColumns: "1fr 1fr" });
    expect(inferLayout(parent, cells)).toMatchObject({
      columns: [
        { type: "FIXED", value: 300 },
        { type: "FIXED", value: 200 },
      ],
    });
  });
  test("auto tracks in the authored value are HUG", () => {
    const parent = grid("1fr auto");
    expect(inferLayout(parent, cells)).toMatchObject({
      columns: [
        { type: "FLEX", value: 1 },
        { type: "HUG", value: 200 },
      ],
    });
  });
  test("gaps and padding carry over", () => {
    const parent = grid(
      "100px 200px",
      { columnGap: 10, rowGap: 6, padding: [4, 4, 4, 4], gridTemplateRows: "40px 40px" },
      [318, 94]
    );
    const children = [box("a", 4, 4, 100, 40), box("b", 114, 4, 200, 40), box("c", 4, 50, 100, 40)];
    expect(inferLayout(parent, children)).toMatchObject({
      mode: "GRID",
      columnGap: 10,
      rowGap: 6,
      padding: [4, 4, 4, 4],
    });
  });
  test("cells come from the boxes, not DOM order", () => {
    const parent = grid(
      "100px 200px",
      { columnGap: 10, rowGap: 6, gridTemplateRows: "40px 40px" },
      [310, 86]
    );
    const children = [
      box("a", 0, 0, 100, 40),
      box("b", 110, 0, 200, 40),
      box("c", 110, 46, 200, 40),
    ];
    const layout = inferLayout(parent, children);
    expect(inferChildLayout(children[2] as ElementNode, layout, parent)).toMatchObject({
      positioning: "AUTO",
      sizingH: "FILL",
      sizingV: "FILL",
      cell: { row: 1, column: 1 },
    });
  });
  test.each([
    ["span 2", "auto"],
    ["auto", "span 2"],
    ["1 / 3", "auto"],
    ["span 2 / auto", "auto"],
  ])("a grid with spans stays NONE (%s, %s)", (gridColumn, gridRow) => {
    const spanning = item("a", 0, 0, 500, 100, { gridColumn, gridRow });
    expect(inferLayout(grid("300px 200px"), [spanning])).toEqual({ mode: "NONE" });
  });
  test("a span the styles do not show is caught by its box", () => {
    expect(inferLayout(grid("300px 200px"), [box("a", 0, 0, 500, 100)])).toEqual({ mode: "NONE" });
  });
  test("span 1 and a single line are not spans", () => {
    const one = item("a", 0, 0, 300, 100, { gridColumn: "span 1", gridRow: "1" });
    expect(inferLayout(grid("300px 200px"), [one]).mode).toBe("GRID");
  });
  test("two children in one cell are NONE", () => {
    expect(
      inferLayout(grid("300px 200px"), [box("a", 0, 0, 300, 100), box("b", 0, 0, 300, 100)])
    ).toEqual({ mode: "NONE" });
  });
  test("a child placed off the start of its cell is NONE", () => {
    expect(inferLayout(grid("300px 200px"), [box("a", 100, 0, 200, 100)])).toEqual({
      mode: "NONE",
    });
  });
  test("a grid in a HUG parent never gets FLEX tracks", () => {
    const hugging: PlanLayout = {
      mode: "VERTICAL",
      wrap: false,
      itemSpacing: 0,
      counterSpacing: null,
      padding: [0, 0, 0, 0],
      primaryAlign: "MIN",
      counterAlign: "MIN",
      sizingH: "HUG",
      sizingV: "HUG",
    };
    const layout = inferLayout(
      grid("1fr 1fr", { gridTemplateColumns: "250px 250px", gridTemplateRows: "50px 50px" }),
      [box("a", 0, 0, 250, 50), box("b", 250, 0, 250, 50), box("c", 0, 50, 250, 50)],
      { parent: hugging }
    );
    expect(layout).toMatchObject({
      mode: "GRID",
      columns: [
        { type: "FIXED", value: 250 },
        { type: "FIXED", value: 250 },
      ],
      rows: [
        { type: "FIXED", value: 50 },
        { type: "FIXED", value: 50 },
      ],
    });
  });
  test("each axis follows its own parent sizing", () => {
    const hugWide: PlanLayout = {
      mode: "VERTICAL",
      wrap: false,
      itemSpacing: 0,
      counterSpacing: null,
      padding: [0, 0, 0, 0],
      primaryAlign: "MIN",
      counterAlign: "MIN",
      sizingH: "HUG",
      sizingV: "FIXED",
    };
    const layout = inferLayout(
      grid("1fr 1fr", { gridTemplateColumns: "250px 250px", gridTemplateRows: "50px 50px" }),
      [box("a", 0, 0, 250, 50), box("c", 0, 50, 250, 50)],
      { parent: hugWide }
    );
    expect(layout).toMatchObject({
      columns: [{ type: "FIXED" }, { type: "FIXED" }],
      rows: [{ type: "FLEX" }, { type: "FLEX" }],
    });
  });
  test("mapCapture hands a grid its hugging parent", () => {
    const inner = grid("1fr 1fr", { gridTemplateColumns: "250px 250px" });
    inner.id = "g";
    inner.children = [box("a", 0, 0, 250, 100), box("b", 250, 0, 250, 100)];
    const outer = flex({ display: "inline-flex" }, [500, 100]);
    outer.children = [inner];
    expect(frameOp(outer, "parent").layout).toMatchObject({ sizingH: "HUG" });
    expect(frameOp(outer, "g").layout).toMatchObject({
      mode: "GRID",
      columns: [{ type: "FIXED" }, { type: "FIXED" }],
    });
  });
  test("an inline grid hugs, so it gets no FLEX columns either", () => {
    const layout = inferLayout(
      grid("1fr 1fr", { display: "inline-grid", gridTemplateColumns: "250px 250px" }),
      [box("a", 0, 0, 250, 100)]
    );
    expect(layout).toMatchObject({ columns: [{ type: "FIXED" }, { type: "FIXED" }] });
  });
  test("tracks a browser left as words are NONE", () => {
    expect(inferLayout(grid("subgrid"), cells)).toEqual({ mode: "NONE" });
    expect(inferLayout(grid("none"), cells)).toEqual({ mode: "NONE" });
  });
  test("line names in computed tracks are ignored", () => {
    expect(inferLayout(grid("[a] 300px [b] 200px [c]"), cells)).toMatchObject({ mode: "GRID" });
  });
  test("an absolute child keeps the grid absolute until Figma is shown to take one", () => {
    const parent = grid("300px 200px");
    const abs = item("abs", 0, 0, 500, 100, { position: "absolute" });
    expect(inferLayout(parent, [...cells, abs])).toEqual({ mode: "NONE" });
    expect(inferLayout(parent, cells).mode).toBe("GRID");
  });
  test("a child smaller than its track keeps its size", () => {
    const parent = grid("300px 200px");
    const small = box("a", 0, 0, 100, 40);
    expect(inferChildLayout(small, inferLayout(parent, [small]), parent)).toMatchObject({
      sizingH: "FIXED",
      sizingV: "FIXED",
      cell: { row: 0, column: 0 },
    });
  });
});

describe("text children", () => {
  test("single-line text hugs both ways", () => {
    const parent = flex({}, [600, 20]);
    const t = single("one");
    expect(inferChildLayout(t, inferLayout(parent, [t]), parent)).toMatchObject({
      positioning: "AUTO",
      sizingH: "HUG",
      sizingV: "HUG",
    });
  });
  test("wrapped text in a row is FIXED at its width", () => {
    const parent = flex({}, [600, 40]);
    const t = wrapped(0, 0, 200, 40);
    expect(inferChildLayout(t, inferLayout(parent, [t]), parent)).toMatchObject({
      sizingH: "FIXED",
      sizingV: "HUG",
    });
  });
  test("wrapped text in a column FILLs the width, and the parent is FIXED", () => {
    const parent = el("p", [0, 0], [], {}, [300, 40]);
    const t = wrapped(0, 0, 300, 40);
    const layout = inferLayout(parent, [t]);
    expect(layout).toMatchObject({ sizingH: "FIXED" });
    expect(inferChildLayout(t, layout, parent)).toMatchObject({ sizingH: "FILL", sizingV: "HUG" });
  });
  test("centred wrapped text keeps a matching parent alignment and FILLs", () => {
    const parent = el("p", [0, 0], [], {}, [300, 40]);
    const t = wrapped(20, 0, 260, 40, "center");
    const layout = inferLayout(parent, [t]);
    expect(layout).toMatchObject({ counterAlign: "CENTER" });
    expect(inferChildLayout(t, layout, parent).sizingH).toBe("FILL");
  });
  test("left-aligned wrapped text in a centred column stays FIXED, or it would move", () => {
    const parent = flexCol({ alignItems: "center" }, [300, 40]);
    const t = wrapped(50, 0, 200, 40);
    expect(inferChildLayout(t, inferLayout(parent, [t]), parent).sizingH).toBe("FIXED");
  });
  test("text is measured by its line box, as the op places it", () => {
    const parent = flex({ alignItems: "flex-start" }, [100, 24]);
    const t = single("lh", 0, 2, 100, 20, {
      lines: [{ x: 0, y: 2, w: 100, h: 20 }],
      runs: [run({ lineHeight: 24 })],
    });
    expect(inferLayout(parent, [t])).toMatchObject({
      mode: "HORIZONTAL",
      padding: [0, 0, 0, 0],
      sizingV: "HUG",
    });
  });
  test("an empty text does not take part", () => {
    const parent = row();
    expect(inferLayout(parent, [...kids, single("", 900, 0, 0, 0)]).mode).toBe("HORIZONTAL");
  });
});

describe("NONE parents", () => {
  test("no op under a NONE parent carries childLayout, which needs auto layout", () => {
    const parent = flex();
    parent.children = [box("a", 0, 0, 100, 50), box("b", 50, 0, 100, 50)];
    expect(frameOp(parent, "a").childLayout).toBeUndefined();
  });
  test("inferChildLayout under NONE stays plain", () => {
    const parent = flex();
    const a = box("a", 0, 0, 100, 50);
    expect(inferChildLayout(a, { mode: "NONE" }, parent)).toEqual({
      positioning: "AUTO",
      sizingH: "FIXED",
      sizingV: "FIXED",
    });
  });
});

describe("plan", () => {
  test("every frame op has a layout, and every child of auto layout a childLayout", () => {
    const parent = row();
    parent.children = [box("a", 0, 0, 100, 50, { children: [] }), single("hello", 110, 0, 100, 20)];
    const ops = mapCapture(cap(parent), inter).ops;
    expect(ops[0]).toMatchObject({ id: "parent", layout: { mode: "HORIZONTAL" } });
    expect(ops[0]).not.toHaveProperty("childLayout");
    expect(ops[1]).toMatchObject({
      layout: { mode: "NONE" },
      childLayout: { positioning: "AUTO" },
    });
    expect(ops[2]).toMatchObject({ op: "text", childLayout: { sizingH: "HUG" } });
  });
  test("a FILL child frame does not also claim HUG", () => {
    const parent = flexCol({}, [600, 400]);
    const inner = item(
      "inner",
      0,
      0,
      600,
      50,
      { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: [0, 10] },
      { children: [box("x", 0, 0, 600, 50, { style: painted() })] }
    );
    inner.style = painted();
    parent.children = [inner];
    const op = frameOp(parent, "inner");
    expect(op.childLayout?.sizingH).toBe("FILL");
    expect(op.layout).toMatchObject({ sizingH: "FIXED" });
  });
  test("the plan is plain JSON", () => {
    const parent = row();
    parent.children = kids;
    const plan = mapCapture(cap(parent), inter);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe("wrapper collapse", () => {
  const leaf = (id = "leaf") => box(id, 0, 0, 100, 50, { style: painted() });
  const wrap = (over: Partial<ElementNode> = {}, child: CaptureNode = leaf()) =>
    el("wrap", [0, 0], [child], over, [100, 50]);
  const page = (...children: CaptureNode[]) =>
    el("root", [0, 0], children, { style: painted() }, [800, 600]);

  test("a wrapper with no paint, one child and a matching box goes", () => {
    expect(opIds(page(wrap()))).toEqual(["root", "leaf"]);
  });
  test("the child keeps its id and takes the parent of the wrapper", () => {
    const op = mapCapture(cap(page(wrap())), inter).ops[1];
    expect(op).toMatchObject({ id: "leaf", parent: "root" });
  });
  test("chains collapse", () => {
    const inner = el("mid", [0, 0], [leaf()], {}, [100, 50]);
    expect(opIds(page(wrap({}, inner)))).toEqual(["root", "leaf"]);
  });
  test("the semantics of the wrapper reach the child", () => {
    const nav = wrap({ semantic: { tag: "nav", landmark: "navigation", ariaLabel: "Main" } });
    expect(frameOp(page(nav), "leaf").name).toBe("Navigation - Main");
    const a = wrap(
      { semantic: { tag: "a", href: "https://example.com/" } },
      single("Go", 0, 0, 100, 50, { semantic: { tag: "div" } })
    );
    const out = mapCapture(cap(page(a)), inter).ops[1];
    expect(out).toMatchObject({ op: "text", name: "Go" });
  });
  test("a child with its own meaning keeps its tag, and gains what the wrapper knew", () => {
    const child = box("list", 0, 0, 100, 50, { semantic: { tag: "ul" }, style: painted() });
    const nav = wrap({ semantic: { tag: "nav", landmark: "navigation" } }, child);
    expect(frameOp(page(nav), "list").name).toBe("Navigation");
  });
  test("the root never collapses", () => {
    expect(opIds(el("root", [0, 0], [box("only", 0, 0, 100, 100)], {}, [100, 100]))).toEqual([
      "root",
      "only",
    ]);
  });
  test("collapseTarget merges what each wrapper knew, nearest first", () => {
    const list = box("list", 0, 0, 100, 50, {
      semantic: { tag: "ul", ariaLabel: "Links" },
      style: painted(),
    });
    const nav = wrap(
      { semantic: { tag: "nav", landmark: "navigation", ariaLabel: "Main", role: "menu" } },
      list
    );
    expect(collapseTarget(nav, new Set()).semantic).toEqual({
      tag: "ul",
      ariaLabel: "Links",
      landmark: "navigation",
      role: "menu",
    });
    const plain = wrap({ semantic: { tag: "section" } });
    expect(collapseTarget(plain, new Set()).semantic.tag).toBe("section");
  });
  test("collapsing leaves the capture as it was", () => {
    const child = leaf();
    const before = JSON.stringify(child);
    collapseTarget(wrap({ semantic: { tag: "nav" } }, child), new Set());
    expect(JSON.stringify(child)).toBe(before);
  });
  test("a custom element never collapses", () => {
    const custom = wrap({ semantic: { tag: "x-card" } });
    expect(opIds(page(custom))).toEqual(["root", "wrap", "leaf"]);
  });
  test("a custom element child survives a plain wrapper, tag intact", () => {
    const child = box("c", 0, 0, 100, 50, { semantic: { tag: "x-card" }, style: painted() });
    const section = wrap({ semantic: { tag: "section" } }, child);
    expect(frameOp(page(section), "c").name).toBe("Card");
  });
  test.each([
    ["a fill", { backgroundColor: { r: 1, g: 0, b: 0, a: 1 } }],
    ["a gradient", { backgroundImages: [{ type: "linear-gradient" as const, css: "x" }] }],
    [
      "a shadow",
      {
        boxShadows: [
          { inset: false, x: 0, y: 1, blur: 2, spread: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      },
    ],
    ["a filter", { filters: ["blur(2px)"] }],
    ["a backdrop filter", { backdropFilter: "blur(2px)" }],
    ["clipping", { overflow: "hidden" }],
  ])("a wrapper with %s stays", (_, style) => {
    expect(opIds(page(wrap({ style: { ...el("x", [0, 0]).style, ...style } })))).toEqual([
      "root",
      "wrap",
      "leaf",
    ]);
  });
  test("a wrapper with a border stays", () => {
    const edge = { width: 1, color: { r: 0, g: 0, b: 0, a: 1 }, style: "solid" };
    const base = el("x", [0, 0]).style;
    const style = { ...base, borders: { ...base.borders, top: edge } };
    expect(opIds(page(wrap({ style })))).toEqual(["root", "wrap", "leaf"]);
  });
  test.each([
    ["opacity", { opacity: 0.5 }],
    ["a blend mode", { blendMode: "multiply" }],
    ["a transform", { transform: [1, 0, 0, 1, 5, 5] as ElementNode["transform"] }],
    ["visibility: hidden", { visible: false }],
  ])("a wrapper with %s stays", (_, over) => {
    expect(opIds(page(wrap(over)))).toEqual(["root", "wrap", "leaf"]);
  });
  test("two children, or a box that does not match, stay", () => {
    expect(opIds(page(el("wrap", [0, 0], [leaf("l1"), leaf("l2")], {}, [100, 50])))).toContain(
      "wrap"
    );
    expect(opIds(page(el("wrap", [0, 0], [leaf()], {}, [120, 50])))).toContain("wrap");
    expect(opIds(page(el("wrap", [4, 0], [leaf()], {}, [100, 50])))).toContain("wrap");
  });
  test("a wrapper does not collapse into an absolute child, whose flow would change", () => {
    const child = item("abs", 0, 0, 100, 50, { position: "absolute" }, { style: painted() });
    expect(opIds(page(wrap({}, child)))).toEqual(["root", "wrap", "abs"]);
  });
  test("repeated items keep their frames for Stage 2", () => {
    const card = (i: number) =>
      el(
        `card${i}`,
        [i * 110, 0],
        [box(`in${i}`, i * 110, 0, 100, 50, { style: painted() })],
        { semantic: { tag: "li" } },
        [100, 50]
      );
    expect(opIds(page(card(0), card(1), card(2)))).toEqual([
      "root",
      "card0",
      "in0",
      "card1",
      "in1",
      "card2",
      "in2",
    ]);
  });
  test("a lone wrapper among different siblings still collapses", () => {
    const other = box("other", 0, 60, 100, 50, { style: painted() });
    expect(opIds(page(wrap(), other))).toEqual(["root", "leaf", "other"]);
  });
  test("a collapsed child answers for the wrapper in its parent", () => {
    const parent = flex({}, [600, 50]);
    const wrapper = item("wrap", 0, 0, 600, 50, { grow: 1 });
    wrapper.children = [
      item(
        "inner",
        0,
        0,
        600,
        50,
        { display: "flex", flexDirection: "row", alignItems: "flex-start" },
        { children: [box("x", 0, 0, 10, 10, { style: painted() })], style: painted() }
      ),
    ];
    parent.children = [wrapper];
    expect(frameOp(parent, "inner")).toMatchObject({
      parent: "parent",
      childLayout: { sizingH: "FILL" },
    });
    expect(opIds(parent)).not.toContain("wrap");
  });
  test("wrapped text from a collapse never FILLs a parent that hugs", () => {
    const parent = flexCol({}, [200, 40]);
    const wrapper = el("wrap", [0, 0], [wrapped(0, 0, 200, 40)], {}, [200, 40]);
    wrapper.layout.display = "block";
    wrapper.semantic = { tag: "p" };
    parent.children = [wrapper];
    parent.layout.display = "inline-flex";
    expect(frameOp(parent, "parent").layout).toMatchObject({ sizingH: "HUG" });
    expect(mapCapture(cap(parent), inter).ops[1]).toMatchObject({
      id: "wrapped",
      childLayout: { sizingH: "FIXED" },
    });
  });
  test("a frame that FILLs is no hugging parent for a grid inside it", () => {
    const inner = grid("1fr 1fr", { gridTemplateColumns: "250px 250px" });
    inner.id = "g";
    inner.children = [box("a", 0, 0, 250, 100), box("b", 250, 0, 250, 100)];
    const mid = item(
      "mid",
      0,
      0,
      500,
      100,
      { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: [0, 0], grow: 1 },
      { children: [inner], style: painted() }
    );
    const outer = flex({}, [500, 100]);
    outer.children = [mid];
    expect(frameOp(outer, "mid").layout).toMatchObject({ sizingH: "FIXED" });
    expect(frameOp(outer, "g").layout).toMatchObject({
      columns: [{ type: "FLEX" }, { type: "FLEX" }],
    });
  });
  test("an absolute wrapper's child is ABSOLUTE after the collapse", () => {
    const parent = row();
    const wrapper = item("wrap", 590, 0, 20, 20, { position: "absolute" });
    wrapper.children = [box("inner", 590, 0, 20, 20, { style: painted() })];
    parent.children = [...kids, wrapper];
    expect(frameOp(parent, "inner").childLayout).toMatchObject({ positioning: "ABSOLUTE" });
  });
});

describe("inline-level children of a block", () => {
  const parent = (size: [number, number] = [600, 40]) => el("p", [0, 0], [], {}, size);
  const painted2 = { style: painted() };

  test.each(["inline", "inline-block", "inline-flex", "inline-grid"])(
    "a lone %s child is judged by its box",
    (display) => {
      const child = item("a", 0, 10, 100, 20, { display }, painted2);
      expect(inferLayout(parent(), [child])).toMatchObject({ mode: "VERTICAL" });
    }
  );
  test("two inline-level children are still NONE", () => {
    const two = [
      item("a", 0, 0, 100, 20, { display: "inline" }),
      item("b", 0, 20, 100, 20, { display: "inline" }),
    ];
    expect(inferLayout(parent(), two)).toEqual({ mode: "NONE" });
  });
  test("a wrapper that collapses is judged by what it collapses into", () => {
    const inner = box("in", 0, 0, 600, 20, painted2);
    const wrapper = el("w", [0, 0], [inner], withLayout({ display: "inline-block" }), [600, 20]);
    expect(inferLayout(parent(), [wrapper, box("b", 0, 20, 600, 20)]).mode).toBe("VERTICAL");
  });
  test("an inline element holding a block counts as a block", () => {
    const inline = item(
      "a",
      0,
      0,
      600,
      20,
      { display: "inline" },
      {
        style: painted(),
        children: [box("in", 0, 0, 600, 10), box("in2", 0, 10, 600, 10)],
      }
    );
    expect(inferLayout(parent(), [inline, box("b", 0, 20, 600, 20)]).mode).toBe("VERTICAL");
  });
  test("a default-inline host with block children stacks them", () => {
    const host = el(
      "host",
      [0, 0],
      [],
      { ...withLayout({ display: "inline" }), semantic: { tag: "x-theme" } },
      [600, 40]
    );
    const blocks = [box("a", 0, 0, 600, 20), box("b", 0, 20, 600, 20)];
    host.children = blocks;
    const layout = inferLayout(host, blocks);
    expect(layout).toMatchObject({ mode: "VERTICAL", sizingH: "FIXED" });
    expect(inferChildLayout(blocks[0] as ElementNode, layout, host).sizingH).toBe("FILL");
  });
  test("an inline parent with only inline content is NONE", () => {
    const span = flex({ display: "inline" }, [100, 20]);
    expect(inferLayout(span, [single("words")])).toEqual({ mode: "NONE" });
  });
});

describe("flex-grow that did not fill", () => {
  test("a grown child stopped by max-width stays FIXED, and the row keeps its alignment", () => {
    const parent = flex();
    const children = [item("a", 0, 0, 200, 50, { grow: 1 })];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ mode: "HORIZONTAL", primaryAlign: "MIN", sizingH: "FIXED" });
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingH).toBe("FIXED");
  });
  test("two equal grown children short of the end stay FIXED", () => {
    const parent = flex();
    const children = [
      item("a", 0, 0, 200, 50, { grow: 1 }),
      item("b", 200, 0, 200, 50, { grow: 1 }),
    ];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingH).toBe("FIXED");
  });
  test("grown children reaching the end past a fixed sibling and a gap FILL", () => {
    const parent = flex({ gap: [0, 10] });
    const children = [
      box("fixed", 0, 0, 80, 50),
      item("a", 90, 0, 250, 50, { grow: 1 }),
      item("b", 350, 0, 250, 50, { grow: 1 }),
    ];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(inferChildLayout(children[2] as ElementNode, layout, parent).sizingH).toBe("FILL");
  });
});

describe("cross-axis checks that used to skip", () => {
  test("a FILL child off the start of the content box is NONE", () => {
    const children = [box("a", 0, 0, 600, 50), item("b", 8, 50, 600, 50, { margin: [0, 8, 0, 8] })];
    expect(inferLayout(el("p", [0, 0], [], {}, [600, 100]), children)).toEqual({ mode: "NONE" });
    expect(inferLayout(flexCol({ alignItems: "normal" }, [600, 100]), children)).toEqual({
      mode: "NONE",
    });
  });
  test("a lone width: 100% with side margins folds them, and does not FILL", () => {
    const parent = el("p", [0, 0], [], {}, [600, 50]);
    const child = item("a", 8, 0, 600, 50, { margin: [0, 8, 0, 8] });
    parent.children = [child];
    const layout = inferLayout(parent, [child]);
    expect(layout).toMatchObject({ mode: "VERTICAL", padding: [0, 8, 0, 8] });
    expect(inferChildLayout(child, layout, parent).sizingH).toBe("FIXED");
  });
  test("a BASELINE row with a conflicting align-self is NONE", () => {
    const self = [box("a", 0, 12, 100, 20), item("b", 110, 0, 100, 40, { alignSelf: "center" })];
    expect(inferLayout(row({ alignItems: "baseline" }, [600, 40]), self)).toEqual({ mode: "NONE" });
  });
  test("align-self: baseline agrees with a BASELINE row", () => {
    const self = [box("a", 0, 12, 100, 20), item("b", 110, 0, 100, 40, { alignSelf: "baseline" })];
    expect(inferLayout(row({ alignItems: "baseline" }, [600, 40]), self)).toMatchObject({
      counterAlign: "BASELINE",
    });
  });
});

describe("stretch rows", () => {
  const filled = (id: string, x: number, h: number, contentH = h) =>
    el(id, [x, 0], [box(`${id}-in`, x, 0, 100, contentH)], {}, [100, h]);

  test("children their content already explains keep the row HUG", () => {
    const parent = row({ alignItems: "normal" }, [210, 40]);
    const children = [filled("a", 0, 40), filled("b", 110, 40)];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ mode: "HORIZONTAL", sizingV: "HUG" });
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingV).toBe("HUG");
  });
  test("a card stretched past its content FILLs, and the row stays FIXED", () => {
    const parent = row({ alignItems: "normal" }, [210, 200]);
    const children = [filled("a", 0, 200), filled("b", 110, 200, 80)];
    parent.children = children;
    const layout = inferLayout(parent, children);
    expect(layout).toMatchObject({ sizingV: "FIXED" });
    expect(inferChildLayout(children[1] as ElementNode, layout, parent).sizingV).toBe("FILL");
    expect(inferChildLayout(children[0] as ElementNode, layout, parent).sizingV).toBe("HUG");
  });
  test("deep nesting of stretch rows stays linear", () => {
    let node = item("n0", 0, 0, 100, 100, {});
    for (let i = 1; i <= 200; i++) {
      node = item(
        `n${i}`,
        0,
        0,
        100,
        100,
        { display: "flex", flexDirection: "row", alignItems: "normal", gap: [0, 0] },
        { children: [node], style: painted() }
      );
    }
    const started = performance.now();
    mapCapture(cap(node), inter);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("leaf nodes in the flow", () => {
  const leaf = {
    box: { x: 0, y: 2, w: 16, h: 16 },
    paintOrder: 1,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    semantic: { tag: "svg" },
  };
  const svg = (over: Record<string, unknown> = {}) =>
    ({ ...leaf, id: "icon", kind: "svg", markup: "<svg/>", ...over }) as CaptureNode;

  test("an icon with a margin beside a label is a row", () => {
    const label = single("Label", 24, 0, 60, 20, { paintOrder: 2 });
    const parent = flex({ alignItems: "center" }, [84, 20]);
    expect(
      inferLayout(parent, [svg({ margin: [0, 8, 0, 0] as Layout["margin"] }), label])
    ).toMatchObject({ mode: "HORIZONTAL", itemSpacing: 8, sizingH: "HUG" });
  });
  test("an absolute image, SVG or placeholder is out of the flow", () => {
    const parent = row();
    const abs = svg({ position: "absolute", box: { x: 10, y: 10, w: 16, h: 16 } });
    const layout = inferLayout(parent, [...kids, abs]);
    expect(layout).toMatchObject({ mode: "HORIZONTAL" });
    expect(inferChildLayout(abs, layout, parent).positioning).toBe("ABSOLUTE");
  });
  test("an auto margin on a leaf pushes it like an element", () => {
    const pushed = svg({
      box: { x: 584, y: 0, w: 16, h: 16 },
      margin: [0, 0, 0, 484],
      marginAuto: [false, false, false, true],
    });
    expect(inferLayout(flex(), [box("a", 0, 0, 100, 50), pushed])).toMatchObject({
      primaryAlign: "SPACE_BETWEEN",
    });
  });
  test("a negative leaf margin is NONE", () => {
    const pulled = svg({ margin: [0, 0, 0, -4], box: { x: 100, y: 0, w: 16, h: 16 } });
    expect(inferLayout(flex(), [box("a", 0, 0, 100, 50), pulled])).toEqual({ mode: "NONE" });
  });
  test("a wrapper does not collapse into an absolute leaf", () => {
    const abs = svg({ position: "absolute", box: { x: 0, y: 0, w: 100, h: 50 } });
    const wrapper = el("w", [0, 0], [abs], {}, [100, 50]);
    expect(collapseTarget(wrapper, new Set()).id).toBe("w");
  });
});

describe("minor rulings", () => {
  test("a grid child in a HUG track keeps its own sizing", () => {
    const parent = grid("1fr auto");
    const cells = [box("a", 0, 0, 300, 100), box("b", 300, 0, 200, 100)];
    const layout = inferLayout(parent, cells);
    expect(inferChildLayout(cells[1] as ElementNode, layout, parent).sizingH).toBe("FIXED");
    expect(inferChildLayout(cells[0] as ElementNode, layout, parent).sizingH).toBe("FILL");
  });
  test("margin: 0 auto in a flex column is CENTER", () => {
    const auto = {
      margin: [0, 100, 0, 100] as Layout["margin"],
      marginAuto: [false, true, false, true] as Layout["marginAuto"],
    };
    const children = [item("a", 100, 0, 400, 50, auto), item("b", 100, 50, 400, 50, auto)];
    expect(inferLayout(flexCol({ alignItems: "normal" }, [600, 100]), children)).toMatchObject({
      mode: "VERTICAL",
      counterAlign: "CENTER",
      padding: [0, 0, 0, 0],
    });
  });
  test("one-sided cross-axis auto margins are NONE", () => {
    const auto = item("a", 500, 0, 100, 50, {
      margin: [0, 0, 0, 500],
      marginAuto: [false, false, false, true],
    });
    expect(inferLayout(flexCol({ alignItems: "normal" }, [600, 50]), [auto])).toEqual({
      mode: "NONE",
    });
  });
  test("a centred child among children that are not centred is NONE", () => {
    const children = [
      box("a", 0, 0, 100, 50),
      item("b", 250, 50, 100, 50, {
        margin: [0, 250, 0, 250],
        marginAuto: [false, true, false, true],
      }),
    ];
    expect(inferLayout(flexCol({ alignItems: "normal" }, [600, 100]), children)).toEqual({
      mode: "NONE",
    });
  });
  test("single-line text hugs in every parent", () => {
    for (const parent of [
      flex({}, [600, 20]),
      flexCol({}, [600, 20]),
      el("p", [0, 0], [], {}, [600, 20]),
    ]) {
      const t = single("one");
      expect(inferChildLayout(t, inferLayout(parent, [t]), parent).sizingH).toBe("HUG");
    }
  });
  test("sibling facts come from the children passed, not an earlier call", () => {
    const parent = flex();
    const fullRow = [item("a", 0, 0, 600, 50, { grow: 1 })];
    const shortRow = [item("a", 0, 0, 200, 50, { grow: 1 })];
    parent.children = fullRow;
    const child = fullRow[0] as ElementNode;
    expect(inferChildLayout(child, inferLayout(parent, fullRow), parent).sizingH).toBe("FILL");
    parent.children = shortRow;
    const short = shortRow[0] as ElementNode;
    expect(inferChildLayout(short, inferLayout(parent, shortRow), parent).sizingH).toBe("FIXED");
  });
});
