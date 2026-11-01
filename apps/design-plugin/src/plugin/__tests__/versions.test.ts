import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type PlanModeColor,
  type PlanOp,
  type PlanVersionTokens,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { type FakeNode, fakeFigma } from "./fake-figma";

type Fake = ReturnType<typeof fakeFigma>;
type Applier = ReturnType<typeof createApplier>;

const inter: FontRef = { family: "Inter", style: "Regular" };
const BLACK = { r: 0, g: 0, b: 0 };
const INK = { r: 0.25, g: 0.25, b: 0.25, a: 1 };
const PAPER = { r: 0.75, g: 0.75, b: 0.75, a: 1 };
const SKY = { r: 0.25, g: 0.5, b: 0.75, a: 1 };
const INK_KEY = "color/ink|m";

const frame = (id: string, parent: string | null = null, extra: object = {}): PlanOp => ({
  op: "frame",
  id,
  parent,
  name: id,
  x: 5,
  y: 6,
  w: 100,
  h: 50,
  fills: [{ type: "SOLID", color: BLACK, opacity: 1, colorKey: INK_KEY }],
  strokes: null,
  radius: [0, 0, 0, 0],
  opacity: 1,
  effects: [],
  clips: true,
  layout: { mode: "NONE" },
  childCount: 0,
  ...extra,
});
const main = (key: string, extra: object = {}): PlanOp =>
  frame(`${key}/n`, null, { name: key, x: 0, y: 0, component: { key, name: key }, ...extra });
const instance = (id: string, parent: string, key: string): PlanOp => ({
  op: "instance",
  id,
  parent,
  name: id,
  x: 7,
  y: 8,
  w: 100,
  h: 50,
  key,
  resize: false,
  overrides: [],
});
/** A page of the given size with a card in it, so that the version has a section. */
const page = (w: number, h: number, mainExtra: object = {}): PlanOp[] => [
  main("x-card", mainExtra),
  frame("root", null, { w, h, childCount: 1 }),
  instance("a", "root", "x-card"),
];

const ink: PlanModeColor = {
  key: INK_KEY,
  name: "color/ink",
  values: [
    { mode: 0, value: INK },
    { mode: 1, value: PAPER },
    { mode: 2, value: SKY },
  ],
  from: ["a", "b", "c"],
};
const tokensFor = (modes: string[]): PlanVersionTokens => ({
  collection: "example.com",
  modes,
  colors: [{ ...ink, values: ink.values.slice(0, modes.length) }],
  textStyles: [],
});
const options = { ...DEFAULT_IMPORT_OPTIONS };
const meta = (index: number, label: string) => ({
  name: "Pricing",
  fonts: [inter],
  totalOps: 3,
  version: { index, label },
});

/** Runs a whole set; `sizes` is one page per version. */
async function importSet(f: Fake, a: Applier, sizes: [number, number][], modes?: string[]) {
  const labels = modes ?? sizes.map(([w]) => String(w));
  await a.beginSet();
  await a.importModes(tokensFor(labels), options);
  for (const [i, [w, h]] of sizes.entries()) {
    await a.begin(meta(i, labels[i] as string));
    await a.applyBatch(page(w, h));
    await a.end();
  }
  return a.endSet();
}

const on = (f: Fake, type: string) => f.page.children.filter((n: FakeNode) => n.type === type);
const framesOf = (f: Fake) => on(f, "FRAME") as FakeNode[];
const sectionsOf = (f: Fake) => on(f, "SECTION") as FakeNode[];
const collectionOf = (f: Fake) => [...f.tokens.collections.values()][0] as FakeNode;
const modeNamed = (f: Fake, name: string) =>
  collectionOf(f).modes.find((m: { name: string }) => m.name === name).modeId;
const variables = (f: Fake) => [...f.tokens.variables.values()] as FakeNode[];

const overlap = (a: FakeNode, b: FakeNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("placement", () => {
  test("frames sit left to right with a 200 px gap, top aligned", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 2000],
      [393, 3000],
    ]);
    const frames = framesOf(f);
    expect(frames.map((n) => n.x)).toEqual([0, 1640, 2674]);
    expect(frames.map((n) => n.y)).toEqual([0, 0, 0]);
  });

  test("a set starts past what the page already holds", async () => {
    const f = fakeFigma({ existingBounds: [{ x: 0, width: 500 }] });
    await importSet(f, createApplier(f.figma), [
      [100, 100],
      [100, 100],
    ]);
    expect(
      framesOf(f)
        .slice(-2)
        .map((n) => n.x)
    ).toEqual([600, 900]);
  });

  test("each frame is named <page> — <label>", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 900],
    ]);
    expect(framesOf(f).map((n) => n.name)).toEqual(["Pricing — 1440", "Pricing — 834"]);
  });

  test("each version has its own component section", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 900],
    ]);
    expect(sectionsOf(f).map((n) => n.name)).toEqual([
      "Pricing — 1440 components",
      "Pricing — 834 components",
    ]);
    expect(sectionsOf(f).map((n) => n.children.length)).toEqual([1, 1]);
    const [wide, narrow] = framesOf(f) as [FakeNode, FakeNode];
    expect(wide.children[0].main).toBe(sectionsOf(f)[0]?.children[0]);
    expect(narrow.children[0].main).toBe(sectionsOf(f)[1]?.children[0]);
  });

  test("sections sit below the tallest frame, each at its frame's x", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 2000],
    ]);
    const [first, second] = framesOf(f) as [FakeNode, FakeNode];
    expect(sectionsOf(f).map((n) => n.x)).toEqual([first.x, second.x]);
    expect(sectionsOf(f).map((n) => n.y)).toEqual([2200, 2200]);
  });

  test("frames and component sections don't overlap", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 2000],
    ]);
    const all = [...framesOf(f), ...sectionsOf(f)];
    for (const a of all) for (const b of all) if (a !== b) expect(overlap(a, b)).toBe(false);
  });

  test("a section wider than its frame pushes the next one along", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    for (const [i, label] of ["a", "b"].entries()) {
      await a.begin(meta(i, label));
      await a.applyBatch(page(100, 100, { w: 900, h: 50 }));
      await a.end();
    }
    await a.endSet();
    const [left, right] = sectionsOf(f) as [FakeNode, FakeNode];
    expect(left.width).toBeGreaterThan(300);
    expect(overlap(left, right)).toBe(false);
    expect(right.x).toBe(left.x + left.width + 200);
  });

  test("every frame ends up selected", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [100, 100],
      [100, 100],
    ]);
    expect(f.page.selection).toEqual(framesOf(f));
    expect(f.count("scrollAndZoomIntoView")).toBe(1);
  });
});

describe("modes", () => {
  test("each frame is set to its mode", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 900],
    ]);
    const { id } = collectionOf(f);
    expect(framesOf(f).map((n) => n.explicitModes[id])).toEqual([
      modeNamed(f, "1440"),
      modeNamed(f, "834"),
    ]);
  });

  test("each main is set to its version's mode", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [1440, 900],
      [834, 900],
    ]);
    const { id } = collectionOf(f);
    expect(sectionsOf(f).map((s) => s.children[0].explicitModes[id])).toEqual([
      modeNamed(f, "1440"),
      modeNamed(f, "834"),
    ]);
  });

  test("a hover variant sits on the mode of the main it came from", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    const hover = {
      component: { key: "x-card", name: "x-card", hover: [{ path: [], opacity: 0.5 }] },
    };
    for (const [i, label] of ["a", "b"].entries()) {
      await a.begin(meta(i, label));
      await a.applyBatch(page(100, 100, hover));
      await a.end();
    }
    await a.endSet();
    const { id } = collectionOf(f);
    const [, second] = sectionsOf(f) as [FakeNode, FakeNode];
    const [dflt, variant] = second.children[0].children as [FakeNode, FakeNode];
    expect(dflt.explicitModes[id]).toBe(modeNamed(f, "b"));
    expect(variant.explicitModes[id]).toBe(modeNamed(f, "b"));
  });

  test("the set's tokens last across versions: every frame binds the same variable", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [100, 100],
      [100, 100],
    ]);
    expect(variables(f)).toHaveLength(1);
    expect(framesOf(f).map((n) => n.fills[0].boundVariables?.color.id)).toEqual([
      variables(f)[0]?.id,
      variables(f)[0]?.id,
    ]);
  });

  test("a frame whose mode was dropped stays on the first mode", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const a = createApplier(f.figma);
    await a.beginSet();
    const { droppedVersions } = await a.importModes(tokensFor(["a", "b"]), options);
    expect(droppedVersions).toEqual([1]);
    await a.begin(meta(1, "b"));
    await a.applyBatch(page(100, 100));
    await a.end();
    await a.endSet();
    expect(framesOf(f)[0]?.explicitModes).toEqual({});
  });

  test("a refused mode costs that binding, not the frame", async () => {
    const f = fakeFigma({ failExplicitMode: true });
    const result = await importSet(f, createApplier(f.figma), [
      [100, 100],
      [100, 100],
    ]);
    expect(framesOf(f)).toHaveLength(2);
    expect(result.tokenFailures).toBeGreaterThan(0);
  });

  describe("refused on a version", () => {
    const BODY = "body/1|m";
    const GAP = "spacing:--gap|m";
    const run = {
      start: 0,
      end: 2,
      fontName: inter,
      fontSize: 16,
      lineHeight: null,
      letterSpacing: 0,
      color: BLACK,
      opacity: 1,
      decoration: "NONE",
      textCase: "ORIGINAL",
      styleKey: BODY,
      colorKey: INK_KEY,
    };
    const row = {
      mode: "HORIZONTAL",
      wrap: false,
      itemSpacing: 8,
      counterSpacing: null,
      padding: [0, 0, 0, 0],
      primaryAlign: "MIN",
      counterAlign: "MIN",
      sizingH: "FIXED",
      sizingV: "FIXED",
      spacingKeys: { itemSpacing: GAP },
    };
    const text: PlanOp = {
      op: "text",
      id: "t",
      parent: "root",
      name: "t",
      x: 0,
      y: 0,
      w: 50,
      h: 20,
      text: "Hi",
      runs: [run],
      align: "LEFT",
      wrap: false,
      lineCount: 1,
    } as PlanOp;
    /** Every kind of binding a version can make, and a main ahead of the root. */
    const ops: PlanOp[] = [
      main("x-card", { layout: row }),
      frame("root", null, { layout: row, childCount: 2 }),
      instance("a", "root", "x-card"),
      text,
    ];
    const all: PlanVersionTokens = {
      ...tokensFor(["a", "b"]),
      textStyles: [
        {
          key: BODY,
          name: "body/1",
          fontName: inter,
          decoration: "NONE",
          textCase: "ORIGINAL",
          letterSpacing: [
            { mode: 0, value: 0 },
            { mode: 1, value: 0 },
          ],
          fontSize: [
            { mode: 0, value: 16 },
            { mode: 1, value: 14 },
          ],
          lineHeight: [
            { mode: 0, value: null },
            { mode: 1, value: null },
          ],
          from: ["a", "b"],
        },
      ],
      spacing: [
        {
          key: GAP,
          name: "spacing/gap",
          cssVar: "--gap",
          values: [
            { mode: 0, value: 8 },
            { mode: 1, value: 4 },
          ],
          from: ["a", "b"],
        },
      ],
    };
    const importAll = async (f: Fake, a: Applier) => {
      await a.beginSet();
      await a.importModes(all, options);
      for (const [i, label] of ["a", "b"].entries()) {
        await a.begin(meta(i, label));
        await a.applyBatch(ops);
        await a.end();
      }
      return a.endSet();
    };
    const boundIn = (nodes: FakeNode[]) =>
      nodes
        .filter(
          (n) =>
            n.boundVariables?.itemSpacing ||
            n.fills?.some?.((p: { boundVariables?: object }) => p.boundVariables) ||
            (n.textStyleIds?.size ?? 0) > 0
        )
        .map((n) => n.name);
    const under = (node: FakeNode): FakeNode[] => [node, ...(node.children ?? []).flatMap(under)];

    test("a main refused first keeps the whole version plain, and the other bound", async () => {
      // Each version sets its main, then its root: the third call is version b's main.
      const f = fakeFigma({ failExplicitMode: 3 });
      const result = await importAll(f, createApplier(f.figma));
      const [firstRoot, secondRoot] = framesOf(f) as [FakeNode, FakeNode];
      const [firstSection, secondSection] = sectionsOf(f) as [FakeNode, FakeNode];
      expect(boundIn(under(firstRoot)).length).toBeGreaterThan(0);
      expect(boundIn(under(firstSection)).length).toBeGreaterThan(0);
      expect(boundIn(under(secondRoot))).toEqual([]);
      expect(boundIn(under(secondSection))).toEqual([]);
      expect(result.tokenFailures).toBe(1);
    });

    test("the root is refused with no main ahead of it: nothing in it binds", async () => {
      const f = fakeFigma({ failExplicitMode: true });
      const a = createApplier(f.figma);
      await a.beginSet();
      await a.importModes(all, options);
      await a.begin(meta(0, "a"));
      await a.applyBatch(ops.slice(1).filter((op) => op.op !== "instance"));
      await a.end();
      const result = await a.endSet();
      expect(boundIn(under(framesOf(f)[0] as FakeNode))).toEqual([]);
      expect(result.tokenFailures).toBe(1);
    });

    test("a main made before the refusal stays as it is, and the rest go plain", async () => {
      const f = fakeFigma({ failExplicitMode: 2 });
      const a = createApplier(f.figma);
      await a.beginSet();
      await a.importModes(all, options);
      await a.begin(meta(0, "a"));
      await a.applyBatch(ops);
      await a.end();
      await a.endSet();
      const section = sectionsOf(f)[0] as FakeNode;
      expect(boundIn(under(section)).length).toBeGreaterThan(0);
      // An instance shows its main, which stays as it was made.
      const root = framesOf(f)[0] as FakeNode;
      const own = root.children.filter((n: FakeNode) => n.type !== "INSTANCE");
      expect(boundIn([root, ...own])).toEqual([]);
    });
  });

  test("the set reports its token counts once, at the end, and not per version", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch(page(100, 100));
    const first = await a.end();
    await a.begin(meta(1, "b"));
    await a.applyBatch(page(100, 100));
    const second = await a.end();
    const set = await a.endSet();
    expect(first.variablesCreated + second.variablesCreated).toBe(0);
    expect(first.modes).toBe(0);
    expect(set).toMatchObject({ variablesCreated: 1, modes: 2, modesDropped: 0 });
    expect(set.rootIds).toEqual([first.rootId, second.rootId]);
  });
});

describe("cancel", () => {
  test("Cancel on version 3 removes versions 1 and 2", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    const labels = ["a", "b", "c"];
    await a.beginSet();
    await a.importModes(tokensFor(labels), options);
    for (const [i, label] of labels.entries()) {
      await a.begin(meta(i, label));
      await a.applyBatch(page(100, 100));
      if (i < 2) await a.end();
    }
    await a.cancel();
    expect(f.page.children).toHaveLength(0);
    expect(variables(f)).toHaveLength(0);
    expect(f.tokens.collections.size).toBe(0);
  });

  test("Cancel between versions removes them all", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch(page(100, 100));
    await a.end();
    expect(a.isActive()).toBe(true);
    await a.cancel();
    expect(f.page.children).toHaveLength(0);
    expect(variables(f)).toHaveLength(0);
    expect(a.isActive()).toBe(false);
  });

  test("Cancel before the first version takes the tokens back", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.cancel();
    expect(variables(f)).toHaveLength(0);
    expect(f.tokens.collections.size).toBe(0);
  });

  test("a set abandoned for a plain import is removed", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch(page(100, 100));
    await a.end();
    await a.begin({ name: "Other", fonts: [inter], totalOps: 1 });
    expect(f.page.children).toHaveLength(0);
    expect(variables(f)).toHaveLength(0);
  });
});

describe("a failed version", () => {
  /** A set of three whose middle version stops halfway. */
  async function middleFails(f: Fake, a: Applier) {
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b", "c"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch(page(100, 100));
    await a.end();
    await a.begin(meta(1, "b"));
    await a.applyBatch(page(100, 100));
    await a.begin(meta(2, "c"));
    expect(framesOf(f)).toHaveLength(1);
    await a.applyBatch(page(100, 100));
    await a.end();
    return a.endSet();
  }

  test("one failed version keeps the others and is reported", async () => {
    const f = fakeFigma();
    const result = await middleFails(f, createApplier(f.figma));
    expect(framesOf(f).map((n) => n.name)).toEqual(["Pricing — a", "Pricing — c"]);
    expect(sectionsOf(f).map((n) => n.name)).toEqual([
      "Pricing — a components",
      "Pricing — c components",
    ]);
    expect(result.rootIds).toHaveLength(2);
    expect(variables(f)).toHaveLength(1);
  });

  test("the frames after it close the gap", async () => {
    const f = fakeFigma();
    await middleFails(f, createApplier(f.figma));
    expect(framesOf(f).map((n) => n.x)).toEqual([0, 300]);
  });

  test("a last version that fails is cleared by endSet", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch(page(100, 100));
    await a.end();
    await a.begin(meta(1, "b"));
    await a.applyBatch(page(100, 100));
    await a.endSet();
    expect(framesOf(f).map((n) => n.name)).toEqual(["Pricing — a"]);
    expect(sectionsOf(f)).toHaveLength(1);
    // Inside the set's undo step, or one undo would bring the partial version back.
    expect(f.calls.lastIndexOf("remove:FRAME")).toBeLessThan(f.calls.lastIndexOf("commitUndo"));
  });

  test("a version with no root is dropped without an undo step", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.begin(meta(0, "a"));
    await a.applyBatch([main("x-card")]);
    const result = await a.end();
    expect(result.rootId).toBe("");
    expect(sectionsOf(f)).toHaveLength(0);
    expect(f.count("commitUndo")).toBe(0);
  });

  test("when every version fails nothing is left and the tokens go", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.beginSet();
    await a.importModes(tokensFor(["a", "b"]), options);
    await a.begin(meta(0, "a"));
    await a.applyBatch([main("x-card")]);
    await a.end();
    const result = await a.endSet();
    expect(result.rootIds).toEqual([]);
    expect(f.page.children).toHaveLength(0);
    expect(variables(f)).toHaveLength(0);
    expect(f.tokens.collections.size).toBe(0);
  });
});

describe("undo", () => {
  test("undo removes the whole set in one step", async () => {
    const f = fakeFigma();
    await importSet(f, createApplier(f.figma), [
      [100, 100],
      [100, 100],
      [100, 100],
    ]);
    expect(f.count("commitUndo")).toBe(1);
    // The sections move into place before the commit, so one undo takes them too.
    expect(f.calls.lastIndexOf("commitUndo")).toBeGreaterThan(
      f.calls.lastIndexOf("createInstance")
    );
  });

  test("two sets one after another are an undo step each", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await importSet(f, a, [
      [100, 100],
      [100, 100],
    ]);
    await importSet(f, a, [
      [100, 100],
      [100, 100],
    ]);
    expect(f.count("commitUndo")).toBe(2);
    expect(framesOf(f)).toHaveLength(4);
    expect(new Set(framesOf(f).map((n) => n.x)).size).toBe(4);
  });

  test("a set started over a stale import closes that off first", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin({ name: "Stale", fonts: [inter], totalOps: 1 });
    await a.applyBatch([frame("root")]);
    await a.beginSet();
    expect(f.page.children).toHaveLength(0);
    expect(f.count("commitUndo")).toBe(2);
  });
});

test("a single file makes no set and no mode", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin({ name: "Pricing", fonts: [inter], totalOps: 3 });
  await a.importTokens({ textStyles: [], colors: [], collection: "example.com" }, options);
  await a.applyBatch(page(100, 100));
  const r = await a.end();
  expect(f.node(r.rootId).name).toBe("Pricing");
  expect(f.count("setExplicitMode")).toBe(0);
  expect(f.count("commitUndo")).toBe(2);
  expect(sectionsOf(f)[0]?.y).toBe(0);
  expect(sectionsOf(f)[0]?.name).toBe("Pricing components");
});

test("endSet with no set refuses", async () => {
  const f = fakeFigma();
  await expect(createApplier(f.figma).endSet()).rejects.toThrow();
});
