import { describe, expect, test } from "bun:test";
import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { extractComponents } from "../components";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { FontRef, LayerPlan, PlanOp, PlanOverride } from "../plan";
import { cap, el, imageStyle, inter, run, textNode } from "./fixtures";

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type InstanceOp = Extract<PlanOp, { op: "instance" }>;
type TextOp = Extract<PlanOp, { op: "text" }>;

const on = { ...DEFAULT_IMPORT_OPTIONS, components: true };
const absolute = { ...on, autoLayout: false };
const off = { ...DEFAULT_IMPORT_OPTIONS, components: false };

const red = { r: 1, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 1, a: 1 };

const label = (id: string, text = "Hello", over: Partial<TextNode["runs"][number]> = {}) =>
  textNode(id, { text, runs: [run({ end: text.length, ...over })] });

/** An element with a tag; children sit in a block, as a custom element's content usually does. */
const tagged = (
  tag: string,
  id: string,
  children: CaptureNode[] = [],
  over: Partial<ElementNode> = {},
  size: [number, number] = [100, 100]
) => el(id, [0, 0], children, { semantic: { tag }, ...over }, size);

/** Layout for a row: a flex container whose children sit side by side. */
const flexRow = (over: Partial<ElementNode["layout"]> = {}): Pick<ElementNode, "layout"> => ({
  layout: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "normal",
    alignItems: "flex-start",
    gap: [0, 0],
    position: "static",
    padding: [0, 0, 0, 0],
    margin: [0, 0, 0, 0],
    order: 0,
    grow: 0,
    shrink: 1,
    ...over,
  },
});

const gridOf = (): Pick<ElementNode, "layout"> => ({
  layout: {
    ...flexRow({ display: "grid", flexDirection: undefined, flexWrap: undefined }).layout,
    gridTemplateColumns: "100px 100px",
    gridTemplateRows: "20px",
    authoredGridTemplateColumns: "100px 100px",
    authoredGridTemplateRows: "20px",
    rowGap: 0,
    columnGap: 0,
  },
});

const turn = (deg: number): ElementNode["transform"] => {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
};

const painted = (node: ElementNode, color: typeof red): ElementNode => ({
  ...node,
  style: { ...node.style, backgroundColor: color },
});

const svg = (id: string, markup: string): CaptureNode => ({
  id,
  kind: "svg",
  box: { x: 0, y: 0, w: 16, h: 16 },
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "svg" },
  markup,
});

const image = (id: string, assetHash: string): CaptureNode => ({
  id,
  kind: "image",
  box: { x: 0, y: 0, w: 50, h: 50 },
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "img" },
  assetHash,
  fit: "cover",
  objectPosition: "50% 50%",
  ...imageStyle,
});

const plan = (children: CaptureNode[], options = on, fonts: FontRef[] = inter): LayerPlan =>
  mapCapture(cap(el("root", [0, 0], children)), fonts, options);

const definitions = (p: LayerPlan) =>
  p.ops.filter((o): o is FrameOp => o.op === "frame" && o.component !== undefined);
const instances = (p: LayerPlan) => p.ops.filter((o): o is InstanceOp => o.op === "instance");
const keys = (p: LayerPlan) => definitions(p).map((d) => d.component?.key);
const componentNames = (p: LayerPlan) => definitions(p).map((d) => d.component?.name);
const pageRoot = (p: LayerPlan) => p.ops.find((o) => o.parent === null && !isDefinition(o));
const isDefinition = (o: PlanOp) => o.op === "frame" && o.component !== undefined;
const instance = (p: LayerPlan, id: string) => instances(p).find((o) => o.id === id);
const descendantsOf = (p: LayerPlan, id: string): PlanOp[] => {
  const kids = p.ops.filter((o) => o.parent === id);
  return [...kids, ...kids.flatMap((k) => descendantsOf(p, k.id))];
};

/** What every plan must hold: unique ids, parents first, and a child count for each frame. */
function expectWellFormed(p: LayerPlan) {
  const seen = new Set<string>();
  for (const op of p.ops) {
    expect(seen.has(op.id)).toBe(false);
    if (op.parent !== null) expect(seen.has(op.parent)).toBe(true);
    seen.add(op.id);
  }
  for (const op of p.ops) {
    if (op.op === "frame") {
      expect(op.childCount).toBe(p.ops.filter((o) => o.parent === op.id).length);
    }
  }
}

/** Every key is defined once, and before anything uses it, which also rules out a cycle. */
function expectInnerFirst(p: LayerPlan) {
  const defined = new Set<string>();
  const roots = new Map(definitions(p).map((d) => [d.id, d.component?.key as string]));
  const ownerOf = (op: PlanOp): string | undefined => {
    let at: PlanOp | undefined = op;
    while (at && !roots.has(at.id)) {
      const parent: string | null = at.parent;
      at = parent === null ? undefined : p.ops.find((o) => o.id === parent);
    }
    return at ? roots.get(at.id) : undefined;
  };
  for (const op of p.ops) {
    if (op.op === "frame" && op.component) {
      expect(defined.has(op.component.key)).toBe(false);
      defined.add(op.component.key);
    }
    if (op.op === "instance") {
      expect(defined.has(op.key)).toBe(true);
      expect(ownerOf(op)).not.toBe(op.key);
    }
  }
}

const links = (n: number, text: (i: number) => string = (i) => `Link ${i}`) =>
  Array.from({ length: n }, (_, i) => tagged("x-link", `l${i}`, [label(`t${i}`, text(i))]));

describe("which elements become components", () => {
  test("one occurrence stays plain frames", () => {
    const p = plan([tagged("x-link", "only", [label("t")])]);
    expect(definitions(p)).toEqual([]);
    expect(instances(p)).toEqual([]);
    expect(p.ops.map((o) => o.id)).toEqual(["root", "only", "t"]);
    expect(p.report).toMatchObject({ components: 0, instances: 0 });
  });

  test("twelve links with different text give one component and twelve instances", () => {
    const p = plan(links(12));
    expectWellFormed(p);
    expect(keys(p)).toEqual(["x-link#1"]);
    expect(instances(p).map((o) => o.id)).toEqual(Array.from({ length: 12 }, (_, i) => `l${i}`));
    expect(new Set(instances(p).map((o) => o.key))).toEqual(new Set(["x-link#1"]));
    expect(p.report).toMatchObject({ components: 1, instances: 12 });
    expect(p.ops.filter((o) => o.op === "text")).toHaveLength(1);
  });

  test("names follow the tag, and tag / 1, tag / 2 for two signatures", () => {
    const one = plan(links(2));
    expect(componentNames(one)).toEqual(["x-link"]);
    expect(definitions(one)[0]?.name).toBe("x-link");

    const two = plan([
      ...links(2),
      ...[0, 1].map((i) =>
        tagged("x-link", `b${i}`, [label(`u${i}`, "Same", { size: 40 }), label(`v${i}`)])
      ),
    ]);
    expect(componentNames(two)).toEqual(["x-link / 1", "x-link / 2"]);
    expect(keys(two)).toEqual(["x-link#1", "x-link#2"]);
  });

  test("elements without a hyphen in the tag are never components", () => {
    const p = plan(
      Array.from({ length: 5 }, (_, i) => tagged("section", `s${i}`, [label(`t${i}`)]))
    );
    expect(definitions(p)).toEqual([]);
    expect(instances(p)).toEqual([]);
  });

  test("the page root is never hoisted, even as a custom element", () => {
    const capture = cap(tagged("x-app", "root", [tagged("x-app", "inner")]));
    const p = mapCapture(capture, inter, on);
    expect(p.ops[0]?.id).toBe("root");
    expect(definitions(p)).toEqual([]);
  });

  test("an occurrence with rotation on its root stays plain frames", () => {
    const p = plan([
      ...links(2),
      tagged("x-link", "turned", [label("tt")], { transform: turn(10) }),
    ]);
    expect(instances(p).map((o) => o.id)).toEqual(["l0", "l1"]);
    expect(p.ops.find((o) => o.id === "turned")?.op).toBe("frame");
    expect(p.ops.find((o) => o.id === "tt")?.parent).toBe("turned");
  });

  test("an occurrence with rotation deep in its subtree stays plain frames", () => {
    const turned = (id: string) =>
      tagged("x-card", id, [
        painted(
          tagged("div", `${id}a`, [tagged("div", `${id}b`, [], { transform: turn(10) })]),
          red
        ),
      ]);
    const p = plan([turned("c0"), turned("c1")]);
    expect(definitions(p)).toEqual([]);
    expect(instances(p)).toEqual([]);
  });

  test("two rotated occurrences do not make the third a component", () => {
    const p = plan([
      tagged("x-link", "a", [label("ta")]),
      tagged("x-link", "b", [label("tb")], { transform: turn(10) }),
      tagged("x-link", "c", [label("tc")], { transform: turn(10) }),
    ]);
    expect(definitions(p)).toEqual([]);
  });
});

describe("the signature", () => {
  test("a primary and a secondary button stay separate", () => {
    const button = (id: string, color: typeof red) =>
      painted(tagged("x-button", id, [label(`${id}t`)]), color);
    const p = plan([button("p0", red), button("p1", red), button("s0", blue), button("s1", blue)]);
    expectWellFormed(p);
    expect(keys(p)).toEqual(["x-button#1", "x-button#2"]);
    expect(instance(p, "p1")?.key).toBe("x-button#1");
    expect(instance(p, "s1")?.key).toBe("x-button#2");
    const fills = definitions(p).map((d) => d.fills);
    expect(fills[0]).not.toEqual(fills[1]);
  });

  test("paint on a descendant counts as well", () => {
    const button = (id: string, color: typeof red) =>
      tagged("x-button", id, [painted(tagged("div", `${id}i`, [], {}, [10, 10]), color)]);
    const p = plan([button("a", red), button("b", blue)]);
    expect(definitions(p)).toEqual([]);
  });

  test("different text style means a different signature", () => {
    const p = plan(
      ["size", "colour"].flatMap((_, n) =>
        [0, 1].map((i) =>
          tagged("x-tag", `e${n}${i}`, [
            label(`t${n}${i}`, "Same", n === 0 ? { size: 12 } : { size: 12, color: red }),
          ])
        )
      )
    );
    expect(keys(p)).toEqual(["x-tag#1", "x-tag#2"]);
  });

  test("alignment and wrapping count", () => {
    const line = { x: 0, y: 0, w: 100, h: 20 };
    const p = plan([
      tagged("x-a", "a", [textNode("ta", { lines: [line] })]),
      tagged("x-a", "b", [textNode("tb", { lines: [line, line] })]),
      tagged("x-a", "c", [textNode("tc", { runs: [run({ align: "center" })], lines: [line] })]),
    ]);
    expect(definitions(p)).toEqual([]);
  });

  test("the width of text that does not wrap does not count", () => {
    const short = textNode("ta", { box: { x: 0, y: 0, w: 30, h: 20 } });
    const long = textNode("tb", { box: { x: 0, y: 0, w: 90, h: 20 } });
    const p = plan([tagged("x-a", "a", [short]), tagged("x-a", "b", [long])]);
    expect(keys(p)).toEqual(["x-a#1"]);
  });

  test("the name of a layer does not count", () => {
    const p = plan([
      tagged("x-a", "a", [tagged("div", "ai", [], { semantic: { tag: "div", ariaLabel: "One" } })]),
      tagged("x-a", "b", [tagged("div", "bi", [], { semantic: { tag: "div", ariaLabel: "Two" } })]),
    ]);
    expect(keys(p)).toEqual(["x-a#1"]);
  });

  test("radius, effects, clipping, opacity and svg markup all count", () => {
    const base = tagged("div", "x");
    const looks: Partial<ElementNode>[] = [
      { style: { ...base.style, borderRadius: [4, 4, 4, 4] } },
      { style: { ...base.style, filters: ["blur(3px)"] } },
      { style: { ...base.style, overflow: "hidden" } },
      { opacity: 0.5 },
    ];
    for (const look of looks) {
      const p = plan([
        tagged("x-a", "a", [tagged("div", "ai", [], look)]),
        tagged("x-a", "b", [tagged("div", "bi")]),
      ]);
      expect(definitions(p)).toEqual([]);
    }
    const p = plan([
      tagged("x-a", "a", [svg("s1", "<svg>1</svg>")]),
      tagged("x-a", "b", [svg("s2", "<svg>2</svg>")]),
    ]);
    expect(definitions(p)).toEqual([]);
  });

  test("a new op field compares without anyone listing it", () => {
    const frame = (id: string, parent: string | null, extra: object = {}): PlanOp =>
      ({
        op: "frame",
        id,
        parent,
        name: id,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        fills: [],
        strokes: null,
        radius: [0, 0, 0, 0],
        opacity: 1,
        effects: [],
        clips: false,
        layout: { mode: "NONE" },
        childCount: 0,
        ...extra,
      }) as PlanOp;
    const out = extractComponents(
      [
        frame("root", null, { childCount: 2 }),
        frame("a", "root", { future: 1 }),
        frame("b", "root"),
      ],
      new Map([
        ["a", "x-a"],
        ["b", "x-a"],
      ])
    );
    expect(out.components).toBe(0);
  });

  test("a root that hugs does not compare its size", () => {
    const row = (id: string, w: number) =>
      tagged("x-chip", id, [label(`${id}t`)], flexRow(), [w, 20]);
    const a = row("a", 60);
    const b = row("b", 90);
    (a.children[0] as TextNode).box.w = 60;
    (b.children[0] as TextNode).box.w = 90;
    const p = plan([a, b]);
    const root = definitions(p)[0];
    expect(root?.layout).toMatchObject({ sizingH: "HUG" });
    expect(instance(p, "b")).toMatchObject({ w: 90, resize: false });
  });
});

describe("placement inside a component", () => {
  const dot = (id: string, at: [number, number], over: Partial<ElementNode> = {}) =>
    painted(el(id, at, [], over, [20, 20]), red);
  const box = (id: string, children: CaptureNode[], size: [number, number] = [100, 100]) =>
    tagged("x-box", id, children, {}, size);

  test("an inner dot at x=0 and at x=80 stay separate", () => {
    const same = plan([box("a", [dot("ad", [0, 0])]), box("b", [dot("bd", [0, 0])])], absolute);
    expect(keys(same)).toEqual(["x-box#1"]);
    const moved = plan([box("a", [dot("ad", [0, 0])]), box("b", [dot("bd", [80, 0])])], absolute);
    expect(definitions(moved)).toEqual([]);
  });

  test("a root with no auto layout and a child pinned right stays separate at 100 and 300 wide", () => {
    const p = plan(
      [box("a", [dot("ad", [80, 0])], [100, 100]), box("b", [dot("bd", [280, 0])], [300, 100])],
      absolute
    );
    expect(definitions(p)).toEqual([]);
  });

  test("a root with no auto layout compares its size once it has children", () => {
    const p = plan(
      [box("a", [dot("ad", [0, 0])], [100, 100]), box("b", [dot("bd", [0, 0])], [300, 100])],
      absolute
    );
    expect(definitions(p)).toEqual([]);
  });

  test("an ABSOLUTE badge at x=0 and at x=90 in a flex row stay separate", () => {
    const pinned = { ...tagged("div", "x").layout, position: "absolute" };
    const row = (id: string, x: number) =>
      tagged(
        "x-row",
        id,
        [
          tagged(
            "div",
            `${id}f`,
            [],
            { ...flexRow(), style: painted(tagged("div", "y"), blue).style },
            [50, 20]
          ),
          dot(`${id}b`, [x, 0], { layout: pinned }),
        ],
        flexRow(),
        [200, 20]
      );
    const same = plan([row("a", 90), row("b", 90)]);
    const badge = same.ops.find(
      (o) => o.op === "frame" && o.childLayout?.positioning === "ABSOLUTE"
    );
    expect(badge).toBeDefined();
    expect(keys(same)).toEqual(["x-row#1"]);
    expect(definitions(plan([row("a", 0), row("b", 90)]))).toEqual([]);
  });

  test("grid items in swapped cells stay separate", () => {
    const item = (id: string, x: number) => dot(id, [x, 0]);
    const grid = (id: string, first: number, second: number) =>
      tagged("x-grid", id, [item(`${id}1`, first), item(`${id}2`, second)], gridOf(), [200, 20]);
    const same = plan([grid("a", 0, 100), grid("b", 0, 100)]);
    expect(same.ops.some((o) => o.childLayout?.cell?.column === 1)).toBe(true);
    expect(keys(same)).toEqual(["x-grid#1"]);
    expect(definitions(plan([grid("a", 0, 100), grid("b", 100, 0)]))).toEqual([]);
  });

  test("a label keeps its aligned edge, so labels of different widths merge", () => {
    const line = (id: string, x: number, w: number, align: string) =>
      textNode(id, {
        box: { x, y: 0, w, h: 20 },
        lines: [{ x, y: 0, w, h: 20 }],
        runs: [run({ align })],
      });
    const pair = (a: CaptureNode, b: CaptureNode) => plan([box("a", [a]), box("b", [b])], absolute);
    const merged = (a: CaptureNode, b: CaptureNode) => pair(a, b).report.components === 1;
    expect(merged(line("l", 0, 30, "left"), line("m", 0, 60, "left"))).toBe(true);
    expect(merged(line("l", 70, 30, "right"), line("m", 40, 60, "right"))).toBe(true);
    expect(merged(line("l", 35, 30, "center"), line("m", 20, 60, "center"))).toBe(true);
    expect(merged(line("l", 0, 30, "left"), line("m", 10, 60, "left"))).toBe(false);
    expect(merged(line("l", 70, 30, "right"), line("m", 30, 60, "right"))).toBe(false);
    expect(merged(line("l", 35, 30, "center"), line("m", 30, 60, "center"))).toBe(false);
  });

  test("the occurrence root's own placement does not count", () => {
    const q = plan(
      [
        el("a", [1, 2], [], { semantic: { tag: "x-a" } }),
        el("b", [30, 40], [], { semantic: { tag: "x-a" } }),
      ],
      absolute
    );
    expect(keys(q)).toEqual(["x-a#1"]);
  });

  test("rounding noise in a position does not split a component", () => {
    const p = plan(
      [box("a", [dot("ad", [20, 0])]), box("b", [dot("bd", [20.000000001, 0])])],
      absolute
    );
    expect(keys(p)).toEqual(["x-box#1"]);
  });
});

describe("hug sizes", () => {
  /** A link around a painted button, each as wide as its label. */
  const link = (id: string, text: string, w: number) => {
    const words = textNode(`${id}t`, {
      text,
      box: { x: 0, y: 0, w, h: 20 },
      runs: [run({ end: text.length })],
    });
    const shrink = flexRow({ display: "inline-flex" });
    const button = painted(tagged("button", `${id}b`, [words], shrink, [w, 20]), red);
    return tagged("x-link", id, [button], shrink, [w, 20]);
  };

  test("two links with painted inner buttons and different labels are one component", () => {
    const p = plan([link("a", "Short", 40), link("b", "Rather longer", 110)]);
    expectWellFormed(p);
    expect(keys(p)).toEqual(["x-link#1"]);
    const inner = p.ops.find(
      (o): o is FrameOp => o.op === "frame" && o.parent === definitions(p)[0]?.id
    );
    expect(inner?.layout).toMatchObject({ sizingH: "HUG" });
    expect(instance(p, "b")).toMatchObject({ w: 110, resize: false });
    expect(instance(p, "b")?.overrides).toMatchObject([
      { path: [0, 0], kind: "text", text: "Rather longer" },
    ]);
  });

  test("an inner frame that is not hugging still compares its size", () => {
    const fixed = (id: string, w: number) =>
      tagged("x-a", id, [painted(tagged("div", `${id}i`, [], {}, [w, 20]), red)]);
    const p = plan([fixed("a", 40), fixed("b", 110)]);
    expect(definitions(p)).toEqual([]);
  });
});

describe("overrides", () => {
  test("the first occurrence and equal text have none", () => {
    const p = plan(links(3, () => "Same"));
    for (const i of instances(p)) expect(i.overrides).toEqual([]);
  });

  test("different text overrides by path, with its runs", () => {
    const p = plan(links(2, (i) => (i === 0 ? "Short" : "Rather longer")));
    expect(instance(p, "l0")?.overrides).toEqual([]);
    const [override, ...rest] = instance(p, "l1")?.overrides ?? [];
    expect(rest).toEqual([]);
    expect(override).toMatchObject({ path: [0], kind: "text", text: "Rather longer" });
    expect(override).toMatchObject({ runs: [{ start: 0, end: 13 }] });
  });

  test("only the paths that differ are listed", () => {
    const card = (id: string, second: string) =>
      tagged("x-card", id, [label(`${id}a`, "Same"), label(`${id}b`, second)]);
    const p = plan([card("a", "One"), card("b", "Two")]);
    expect(instance(p, "b")?.overrides.map((o) => o.path)).toEqual([[1]]);
  });

  test("different images are an override, not a new signature", () => {
    const pic = (id: string, hash: string) => tagged("x-pic", id, [image(`${id}i`, hash)]);
    const p = plan([pic("a", "h1"), pic("b", "h2")]);
    expect(keys(p)).toEqual(["x-pic#1"]);
    expect(instance(p, "b")?.overrides).toEqual([{ path: [0], kind: "image", hash: "h2" }]);
    expect(p.assetHashes.sort()).toEqual(["h1", "h2"]);
  });

  test("a link with text in a different href overrides runs", () => {
    const link = (id: string, href: string) =>
      tagged("x-link", id, [label(`${id}t`, "Same", { href })]);
    const p = plan([link("a", "https://example.com/a"), link("b", "https://example.com/b")]);
    expect(keys(p)).toEqual(["x-link#1"]);
    const [override] = instance(p, "b")?.overrides ?? [];
    expect(override).toMatchObject({ path: [0], kind: "text", text: "Same" });
    expect(override).toMatchObject({ runs: [{ href: "https://example.com/b" }] });
  });

  test("runs split only by a link are one look", () => {
    const whole = tagged("x-a", "a", [label("ta", "HelloWorld")]);
    const split = tagged("x-a", "b", [
      textNode("tb", {
        text: "HelloWorld",
        runs: [run({ end: 5, href: "https://example.com/" }), run({ start: 5, end: 10 })],
      }),
    ]);
    const p = plan([whole, split]);
    expect(keys(p)).toEqual(["x-a#1"]);
    expect(instance(p, "b")?.overrides[0]).toMatchObject({ runs: [{ end: 5 }, { start: 5 }] });
  });

  test("a definition keeps its first occurrence's token keys, and an override keeps its own", () => {
    const styled = { size: 22 };
    const p = plan(
      links(4, (i) => `Text ${i}`).map((l) => {
        const t = l.children[0] as TextNode;
        return { ...l, children: [{ ...t, runs: [run({ ...styled, end: t.text.length })] }] };
      })
    );
    expect(p.tokens.textStyles).toHaveLength(1);
    const key = p.tokens.textStyles[0]?.key;
    const main = p.ops.find((o): o is TextOp => o.op === "text");
    expect(main?.runs[0]?.styleKey).toBe(key as string);
    const [override] = instance(p, "l3")?.overrides ?? [];
    expect(override).toMatchObject({ runs: [{ styleKey: key }] });
  });
});

describe("resize", () => {
  test("a root with no auto layout is fixed, so a different size says so", () => {
    const p = plan(
      [
        tagged("x-a", "a", [], {}, [100, 40]),
        tagged("x-a", "b", [], {}, [100, 40]),
        tagged("x-a", "c", [], {}, [200, 40]),
      ],
      absolute
    );
    expect(keys(p)).toEqual(["x-a#1"]);
    expect(instance(p, "a")?.resize).toBe(false);
    expect(instance(p, "b")?.resize).toBe(false);
    expect(instance(p, "c")).toMatchObject({ resize: true, w: 200, h: 40 });
  });
});

describe("nesting", () => {
  const icon = (id: string, markup = "<svg/>") => tagged("x-icon", id, [svg(`${id}s`, markup)]);
  const row = (id: string, ...children: CaptureNode[]) => tagged("x-row", id, children);

  test("a nested repeated element comes out inner-first", () => {
    const p = plan([row("a", icon("ai")), row("b", icon("bi"))]);
    expectWellFormed(p);
    expectInnerFirst(p);
    expect(keys(p)).toEqual(["x-icon#1", "x-row#1"]);
    const outer = definitions(p)[1] as FrameOp;
    const held = p.ops.filter((o) => o.parent === outer.id);
    expect(held).toMatchObject([{ op: "instance", key: "x-icon#1" }]);
    expect(p.report).toMatchObject({ components: 2 });
    expect(
      instances(p)
        .filter((o) => o.key === "x-row#1")
        .map((o) => o.id)
    ).toEqual(["a", "b"]);
  });

  test("overrides reach through a nested instance", () => {
    const inner = (id: string, text: string) => tagged("x-label", id, [label(`${id}t`, text)]);
    const outer = (id: string, text: string) =>
      tagged("x-card", id, [
        label(`${id}h`, "Head"),
        painted(tagged("div", `${id}d`, [inner(`${id}l`, text)]), red),
      ]);
    const p = plan([outer("a", "One"), outer("b", "Two")]);
    expectInnerFirst(p);
    expect(instance(p, "a")?.overrides).toEqual([]);
    expect(instance(p, "b")?.overrides).toMatchObject([
      { path: [1, 0, 0], kind: "text", text: "Two" },
    ]);
  });

  test("a definition's nested instance carries overrides from its first occurrence", () => {
    const inner = (id: string, text: string) => tagged("x-label", id, [label(`${id}t`, text)]);
    const p = plan([
      painted(tagged("div", "plain", [inner("first", "Base")]), red),
      tagged("x-card", "a", [inner("al", "One")]),
      tagged("x-card", "b", [inner("bl", "One")]),
    ]);
    const outer = definitions(p).find((d) => d.component?.key === "x-card#1") as FrameOp;
    const nested = p.ops.find((o) => o.parent === outer.id) as InstanceOp;
    expect(nested.overrides).toMatchObject([{ path: [0], kind: "text", text: "One" }]);
    // Both occurrences say "One", so nothing differs from the first.
    expect(instance(p, "b")?.overrides).toEqual([]);
  });

  test("an element repeated inside itself gives no cycle", () => {
    const box = (id: string, ...children: CaptureNode[]) => tagged("x-box", id, children);
    const p = plan([box("o1", box("o1i", label("t1"))), box("o2", box("o2i", label("t2")))]);
    expectWellFormed(p);
    expectInnerFirst(p);
    expect(keys(p)).toEqual(["x-box#1", "x-box#2"]);
  });

  test("a nesting that a tag-only child would hide still gives no cycle", () => {
    const box = (id: string, ...children: CaptureNode[]) => tagged("x-box", id, children);
    // With children read as a bare tag, the outermost looks the same as the one inside it.
    const p = plan([box("a", box("b", box("c", label("t1")))), box("d", box("e", label("t2")))]);
    expectWellFormed(p);
    expectInnerFirst(p);
    expect(p.ops.find((o) => o.id === "a")?.op).toBe("frame");
    expect(instance(p, "b")?.key).toBe(instance(p, "d")?.key as string);
    expect(instance(p, "c")).toBeUndefined();
  });

  test("two links that differ only by icon are one component with a swap", () => {
    const link = (id: string, markup: string) => tagged("x-link", id, [icon(`${id}i`, markup)]);
    const p = plan([
      link("a", "<svg>1</svg>"),
      link("b", "<svg>2</svg>"),
      icon("spare1", "<svg>1</svg>"),
      icon("spare2", "<svg>2</svg>"),
    ]);
    expectWellFormed(p);
    expectInnerFirst(p);
    expect(keys(p)).toEqual(["x-icon#1", "x-icon#2", "x-link#1"]);
    expect(instance(p, "a")?.overrides).toEqual([]);
    expect(instance(p, "b")?.overrides).toEqual([
      { path: [0], kind: "swap", key: "x-icon#2" },
    ] satisfies PlanOverride[]);
  });

  test("links whose nested icons differ in height stay separate components", () => {
    const flat = (id: string) => tagged("x-link", id, [icon(`${id}i`)]);
    const tall = (id: string) =>
      tagged("x-link", id, [
        tagged("x-icon", `${id}i`, [
          painted(tagged("div", `${id}d`, [svg(`${id}s`, "<svg/>")]), red),
        ]),
      ]);
    const p = plan([flat("a"), flat("b"), tall("c"), tall("d")]);
    expectInnerFirst(p);
    expect(instance(p, "a")?.key).toBe(instance(p, "b")?.key as string);
    expect(instance(p, "c")?.key).toBe(instance(p, "d")?.key as string);
    expect(instance(p, "a")?.key).not.toBe(instance(p, "c")?.key as string);
  });

  test("two links whose icons appear once each stay plain frames", () => {
    const link = (id: string, markup: string) => tagged("x-link", id, [icon(`${id}i`, markup)]);
    const p = plan([link("a", "<svg>1</svg>"), link("b", "<svg>2</svg>")]);
    expect(definitions(p)).toEqual([]);
  });

  test("everything below a swap is written out, as a swap may not keep what was set", () => {
    const badge = (id: string, text: string, color: typeof red) =>
      painted(tagged("x-badge", id, [label(`${id}t`, text)]), color);
    const card = (id: string, inner: CaptureNode) => tagged("x-card", id, [inner]);
    const p = plan([
      card("a", badge("ab", "One", red)),
      card("b", badge("bb", "Blue", blue)),
      painted(tagged("div", "w1", [badge("s1", "Red", red)]), blue),
      painted(tagged("div", "w2", [badge("s2", "Blue", blue)]), blue),
    ]);
    expectInnerFirst(p);
    // "Blue" is what the swapped-to definition already says, and it is still listed.
    expect(instance(p, "b")?.overrides).toMatchObject([
      { path: [0], kind: "swap", key: instance(p, "s2")?.key as string },
      { path: [0, 0], kind: "text", text: "Blue" },
    ]);
    expect(instance(p, "s2")?.overrides).toEqual([]);
  });

  test("images below a swap are written out too", () => {
    const pic = (id: string, color: typeof red) =>
      painted(tagged("x-pic", id, [image(`${id}i`, "same")]), color);
    const card = (id: string, inner: CaptureNode) => tagged("x-card", id, [inner]);
    const p = plan([
      card("a", pic("ap", red)),
      card("b", pic("bp", blue)),
      painted(tagged("div", "w1", [pic("s1", red)]), blue),
      painted(tagged("div", "w2", [pic("s2", blue)]), blue),
    ]);
    expect(instance(p, "b")?.overrides).toMatchObject([
      { path: [0], kind: "swap" },
      { path: [0, 0], kind: "image", hash: "same" },
    ]);
  });

  test("rows holding a dot with no auto layout at 16 and 24 px stay separate", () => {
    const dot = (id: string, size: number) => tagged("x-dot", id, [], {}, [size, size]);
    const row = (id: string, size: number) => tagged("x-row", id, [dot(`${id}d`, size)]);
    const p = plan([row("a", 16), row("b", 16), row("c", 24), row("d", 24)], absolute);
    expect(instance(p, "a")?.key).toBe(instance(p, "b")?.key as string);
    expect(instance(p, "c")?.key).toBe(instance(p, "d")?.key as string);
    expect(instance(p, "a")?.key).not.toBe(instance(p, "c")?.key as string);
  });

  test("report.instances counts each instance on the canvas, those in a definition per copy", () => {
    const p = plan([row("a", icon("ai")), row("b", icon("bi"))]);
    // Two rows on the page, an icon in each, and the icon inside the row's main.
    expect(instances(p)).toHaveLength(3);
    expect(p.report.instances).toBe(5);
  });

  test("report.instances multiplies through every level of nesting", () => {
    const three = (id: string) =>
      tagged("x-three", id, [tagged("x-two", `${id}t`, [icon(`${id}i`)])]);
    const p = plan([three("a"), three("b")]);
    // Threes: 2. Twos: one in each three and in its main, 3. Icons: one in each two and in its main, 4.
    expect(p.report).toMatchObject({ components: 3, instances: 9 });
  });

  test("a rotated occurrence stays plain, and the repeats inside it can still be instances", () => {
    const p = plan([tagged("x-row", "turned", [icon("i1"), icon("i2")], { transform: turn(5) })]);
    expect(p.ops.find((o) => o.id === "turned")?.op).toBe("frame");
    expect(instance(p, "i1")?.parent).toBe("turned");
  });
});

describe("the plan around them", () => {
  test("definitions come before the root in ops, and the root is the first non-component frame", () => {
    const p = plan(links(2));
    expectWellFormed(p);
    expect(p.ops[0]).toMatchObject({ op: "frame", parent: null, component: { key: "x-link#1" } });
    expect(pageRoot(p)?.id).toBe("root");
    const rootAt = p.ops.findIndex((o) => o.id === "root");
    for (const def of definitions(p)) expect(p.ops.indexOf(def)).toBeLessThan(rootAt);
    expect(p.ops.filter((o) => o.parent === null).length).toBe(2);
    expect(pageRoot(p)).toMatchObject({ childCount: 2 });
  });

  test("childLayout stays on the instance, not the definition", () => {
    const p = mapCapture(
      cap(
        el(
          "root",
          [0, 0],
          [
            el("a", [0, 0], [], { semantic: { tag: "x-a" } }, [50, 50]),
            el("b", [60, 0], [], { semantic: { tag: "x-a" } }, [50, 50]),
            el("c", [120, 0], [], {}, [50, 50]),
          ],
          flexRow({ gap: [0, 10] }),
          [170, 50]
        )
      ),
      inter,
      on
    );
    expect(pageRoot(p)).toMatchObject({ layout: { mode: "HORIZONTAL" } });
    expect(instance(p, "b")?.childLayout).toBeDefined();
    expect(definitions(p)[0]?.childLayout).toBeUndefined();
  });

  test("an instance keeps the occurrence's own name and position", () => {
    const named = (id: string, aria: string, at: [number, number]) =>
      el(id, at, [], { semantic: { tag: "x-a", ariaLabel: aria } });
    const p = plan([named("a", "First", [5, 6]), named("b", "Second", [7, 8])]);
    expect(instance(p, "b")).toMatchObject({ name: "Second", x: 7, y: 8, parent: "root" });
    expect(instance(p, "a")).toMatchObject({ name: "First", x: 5, y: 6 });
  });

  test("a definition's layers keep their names", () => {
    const p = plan([
      tagged("x-a", "a", [
        tagged("div", "ai", [], { semantic: { tag: "div", ariaLabel: "Inner" } }),
      ]),
      tagged("x-a", "b", [
        tagged("div", "bi", [], { semantic: { tag: "div", ariaLabel: "Other" } }),
      ]),
    ]);
    expect(descendantsOf(p, definitions(p)[0]?.id as string).map((o) => o.name)).toEqual(["Inner"]);
  });

  test("options.components false changes nothing", () => {
    const children = [...links(3), tagged("x-row", "r", links(1))];
    const without = plan(children, off);
    expect(without.ops.every((o) => o.op !== "instance")).toBe(true);
    expect(definitions(without)).toEqual([]);
    expect(without.ops.map((o) => o.id).slice(0, 3)).toEqual(["root", "l0", "t0"]);
    expect(without.report).toMatchObject({ components: 0, instances: 0 });
  });

  test("a font override still applies inside a definition", () => {
    const capture = cap(
      el(
        "root",
        [0, 0],
        [
          tagged("x-a", "a", [label("ta", "Hello", { family: "Nimbus Sans" })]),
          tagged("x-a", "b", [label("tb", "World", { family: "Nimbus Sans" })]),
        ]
      )
    );
    const fonts = [...inter, { family: "Roboto", style: "Regular" }];
    const p = mapCapture(capture, fonts, on, { "Nimbus Sans": "Roboto" });
    const main = p.ops.find((o): o is TextOp => o.op === "text");
    expect(main?.runs[0]?.fontName.family).toBe("Roboto");
    expect(instance(p, "b")?.overrides[0]).toMatchObject({
      runs: [{ fontName: { family: "Roboto" } }],
    });
  });

  test("extractComponents leaves a plan with nothing repeated as it was", () => {
    const p = plan([tagged("x-a", "a")], off);
    const out = extractComponents(p.ops, new Map([["a", "x-a"]]));
    expect(out).toEqual({ ops: p.ops, components: 0, instances: 0 });
  });
});

describe("options", () => {
  test("components are on by default", () => {
    expect(DEFAULT_IMPORT_OPTIONS.components).toBe(true);
    const p = mapCapture(cap(el("root", [0, 0], links(2))), inter);
    expect(instances(p)).toHaveLength(2);
  });

  test("hover components start off", () => {
    expect(DEFAULT_IMPORT_OPTIONS.hoverComponents).toBe(false);
  });
});

describe("hover patches", () => {
  const hovering = <T extends ElementNode>(
    node: T,
    hover: NonNullable<ElementNode["hover"]>
  ): T => ({
    ...node,
    hover,
  });
  const hoverOn = { ...on, hoverComponents: true };
  const hoverOf = (p: LayerPlan) => definitions(p)[0]?.component?.hover;
  const button = (id: string, hover?: ElementNode["hover"], over: Partial<ElementNode> = {}) => {
    const node = tagged("x-btn", id, [label(`t${id}`, "Buy")], over);
    return hover ? hovering(painted(node, red), hover) : painted(node, red);
  };

  test("hoverComponents off emits no patch", () => {
    const p = plan([button("a", { backgroundColor: blue }), button("b")], on);
    expect(definitions(p)).toHaveLength(1);
    expect(hoverOf(p)).toBeUndefined();
  });

  test("a background hover patches the root fills", () => {
    const p = plan([button("a", { backgroundColor: blue }), button("b")], hoverOn);
    expect(hoverOf(p)).toEqual([
      { path: [], fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 }, opacity: 1 }] },
    ]);
  });

  test("a hover that clears the background drops the solid fill and keeps the rest", () => {
    const p = plan(
      [button("a", { backgroundColor: { r: 0, g: 0, b: 0, a: 0 } }), button("b")],
      hoverOn
    );
    expect(hoverOf(p)).toEqual([{ path: [], fills: [] }]);
  });

  test("a color hover reaches text under that element", () => {
    const p = plan([button("a", { color: blue }), button("b")], hoverOn);
    expect(hoverOf(p)).toEqual([{ path: [0], textColor: blue }]);
  });

  test("a deeper element's own colour hover wins", () => {
    const inner = hovering(tagged("span", "in", [label("tin", "Deep")]), { color: red });
    const outer = hovering(painted(tagged("x-btn", "a", [label("t1", "Top"), inner]), red), {
      color: blue,
    });
    const twin = painted(
      tagged("x-btn", "b", [label("t2", "Top"), tagged("span", "in2", [label("t3", "Deep")])]),
      red
    );
    const p = plan([outer, twin], hoverOn);
    expect(hoverOf(p)).toEqual([
      { path: [0], textColor: blue },
      { path: [1, 0], textColor: red },
    ]);
  });

  test("a hover equal to the resting look emits nothing", () => {
    const p = plan(
      [
        button("a", {
          backgroundColor: red,
          color: { r: 0, g: 0, b: 0, a: 1 },
          decoration: "none",
          opacity: 1,
        }),
        button("b"),
      ],
      hoverOn
    );
    expect(definitions(p)).toHaveLength(1);
    expect(hoverOf(p)).toBeUndefined();
  });

  test("an underline hover reaches text, and none on text already at none does not", () => {
    const under = plan(
      [button("a", { decoration: "underline solid rgb(0, 0, 0)" }), button("b")],
      hoverOn
    );
    expect(hoverOf(under)).toEqual([{ path: [0], decoration: "UNDERLINE" }]);
    const none = plan([button("a", { decoration: "none" }), button("b")], hoverOn);
    expect(hoverOf(none)).toBeUndefined();
  });

  test("border, opacity and shadow hovers become patches only where they differ", () => {
    const edge = { width: 1, color: red, style: "solid" };
    const bordered = (id: string, hover?: ElementNode["hover"]) => {
      const node = button(id, hover, {});
      return {
        ...node,
        style: { ...node.style, borders: { top: edge, right: edge, bottom: edge, left: edge } },
      };
    };
    const shadow = {
      inset: false,
      x: 0,
      y: 2,
      blur: 4,
      spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
    };
    const p = plan(
      [bordered("a", { borderColor: blue, opacity: 0.5, boxShadows: [shadow] }), bordered("b")],
      hoverOn
    );
    expect(hoverOf(p)).toEqual([
      {
        path: [],
        strokeColor: blue,
        opacity: 0.5,
        effects: [
          {
            type: "DROP_SHADOW",
            color: { r: 0, g: 0, b: 0, a: 0.5 },
            offset: { x: 0, y: 2 },
            radius: 4,
            spread: 0,
          },
        ],
      },
    ]);
  });

  test("hover comes from the first occurrence only", () => {
    const p = plan([button("a"), button("b", { backgroundColor: blue })], hoverOn);
    expect(hoverOf(p)).toBeUndefined();
  });

  test("a hover on an element that is not repeated adds no patch", () => {
    const p = plan(
      [button("a"), button("b"), hovering(el("solo", [0, 0], []), { backgroundColor: blue })],
      hoverOn
    );
    expect(hoverOf(p)).toBeUndefined();
  });

  test("a hover inside a nested instance is reached through it", () => {
    const icon = (id: string, hover?: ElementNode["hover"]) => {
      const node = painted(tagged("x-icon", id, [label(`i${id}`, "i")]), blue);
      return hover ? hovering(node, hover) : node;
    };
    const card = (id: string, ic: ElementNode) => painted(tagged("x-card", id, [ic]), red);
    const p = plan(
      [card("c1", icon("i1", { color: red })), card("c2", icon("i2")), icon("i3")],
      hoverOn
    );
    const card1 = definitions(p).find((d) => d.component?.name.startsWith("x-card"));
    expect(card1?.component?.hover).toEqual([{ path: [0, 0], textColor: red }]);
  });
});
