import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  extractComponents,
  type FontRef,
  type PlanHoverPatch,
  type PlanOp,
  type PlanOverride,
  type PlanRun,
  type PlanTokens,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { type FakeNode, fakeFigma } from "./fake-figma";

const inter: FontRef = { family: "Inter", style: "Regular" };
const meta = { name: "Pricing", fonts: [inter], totalOps: 4 };
const RED = { r: 1, g: 0, b: 0 };
const png = new Uint8Array([1, 2, 3]);
const jpg = new Uint8Array([4, 5, 6]);

const frame = (id: string, parent: string | null = null, extra: object = {}): PlanOp => ({
  op: "frame",
  id,
  parent,
  name: id,
  x: 5,
  y: 6,
  w: 100,
  h: 50,
  fills: [{ type: "SOLID", color: RED, opacity: 1 }],
  strokes: null,
  radius: [0, 0, 0, 0],
  opacity: 1,
  effects: [],
  clips: true,
  layout: { mode: "NONE" },
  childCount: 0,
  ...extra,
});
const run = (end: number, extra: Partial<PlanRun> = {}): PlanRun => ({
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
  ...extra,
});
const text = (id: string, parent: string, chars = "hello", extra: object = {}): PlanOp => ({
  op: "text",
  id,
  parent,
  name: id,
  x: 1,
  y: 2,
  w: chars.length * 5,
  h: 12,
  text: chars,
  runs: [run(chars.length)],
  align: "LEFT",
  wrap: false,
  lineCount: 1,
  ...extra,
});
const image = (id: string, parent: string, hash: string): PlanOp => ({
  op: "image",
  id,
  parent,
  name: id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  hash,
  fit: "TILE",
  opacity: 1,
  radius: [0, 0, 0, 0],
  strokes: null,
});
const main = (key: string, extra: object = {}): PlanOp =>
  frame(`${key}/n`, null, {
    name: key,
    x: 0,
    y: 0,
    component: { key, name: key },
    ...extra,
  });
const instance = (id: string, parent: string, key: string, extra: object = {}): PlanOp => ({
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
  ...extra,
});
const hStack = (over: object = {}) => ({
  mode: "HORIZONTAL" as const,
  wrap: false,
  itemSpacing: 0,
  counterSpacing: null,
  padding: [0, 0, 0, 0] as [number, number, number, number],
  primaryAlign: "MIN" as const,
  counterAlign: "MIN" as const,
  sizingH: "HUG" as const,
  sizingV: "HUG" as const,
  ...over,
});
const textOver = (path: number[], chars: string, extra: Partial<PlanRun> = {}): PlanOverride => ({
  path,
  kind: "text",
  text: chars,
  runs: [run(chars.length, extra)],
});

/** A main holding one label, and a page root with `instances`. */
const page = (...instances: PlanOp[]): PlanOp[] => [
  main("x-card", { childCount: 1 }),
  text("x-card/t", "x-card/n"),
  frame("root", null, { childCount: instances.length }),
  ...instances,
];

async function imported(ops: PlanOp[], opts: Parameters<typeof fakeFigma>[0] = {}) {
  const f = fakeFigma(opts);
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(ops);
  const r = await a.end();
  return { f, r, root: f.node(r.rootId) };
}

const ofType = (f: ReturnType<typeof fakeFigma>, type: string) =>
  f.page.findAll((n: FakeNode) => n.type === type) as FakeNode[];

const hop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const ids = (nodes: FakeNode[]) => nodes.map((n) => n.id);

afterEach(() => {
  mock.restore();
});

test("a definition is built with createComponent in a section beside the root", async () => {
  const { f, r, root } = await imported(page(instance("a", "root", "x-card")));
  const [section] = ofType(f, "SECTION") as [FakeNode];
  expect(section.name).toBe("Pricing components");
  expect(section.x).toBe(root.x + root.width + 200);
  expect(section.y).toBe(root.y);
  const [component] = section.children as [FakeNode];
  expect(component.type).toBe("COMPONENT");
  expect(component.name).toBe("x-card");
  expect(component.children[0].characters).toBe("hello");
  expect(root.name).toBe("Pricing");
  expect(ids(f.page.children).sort()).toEqual(ids([root, section]).sort());
  expect(r.componentsCreated).toBe(1);
  expect(r.instancesCreated).toBe(1);
  expect(r.failedOps).toBe(0);
});

test("a definition sets what a component does not default to as a frame does", async () => {
  const { f } = await imported(page(instance("a", "root", "x-card")));
  const [component] = ofType(f, "COMPONENT") as [FakeNode];
  expect(component.fills).toEqual([{ type: "SOLID", color: RED, opacity: 1 }]);
  expect(component.clipsContent).toBe(true);
  expect([component.width, component.height]).toEqual([100, 50]);
});

test("a definition with no fill and no clipping stays that way", async () => {
  const { f } = await imported([main("x-card", { fills: [], clips: false }), frame("root")]);
  const [component] = ofType(f, "COMPONENT") as [FakeNode];
  expect(component.fills).toEqual([]);
  expect(component.clipsContent).toBe(false);
});

test("an instance takes its parent, position, name and childLayout", async () => {
  const { root } = await imported(page(instance("a", "root", "x-card", { name: "Card" })));
  const [node] = root.children as [FakeNode];
  expect(node.type).toBe("INSTANCE");
  expect(node.name).toBe("Card");
  expect([node.x, node.y]).toEqual([7, 8]);
  expect(node.main.name).toBe("x-card");

  const laid = await imported([
    main("x-card"),
    frame("root", null, {
      x: 0,
      y: 0,
      w: 40,
      h: 50,
      layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
      childCount: 3,
    }),
    frame("side", "root", {
      x: 0,
      y: 0,
      w: 40,
      childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "FIXED" },
    }),
    instance("a", "root", "x-card", {
      x: 3,
      y: 4,
      childLayout: { positioning: "ABSOLUTE", sizingH: "FIXED", sizingV: "FIXED" },
    }),
    instance("b", "root", "x-card", {
      x: 3,
      y: 4,
      childLayout: { positioning: "ABSOLUTE", sizingH: "FIXED", sizingV: "FIXED" },
    }),
  ]);
  expect(laid.root.layoutMode).toBe("HORIZONTAL");
  const placed = laid.root.children[1] as FakeNode;
  expect(placed.layoutPositioning).toBe("ABSOLUTE");
  expect([placed.x, placed.y]).toEqual([3, 4]);
});

test("an instance fills its parent when its childLayout says so", async () => {
  const { r, root } = await imported([
    main("x-card", {
      w: 60,
      h: 20,
      layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
      childCount: 1,
    }),
    frame("x-card/f", "x-card/n", { x: 0, y: 0, w: 20, h: 20 }),
    frame("root", null, {
      x: 0,
      y: 0,
      w: 200,
      h: 20,
      layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
      childCount: 1,
    }),
    instance("a", "root", "x-card", {
      x: 0,
      y: 0,
      w: 200,
      h: 20,
      childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "FIXED" },
    }),
  ]);
  expect(root.children[0].layoutSizingHorizontal).toBe("FILL");
  expect(root.children[0].width).toBe(200);
  expect(r.fallbackFrames).toBe(0);
});

test("an instance under a grid goes into its cell", async () => {
  const { root } = await imported([
    main("x-card"),
    frame("root", null, {
      w: 200,
      layout: {
        mode: "GRID",
        rows: [{ type: "FIXED", value: 50 }],
        columns: [
          { type: "FIXED", value: 100 },
          { type: "FIXED", value: 100 },
        ],
        rowGap: 0,
        columnGap: 0,
        padding: [0, 0, 0, 0],
      },
      childCount: 1,
    }),
    instance("a", "root", "x-card", {
      childLayout: {
        positioning: "AUTO",
        sizingH: "FIXED",
        sizingV: "FIXED",
        cell: { row: 0, column: 1 },
      },
    }),
  ]);
  expect((root.children[0] as FakeNode).gridColumnAnchorIndex).toBe(1);
});

test("a text override sets characters and runs, keeping the style link", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  const tokens: PlanTokens = {
    textStyles: [
      {
        key: "body",
        name: "body/1",
        uses: 3,
        fontName: inter,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: 0,
        decoration: "NONE",
        textCase: "ORIGINAL",
      },
    ],
    colors: [],
    collection: "example.com",
  };
  await a.begin(meta);
  await a.importTokens(tokens, DEFAULT_IMPORT_OPTIONS);
  await a.applyBatch(
    page(
      instance("a", "root", "x-card", {
        overrides: [textOver([0], "goodbye", { styleKey: "body", href: "https://example.com/a" })],
      })
    )
  );
  const r = await a.end();
  const label = f.node(r.rootId).children[0].children[0] as FakeNode;
  expect(label.characters).toBe("goodbye");
  const methods = label.ranges.map((x: { m: string }) => x.m);
  expect(methods).toContain("setRangeTextStyleIdAsync");
  expect(methods).toContain("setRangeHyperlink");
  expect(methods.lastIndexOf("setRangeTextStyleIdAsync")).toBeLessThan(
    methods.lastIndexOf("setRangeHyperlink")
  );
  expect(r.overrideFailures).toBe(0);
  expect(r.tokenFailures).toBe(0);
});

test("a text override clears a link the main has and this text does not", async () => {
  const linked = run(5, { href: "https://example.com/" });
  const { root } = await imported([
    main("x-card", { childCount: 1 }),
    text("x-card/t", "x-card/n", "hello", { runs: [linked] }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { overrides: [textOver([0], "plain")] }),
  ]);
  expect(root.children[0].children[0].hyperlink).toBeNull();
});

test("an image override sets the fill by path", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("one", png);
  await a.addImage("two", jpg);
  await a.applyBatch([
    main("x-card", { childCount: 1 }),
    image("x-card/i", "x-card/n", "one"),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { overrides: [{ path: [0], kind: "image", hash: "two" }] }),
  ]);
  const r = await a.end();
  const [paint] = f.node(r.rootId).children[0].children[0].fills;
  expect(paint.imageHash).toBe(f.hashOf(jpg) as string);
  expect(paint.scaleMode).toBe("TILE");
  expect(r.overrideFailures).toBe(0);
});

test("an image override with no image counts as missing and as failed", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.addImage("one", png);
  await a.applyBatch([
    main("x-card", { childCount: 1 }),
    image("x-card/i", "x-card/n", "one"),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { overrides: [{ path: [0], kind: "image", hash: "gone" }] }),
  ]);
  const r = await a.end();
  expect(r.missingImages).toBe(1);
  expect(r.overrideFailures).toBe(1);
  expect(r.failedOps).toBe(0);
});

/** `x-box` holds a nested `x-a`; `x-b` is what it can be swapped for. */
const nested = (top: PlanOp, { extra = [] as PlanOp[] } = {}): PlanOp[] => [
  main("x-a", { childCount: 1 }),
  text("x-a/t", "x-a/n", "from a"),
  main("x-b", { childCount: 2 }),
  frame("x-b/f", "x-b/n"),
  text("x-b/t", "x-b/n", "from b"),
  main("x-box", { childCount: 1 }),
  instance("x-box/i", "x-box/n", "x-a"),
  ...extra,
  frame("root", null, { childCount: 1 }),
  top,
];

test("a swap override uses swapComponent", async () => {
  const { f, r, root } = await imported(
    nested(instance("a", "root", "x-box", { overrides: [{ path: [0], kind: "swap", key: "x-b" }] }))
  );
  expect(f.count("swapComponent")).toBe(1);
  expect(root.children[0].children[0].main.name).toBe("x-b");
  expect(r.overrideFailures).toBe(0);
});

test("an override through a nested instance reaches it by index", async () => {
  const { r, root } = await imported(
    nested(instance("a", "root", "x-box", { overrides: [textOver([0, 0], "reached")] }))
  );
  expect(root.children[0].children[0].children[0].characters).toBe("reached");
  expect(r.overrideFailures).toBe(0);
});

test("overrides run shortest path first, so a walk goes on into the swapped component", async () => {
  const { r, root } = await imported(
    nested(
      instance("a", "root", "x-box", {
        // In the swapped component, index 1 is the text: `x-a` has no such child.
        overrides: [textOver([0, 1], "after swap"), { path: [0], kind: "swap", key: "x-b" }],
      })
    )
  );
  expect(root.children[0].children[0].children[1].characters).toBe("after swap");
  expect(r.overrideFailures).toBe(0);
});

test("resize is called only when the op says so", async () => {
  const tag = [
    main("x-tag", { w: 25, h: 12, layout: hStack(), childCount: 1 }),
    text("x-tag/t", "x-tag/n", "hello", { x: 0, y: 0 }),
    frame("root", null, { childCount: 1 }),
  ];
  const hugs = await imported([...tag, instance("a", "root", "x-tag", { w: 40 })]);
  expect(hugs.f.count("instance.resize")).toBe(0);
  expect(hugs.root.children[0].width).toBe(25);

  const sized = await imported(page(instance("a", "root", "x-card", { w: 300, resize: true })));
  expect(sized.f.count("instance.resize")).toBe(1);
  expect(sized.root.children[0].width).toBe(300);
});

test("a resized instance goes on hugging along an axis its main hugs", async () => {
  const { root } = await imported([
    main("x-tag", { layout: hStack({ sizingV: "FIXED" }), childCount: 1, w: 25, h: 40 }),
    text("x-tag/t", "x-tag/n", "hello", { x: 0, y: 0 }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-tag", { w: 25, h: 60, resize: true }),
  ]);
  const [node] = root.children as [FakeNode];
  expect(node.height).toBe(60);
  expect(node.layoutSizingHorizontal).toBe("HUG");
  expect(node.layoutSizingVertical).toBe("FIXED");
});

test("a failed override is counted, and the import goes on", async () => {
  const { r, root } = await imported(
    page(
      instance("a", "root", "x-card", {
        overrides: [textOver([9], "nowhere"), textOver([0], "still set")],
      }),
      instance("b", "root", "x-card", { overrides: [textOver([0, 3], "nowhere")] })
    )
  );
  expect(r.overrideFailures).toBe(2);
  expect(r.failedOps).toBe(0);
  expect(r.instancesCreated).toBe(2);
  expect(root.children[0].children[0].characters).toBe("still set");
  expect(root.children[1].children[0].characters).toBe("hello");
});

test("an override of the wrong kind of layer fails rather than guessing", async () => {
  const { r } = await imported(
    nested(
      instance("a", "root", "x-box", {
        overrides: [
          textOver([0], "not text"),
          { path: [0, 0], kind: "swap", key: "x-b" },
          { path: [0, 0], kind: "image", hash: "none" },
        ],
      })
    )
  );
  expect(r.overrideFailures).toBe(3);
  expect(r.missingImages).toBe(0);
});

test("a failed swap fails what was to go below it", async () => {
  const { f, r, root } = await imported(
    nested(
      instance("a", "root", "x-box", {
        overrides: [{ path: [0], kind: "swap", key: "x-gone" }, textOver([0, 0], "lost")],
      })
    )
  );
  expect(r.overrideFailures).toBe(2);
  expect(f.count("swapComponent")).toBe(0);
  expect(root.children[0].children[0].children[0].characters).toBe("from a");
});

test("a swap takes the size of its new main, which Figma leaves as it was", async () => {
  const small = { w: 16, h: 16 };
  const { root } = await imported([
    main("x-small", small),
    main("x-large", { w: 24, h: 24 }),
    main("x-box", { w: 16, h: 16, layout: hStack(), childCount: 1 }),
    instance("x-box/i", "x-box/n", "x-small", {
      x: 0,
      y: 0,
      ...small,
      childLayout: { positioning: "AUTO", sizingH: "FIXED", sizingV: "FIXED" },
    }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-box", {
      w: 24,
      h: 24,
      overrides: [{ path: [0], kind: "swap", key: "x-large" }],
    }),
  ]);
  const [box] = root.children as [FakeNode];
  expect([box.children[0].width, box.children[0].height]).toEqual([24, 24]);
  expect([box.width, box.height]).toEqual([24, 24]);
});

test("a swapped instance goes on hugging where its new main hugs", async () => {
  const { root } = await imported(
    nested(
      instance("a", "root", "x-box", { overrides: [{ path: [0], kind: "swap", key: "x-tag" }] }),
      {
        extra: [
          main("x-tag", { w: 25, h: 12, layout: hStack(), childCount: 1 }),
          text("x-tag/t", "x-tag/n", "hello", { x: 0, y: 0 }),
        ],
      }
    )
  );
  const swapped = root.children[0].children[0] as FakeNode;
  expect(swapped.layoutSizingHorizontal).toBe("HUG");
  expect(swapped.width).toBe(25);
});

test("a swap keeps a FILL its instance had in an auto layout parent", async () => {
  const { r, root } = await imported([
    main("x-small", { w: 16, h: 16 }),
    main("x-large", { w: 24, h: 24 }),
    main("x-box", {
      w: 200,
      h: 40,
      layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
      childCount: 1,
    }),
    instance("x-box/i", "x-box/n", "x-small", {
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "FILL" },
    }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-box", {
      w: 200,
      h: 40,
      overrides: [{ path: [0], kind: "swap", key: "x-large" }],
    }),
  ]);
  const swapped = root.children[0].children[0] as FakeNode;
  expect(swapped.main.name).toBe("x-large");
  expect(swapped.layoutSizingHorizontal).toBe("FILL");
  expect(swapped.layoutSizingVertical).toBe("FILL");
  expect([swapped.width, swapped.height]).toEqual([200, 40]);
  expect(r.overrideFailures).toBe(0);
});

test("a resize that fails after a swap counts once, and what is below still applies", async () => {
  const { r, root } = await imported(
    nested(
      instance("a", "root", "x-box", {
        overrides: [{ path: [0], kind: "swap", key: "x-b" }, textOver([0, 1], "after swap")],
      })
    ),
    { swappedResizeThrows: true }
  );
  expect(r.overrideFailures).toBe(1);
  expect(root.children[0].children[0].main.name).toBe("x-b");
  expect(root.children[0].children[0].children[1].characters).toBe("after swap");
});

test("a resize that fails after a swap leaves the definition whole", async () => {
  const { r, root } = await imported(
    nested(instance("a", "root", "x-outer", { overrides: [textOver([0, 0, 1], "reached")] }), {
      extra: [
        main("x-outer", { childCount: 1 }),
        instance("x-outer/i", "x-outer/n", "x-box", {
          overrides: [{ path: [0], kind: "swap", key: "x-b" }],
        }),
      ],
    }),
    { swappedResizeThrows: true }
  );
  expect(r.overrideFailures).toBe(1);
  expect(r.overrideFailuresInMains).toBe(1);
  expect(root.children[0].children[0].children[0].children[1].characters).toBe("reached");
});

test("a swap refused inside a definition stops overrides from outside walking through it", async () => {
  const { r, root } = await imported(
    nested(instance("a", "root", "x-outer", { overrides: [textOver([0, 0, 0], "wrong place")] }), {
      extra: [
        main("x-outer", { childCount: 1 }),
        instance("x-outer/i", "x-outer/n", "x-box", {
          overrides: [{ path: [0], kind: "swap", key: "x-gone" }],
        }),
      ],
    })
  );
  expect(r.overrideFailures).toBe(2);
  expect(r.overrideFailuresInMains).toBe(1);
  expect(root.children[0].children[0].children[0].children[0].characters).toBe("from a");
});

test("a failed definition makes its instances failed ops, not a crash", async () => {
  const { f, r, root } = await imported(
    [
      main("x-card", { childCount: 1 }),
      text("x-card/t", "x-card/n"),
      frame("root", null, { childCount: 2 }),
      instance("a", "root", "x-card"),
      text("t", "root"),
    ],
    { failOn: "x-card" }
  );
  expect(r.failedOps).toBe(3); // the main, its text, and the instance
  expect(r.componentsCreated).toBe(0);
  expect(r.instancesCreated).toBe(0);
  expect(root.children).toHaveLength(1);
  expect(ofType(f, "COMPONENT")).toHaveLength(0);
  expect(ofType(f, "SECTION")).toHaveLength(0);
  expect(ids(f.page.children)).toEqual([root.id]);
});

test("a main missing a child takes no overrides, as indexes no longer line up", async () => {
  const { r, root } = await imported(
    [
      main("x-card", { childCount: 2 }),
      text("x-card/bad", "x-card/n", "first", { name: "bad" }),
      text("x-card/t", "x-card/n", "second"),
      frame("root", null, { childCount: 1 }),
      instance("a", "root", "x-card", {
        // Plan index 0 is the child that failed, and real index 0 is the other one.
        overrides: [textOver([0], "wrong place")],
      }),
    ],
    { failOn: "bad" }
  );
  expect(r.overrideFailures).toBe(1);
  expect(root.children[0].children[0].characters).toBe("second");
});

test("a main holding a damaged main takes no overrides either", async () => {
  const { r, root } = await imported(
    [
      main("x-a", { childCount: 2 }),
      text("x-a/bad", "x-a/n", "first", { name: "bad" }),
      text("x-a/t", "x-a/n", "second"),
      main("x-box", { childCount: 1 }),
      instance("x-box/i", "x-box/n", "x-a"),
      frame("root", null, { childCount: 1 }),
      instance("a", "root", "x-box", { overrides: [textOver([0, 0], "wrong place")] }),
    ],
    { failOn: "bad" }
  );
  expect(r.overrideFailures).toBe(1);
  expect(root.children[0].children[0].children[0].characters).toBe("second");
});

test("a missing root takes the section with it", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([main("x-card")]);
  const r = await a.end();
  expect(r.rootId).toBe("");
  expect(r.failedOps).toBe(1);
  expect(f.page.children).toHaveLength(0);
  expect(f.calls.lastIndexOf("remove:SECTION")).toBeGreaterThan(-1);
  expect(f.calls.lastIndexOf("remove:SECTION")).toBeLessThan(f.calls.lastIndexOf("commitUndo"));
});

test("cancel removes the section and the root, and leaves other components", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  const own = f.figma.createComponent() as unknown as FakeNode;
  own.name = "Mine";
  const before = f.figma.createSection() as unknown as FakeNode;
  await a.begin(meta);
  await a.applyBatch(page(instance("a", "root", "x-card")));
  await a.cancel();
  expect(ids(f.page.children)).toEqual(ids([own, before]));
  expect(own.removed).toBe(false);
  expect(ofType(f, "INSTANCE")).toHaveLength(0);
  expect(a.isActive()).toBe(false);
});

test("cancel between a definition and its first instance removes the section", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([main("x-card")]);
  expect(ofType(f, "SECTION")).toHaveLength(1);
  await a.cancel();
  expect(f.page.children).toHaveLength(0);
});

test("cancel leaves an earlier import's components alone", async () => {
  const { f, root } = await imported(page(instance("a", "root", "x-card")));
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(page(instance("a", "root", "x-card")));
  await a.cancel();
  expect(f.page.children).toHaveLength(2);
  expect(root.removed).toBe(false);
  expect(ofType(f, "COMPONENT")).toHaveLength(1);
});

test("cancel lets go of a variable that only a main used", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  const ink = { key: "#ff0000", name: "color/red", rgba: { ...RED, a: 1 }, uses: 3 };
  await a.begin(meta);
  await a.importTokens(
    { textStyles: [], colors: [ink], collection: "example.com" },
    DEFAULT_IMPORT_OPTIONS
  );
  await a.applyBatch([
    main("x-card", { fills: [{ type: "SOLID", color: RED, opacity: 1, colorKey: ink.key }] }),
  ]);
  expect(await f.figma.variables.getLocalVariablesAsync("COLOR")).toHaveLength(1);
  await a.cancel();
  expect(await f.figma.variables.getLocalVariablesAsync("COLOR")).toHaveLength(0);
});

test("cancel in the middle of an instance's overrides stops them, uncounted", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  // Over budget from here on, so the instance waits in `breathe` before each override.
  let now = 0;
  spyOn(Date, "now").mockImplementation(() => {
    now += 2000;
    return now;
  });
  const applying = a.applyBatch(
    page(
      instance("a", "root", "x-card", {
        overrides: [textOver([0], "one"), textOver([9], "two"), textOver([9], "three")],
      })
    )
  );
  for (let i = 0; i < 1000 && f.count("createInstance") === 0; i++) await hop();
  expect(f.count("createInstance")).toBe(1);
  await a.cancel();
  // The next import is under way when the cancelled one wakes: nothing may land on it.
  await a.begin(meta);
  await applying;
  await a.applyBatch(page());
  const r = await a.end();
  expect(r.overrideFailures).toBe(0);
  expect(r.failedOps).toBe(0);
  expect(ofType(f, "INSTANCE")).toHaveLength(0);
  expect(f.page.children).toHaveLength(2);
});

test("two imports make two sections", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  for (let i = 0; i < 2; i++) {
    await a.begin(meta);
    await a.applyBatch(page(instance("a", "root", "x-card")));
    await a.end();
  }
  const sections = ofType(f, "SECTION").sort((p, q) => p.x - q.x) as [FakeNode, FakeNode];
  expect(sections).toHaveLength(2);
  expect(ofType(f, "COMPONENT")).toHaveLength(2);
  const [first, second] = sections;
  expect(second.x).toBeGreaterThan(first.x + first.width);
});

test("the section wraps at 1600 px and fits its contents", async () => {
  const keys = ["x-a", "x-b", "x-c", "x-d"];
  const { f } = await imported([
    ...keys.map((key, i) => main(key, { w: 700, h: 100 + i * 10 })),
    frame("root"),
  ]);
  const [section] = ofType(f, "SECTION") as [FakeNode];
  expect(section.fills[0]?.type).toBe("SOLID");
  const spots = section.children.map((n: FakeNode) => [n.x, n.y]);
  expect(spots).toEqual([
    [40, 40],
    [780, 40],
    [40, 190],
    [780, 190],
  ]);
  expect(section.width).toBe(1520);
  expect(section.height).toBe(360);
});

test("a main wider than the wrap point sits alone on its row", async () => {
  const { f } = await imported([main("x-a", { w: 2000 }), main("x-b", { w: 100 }), frame("root")]);
  const [section] = ofType(f, "SECTION") as [FakeNode];
  expect(section.children.map((n: FakeNode) => n.y)).toEqual([40, 130]);
  expect(section.width).toBe(2080);
});

test("a section is sized after verification has settled its mains", async () => {
  // Verification puts this main back to its captured size, so a section sized from the first
  // layout would not fit it.
  const { f } = await imported(
    [
      main("x-a", {
        w: 400,
        h: 90,
        layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
        childCount: 2,
      }),
      frame("x-a/1", "x-a/n", { w: 100, x: 0, y: 0 }),
      frame("x-a/2", "x-a/n", { w: 100, x: 100, y: 0 }),
      frame("root"),
    ],
    { shiftChild: 30 }
  );
  const [section] = ofType(f, "SECTION") as [FakeNode];
  expect(section.children[0].layoutMode).toBe("NONE");
  expect(section.width).toBe(480);
  expect(section.height).toBe(170);
});

const row = hStack({ itemSpacing: 10 });

test("a parent in auto layout still verifies with instance children", async () => {
  const { f, r, root } = await imported(
    [
      main("x-tag", { w: 25, h: 12, layout: hStack(), childCount: 1 }),
      text("x-tag/t", "x-tag/n", "hello", { x: 0, y: 0 }),
      frame("root", null, { w: 145, h: 12, x: 0, y: 0, layout: row, childCount: 3 }),
      instance("a", "root", "x-tag", {
        x: 0,
        y: 0,
        w: 25,
        h: 12,
        childLayout: { positioning: "AUTO", sizingH: "HUG", sizingV: "HUG" },
      }),
      instance("b", "root", "x-tag", {
        x: 35,
        y: 0,
        w: 50,
        h: 12,
        overrides: [textOver([0], "helloworld")],
        childLayout: { positioning: "AUTO", sizingH: "HUG", sizingV: "HUG" },
      }),
      instance("c", "root", "x-tag", {
        x: 95,
        y: 0,
        w: 50,
        h: 12,
        overrides: [textOver([0], "helloworld")],
        childLayout: { positioning: "AUTO", sizingH: "HUG", sizingV: "HUG" },
      }),
    ],
    { textWiderBy: 0.1 } // an instance comes out wider than captured, as Figma's text does
  );
  expect(root.layoutMode).toBe("HORIZONTAL");
  expect(r.fallbackFrames).toBe(0);
  expect(r.autoLayoutFrames).toBe(2); // the main and the row
  expect(f.page.children).toHaveLength(2);
});

test("an instance whose size text does not explain still fails its parent", async () => {
  const { r, root } = await imported([
    main("x-card", {
      w: 25,
      h: 12,
      layout: hStack({ sizingH: "FIXED", sizingV: "FIXED" }),
      childCount: 1,
    }),
    frame("x-card/f", "x-card/n", { x: 0, y: 0, w: 25, h: 12 }),
    frame("root", null, { w: 25, h: 12, x: 0, y: 0, layout: hStack(), childCount: 1 }),
    instance("a", "root", "x-card", {
      x: 0,
      y: 0,
      w: 90,
      h: 12,
      childLayout: { positioning: "AUTO", sizingH: "FIXED", sizingV: "FIXED" },
    }),
  ]);
  expect(root.layoutMode).toBe("NONE");
  expect(r.fallbackReasons).toEqual({ size: 1 });
});

test("an instance hugging text inside a nested main still verifies", async () => {
  const child = { positioning: "AUTO" as const, sizingH: "HUG" as const, sizingV: "HUG" as const };
  const { r } = await imported(
    [
      main("x-tag", { w: 25, h: 12, layout: hStack(), childCount: 1 }),
      text("x-tag/t", "x-tag/n", "hello", { x: 0, y: 0 }),
      main("x-box", { w: 25, h: 12, layout: hStack(), childCount: 1 }),
      instance("x-box/i", "x-box/n", "x-tag", { x: 0, y: 0, w: 25, h: 12, childLayout: child }),
      frame("root", null, { w: 25, h: 12, x: 0, y: 0, layout: hStack(), childCount: 1 }),
      instance("a", "root", "x-box", { x: 0, y: 0, w: 25, h: 12, childLayout: child }),
    ],
    { textWiderBy: 0.1 }
  );
  expect(r.fallbackFrames).toBe(0);
});

test("an instance of a main that lost auto layout takes its own captured size", async () => {
  const child = { positioning: "AUTO" as const, sizingH: "HUG" as const, sizingV: "HUG" as const };
  const { r, root } = await imported(
    [
      main("x-tag", { w: 110, h: 50, layout: hStack({ itemSpacing: 10 }), childCount: 2 }),
      frame("x-tag/1", "x-tag/n", { x: 0, y: 0, w: 50, h: 50 }),
      frame("x-tag/2", "x-tag/n", { x: 60, y: 0, w: 50, h: 50 }),
      frame("root", null, { w: 300, h: 50, x: 0, y: 0, childCount: 1 }),
      // Hugging, so not resized by the plan, but its main no longer hugs.
      instance("a", "root", "x-tag", { x: 0, y: 0, w: 140, h: 50, childLayout: child }),
    ],
    { shiftChild: 30 }
  );
  expect(r.fallbackReasons).toEqual({ gap: 1 });
  expect(root.children[0].width).toBe(140);
});

test("time is shared with the instance ops, and within one instance's overrides", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  let now = 0;
  spyOn(Date, "now").mockImplementation(() => {
    now += 600;
    return now;
  });
  const timers = spyOn(globalThis, "setTimeout");
  const overrides = [textOver([0], "a"), textOver([0], "b"), textOver([0], "c")];
  await a.applyBatch(page(instance("a", "root", "x-card", { overrides })));
  expect(timers.mock.calls.length).toBeGreaterThan(3);
  expect((await a.end()).overrideFailures).toBe(0);
});

test("a page's repeated elements come through the mapper's own ops", async () => {
  const child = { positioning: "AUTO" as const, sizingH: "HUG" as const, sizingV: "HUG" as const };
  const card = (id: string, x: number, chars: string): PlanOp[] => [
    frame(id, "root", {
      x,
      y: 0,
      w: chars.length * 5,
      h: 12,
      layout: hStack(),
      childLayout: child,
      childCount: 1,
    }),
    text(`${id}-t`, id, chars, { x: 0, y: 0, childLayout: child }),
  ];
  const ops = [
    frame("root", null, { x: 0, y: 0, w: 85, h: 12, layout: row, childCount: 2 }),
    ...card("a", 0, "hello"),
    ...card("b", 35, "helloworld"),
  ];
  const tags = new Map([
    ["a", "x-tag"],
    ["b", "x-tag"],
  ]);
  const { ops: plan } = extractComponents(ops, tags);
  const { f, r, root } = await imported(plan);
  expect(r).toMatchObject({ componentsCreated: 1, instancesCreated: 2, overrideFailures: 0 });
  expect(r.failedOps).toBe(0);
  expect(r.fallbackFrames).toBe(0);
  expect(ofType(f, "COMPONENT")).toHaveLength(1);
  expect(root.children.map((n: FakeNode) => n.type)).toEqual(["INSTANCE", "INSTANCE"]);
  expect(root.children.map((n: FakeNode) => n.children[0].characters)).toEqual([
    "hello",
    "helloworld",
  ]);
  expect(root.children.map((n: FakeNode) => n.width)).toEqual([25, 50]);
});

test("a centred or right-aligned label stays on its anchor when an override changes it", async () => {
  const label = (align: string) => [
    main("x-card", { childCount: 1 }),
    text("x-card/t", "x-card/n", "hello", { x: 10, y: 0, align }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { overrides: [textOver([0], "helloworld")] }),
  ];
  const centred = await imported(label("CENTER"));
  const c = centred.root.children[0].children[0] as FakeNode;
  expect(c.x + c.width / 2).toBe(22.5);
  const right = await imported(label("RIGHT"));
  const e = right.root.children[0].children[0] as FakeNode;
  expect(e.x + e.width).toBe(35);
});

test("wrapped text that gains a line in an instance counts as rewrapped and is not resized", async () => {
  const wrapped = (chars: string) => [
    main("x-card", { childCount: 1 }),
    text("x-card/t", "x-card/n", "hello", { w: 30, wrap: true }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { overrides: [textOver([0], chars)] }),
  ];
  const gained = await imported(wrapped("hello world"));
  const label = gained.root.children[0].children[0] as FakeNode;
  expect(gained.r.rewrappedTexts).toBe(1);
  expect(label.width).toBe(30);
  expect(label.height).toBe(24);
  expect((await imported(wrapped("howdy"))).r.rewrappedTexts).toBe(0);
});

test("single-line text in an instance never counts as rewrapped", async () => {
  const { r } = await imported(
    page(instance("a", "root", "x-card", { overrides: [textOver([0], "hello world")] }))
  );
  expect(r.rewrappedTexts).toBe(0);
});

test("a failure in a definition is flagged, as it shows in every copy", async () => {
  const { r } = await imported(
    nested(instance("a", "root", "x-box", { overrides: [textOver([7], "page level")] }), {
      extra: [
        main("x-held", { childCount: 1 }),
        instance("x-held/i", "x-held/n", "x-a", { overrides: [textOver([5], "in a main")] }),
      ],
    })
  );
  expect(r.overrideFailures).toBe(2);
  expect(r.overrideFailuresInMains).toBe(1);
});

test("an instance resized from a main with no auto layout left is counted", async () => {
  const held = (w: number) => [
    main("x-card", { childCount: 1, layout: { mode: "NONE" } }),
    text("x-card/t", "x-card/n"),
    frame("root", null, { childCount: 2 }),
    instance("a", "root", "x-card"),
    instance("b", "root", "x-card", { w, resize: true }),
  ];
  const { r } = await imported(held(160) as PlanOp[]);
  expect(r.resizedFallbacks).toBe(1);
  const same = await imported(held(100) as PlanOp[]);
  expect(same.r.resizedFallbacks).toBe(0);
});

test("a childless main resized on purpose is no fallback", async () => {
  const { r } = await imported([
    main("x-card", { childCount: 0, layout: { mode: "NONE" } }),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-card", { w: 160, resize: true }),
  ]);
  expect(r.resizedFallbacks).toBe(0);
});

test("a section that cannot be laid out is counted, and the import is kept", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(page(instance("a", "root", "x-card")));
  const [component] = ofType(f, "COMPONENT") as [FakeNode];
  Object.defineProperty(component, "width", {
    get() {
      throw new Error("node removed");
    },
  });
  const r = await a.end();
  expect(r.layoutFailures).toBe(1);
  expect(r.rootId).not.toBe("");
  expect(ofType(f, "SECTION")).toHaveLength(1);
});

test("a section laid out as planned counts no failure", async () => {
  const { r } = await imported(page(instance("a", "root", "x-card")));
  expect(r.layoutFailures).toBe(0);
});

const BLUE = { r: 0, g: 0, b: 1 };
const blueFill = [{ type: "SOLID" as const, color: BLUE, opacity: 1 }];

/** `x-card` with one label, a hover on its background and label colour, and `n` instances. */
const hovered = (n = 1, hover: PlanHoverPatch[] | undefined = undefined): PlanOp[] => [
  main("x-card", {
    childCount: 1,
    component: {
      key: "x-card",
      name: "x-card",
      hover: hover ?? [
        { path: [], fills: blueFill },
        { path: [0], textColor: { ...BLUE, a: 1 } },
      ],
    },
  }),
  text("x-card/t", "x-card/n"),
  frame("root", null, { childCount: n }),
  ...Array.from({ length: n }, (_, i) => instance(`i${i}`, "root", "x-card")),
];

const setsOf = (f: ReturnType<typeof fakeFigma>) => ofType(f, "COMPONENT_SET");

test("the applier makes a State set with Default and Hover", async () => {
  const { f, r } = await imported(hovered());
  const [set] = setsOf(f) as [FakeNode];
  expect(set.name).toBe("x-card");
  expect(set.children.map((v: FakeNode) => v.name)).toEqual(["State=Default", "State=Hover"]);
  const [dflt, hover] = set.children as [FakeNode, FakeNode];
  expect(dflt.fills).toEqual([{ type: "SOLID", color: RED, opacity: 1 }]);
  expect(hover.fills).toEqual(blueFill);
  expect(r).toMatchObject({ hoverVariants: 1, hoverFailures: 0, layoutFailures: 0 });
});

test("a text colour patch reaches the hover variant's label only", async () => {
  const { f } = await imported(hovered());
  const [dflt, hover] = (setsOf(f)[0] as FakeNode).children as [FakeNode, FakeNode];
  const fills = (n: FakeNode) =>
    (n.children[0].ranges ?? []).filter((x: { m: string }) => x.m === "setRangeFills");
  expect(fills(hover).at(-1).v[0].color).toEqual(BLUE);
  expect(fills(dflt).at(-1).v[0].color).toEqual({ r: 0, g: 0, b: 0 });
});

test("a decoration patch sets the label's decoration on the hover variant", async () => {
  const { f } = await imported(hovered(1, [{ path: [0], decoration: "UNDERLINE" }]));
  const [dflt, hover] = (setsOf(f)[0] as FakeNode).children as [FakeNode, FakeNode];
  expect(hover.children[0].decorations.at(-1).v).toBe("UNDERLINE");
  expect(dflt.children[0].decorations.at(-1).v).toBe("NONE");
});

test("stroke, opacity and effect patches land on the hover variant only", async () => {
  const effect = {
    type: "DROP_SHADOW" as const,
    color: { r: 0, g: 0, b: 0, a: 0.5 },
    offset: { x: 0, y: 2 },
    radius: 4,
    spread: 0,
  };
  const { f } = await imported(
    hovered(1, [
      {
        path: [],
        strokeColor: { ...BLUE, a: 0.5 },
        opacity: 0.5,
        effects: [effect],
      },
    ])
  );
  const [dflt, hover] = (setsOf(f)[0] as FakeNode).children as [FakeNode, FakeNode];
  expect(hover.strokes).toEqual([{ type: "SOLID", color: BLUE, opacity: 0.5 }]);
  expect(hover.opacity).toBe(0.5);
  expect(hover.effects).toHaveLength(1);
  expect(dflt.opacity).not.toBe(0.5);
  expect(dflt.effects).toHaveLength(0);
});

test("the variants sit side by side and the set fits them", async () => {
  const { f } = await imported(hovered());
  const set = setsOf(f)[0] as FakeNode;
  const [dflt, hover] = set.children as [FakeNode, FakeNode];
  expect([dflt.x, dflt.y]).toEqual([0, 0]);
  expect([hover.x, hover.y]).toEqual([124, 0]);
  expect([set.width, set.height]).toEqual([224, 50]);
});

test("the section places the set, not the main, and fits it", async () => {
  const { f } = await imported([
    ...hovered(1),
    main("x-pill", { w: 30, h: 20, childCount: 0 }),
    instance("p", "root", "x-pill"),
  ]);
  // The root of `hovered` only counts its first child, so the second instance is a stray.
  const [section] = ofType(f, "SECTION") as [FakeNode];
  const set = setsOf(f)[0] as FakeNode;
  const pill = ofType(f, "COMPONENT").find((c) => c.name === "x-pill") as FakeNode;
  expect([set.x, set.y]).toEqual([40, 40]);
  expect(pill.x).toBe(set.x + set.width + 40);
  expect(section.width).toBeGreaterThanOrEqual(pill.x + pill.width);
});

test("the set is named after the component and sits in the section", async () => {
  const { f } = await imported(hovered());
  const [section] = ofType(f, "SECTION") as [FakeNode];
  const set = setsOf(f)[0] as FakeNode;
  expect(set.parent).toBe(section);
  expect(section.children.map((c: FakeNode) => c.type)).toEqual(["COMPONENT_SET"]);
});

test("instances keep their overrides and now point into the set", async () => {
  const { f, r, root } = await imported([
    ...hovered(0),
    instance("a", "root", "x-card", { overrides: [textOver([0], "Buy now")] }),
  ]);
  expect(r.overrideFailures).toBe(0);
  const [node] = root.children as [FakeNode];
  expect(node.children[0].characters).toBe("Buy now");
  expect(node.main.name).toBe("State=Default");
  expect(node.main.parent.type).toBe("COMPONENT_SET");
});

test("a nested instance in another definition keeps working after its main joins a set", async () => {
  const { f, r } = await imported([
    ...hovered(0).slice(0, 2),
    main("x-wrap", { childCount: 1 }),
    instance("x-wrap/i", "x-wrap/n", "x-card"),
    frame("root", null, { childCount: 1 }),
    instance("a", "root", "x-wrap"),
  ]);
  expect(r).toMatchObject({ hoverVariants: 1, hoverFailures: 0, failedOps: 0 });
  const wrap = ofType(f, "COMPONENT").find((c) => c.name === "x-wrap") as FakeNode;
  expect(wrap.children[0].main.parent.type).toBe("COMPONENT_SET");
});

test("a clone is made per component, not per instance", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(hovered(12));
  await a.end();
  expect(f.count("clone")).toBe(1);
});

test("a component whose hover patches are all empty makes no variant", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(hovered(1, []));
  const r = await a.end();
  expect(f.count("clone")).toBe(0);
  expect(r.hoverVariants).toBe(0);
  expect(ofType(f, "COMPONENT_SET")).toHaveLength(0);
});

test("a main that lost a layer gets no hover, and that is counted", async () => {
  const f = fakeFigma({ failOn: "Bad layer" });
  const [card, label, ...rest] = hovered(1);
  const lost = { ...(label as PlanOp), id: "x-card/bad", name: "Bad layer" } as PlanOp;
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([card as PlanOp, lost, label as PlanOp, ...rest]);
  const r = await a.end();
  expect(r).toMatchObject({ failedOps: 1, hoverVariants: 0, hoverFailures: 1 });
  expect(setsOf(f)).toHaveLength(0);
  expect(ofType(f, "COMPONENT").map((m) => m.name)).toEqual(["x-card"]);
});

test("a failed variant leaves the main in place and is counted", async () => {
  const { f, r } = await imported(hovered(1, [{ path: [4], textColor: { ...BLUE, a: 1 } }]));
  expect(r).toMatchObject({ hoverVariants: 0, hoverFailures: 1, layoutFailures: 0 });
  expect(setsOf(f)).toHaveLength(0);
  const mains = ofType(f, "COMPONENT");
  expect(mains.map((m) => m.name)).toEqual(["x-card"]);
  expect(mains[0].parent.type).toBe("SECTION");
  expect(mains[0].fills).toEqual([{ type: "SOLID", color: RED, opacity: 1 }]);
});

test("a set that cannot be combined is counted, and the main keeps its name", async () => {
  const f = fakeFigma();
  (f.figma as unknown as Record<string, unknown>).combineAsVariants = () => {
    throw new Error("refused");
  };
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch(hovered());
  const r = await a.end();
  expect(r).toMatchObject({ hoverVariants: 0, hoverFailures: 1 });
  const mains = ofType(f, "COMPONENT");
  expect(mains.map((m) => m.name)).toEqual(["x-card"]);
});

test("one failed variant does not stop the next component's", async () => {
  const f = fakeFigma();
  const a = createApplier(f.figma);
  await a.begin(meta);
  await a.applyBatch([
    main("x-bad", {
      childCount: 0,
      component: { key: "x-bad", name: "x-bad", hover: [{ path: [3], opacity: 0.5 }] },
    }),
    ...hovered(1),
  ]);
  const r = await a.end();
  expect(r).toMatchObject({ hoverVariants: 1, hoverFailures: 1 });
  expect(ofType(f, "COMPONENT_SET")).toHaveLength(1);
});

test("a text colour patch with ranges recolours only those ranges", async () => {
  const { f } = await imported(
    hovered(1, [
      {
        path: [0],
        textColor: { ...BLUE, a: 1 },
        ranges: [
          [0, 2],
          [3, 5],
        ],
      },
    ])
  );
  const [dflt, hover] = (setsOf(f)[0] as FakeNode).children as [FakeNode, FakeNode];
  const spans = (n: FakeNode) =>
    (n.children[0].ranges ?? [])
      .filter(
        (x: { m: string; v: { color: { b: number } }[] }) =>
          x.m === "setRangeFills" && x.v[0].color.b === 1
      )
      .map((x: { s: number; e: number }) => [x.s, x.e]);
  expect(spans(hover)).toEqual([
    [0, 2],
    [3, 5],
  ]);
  expect(spans(dflt)).toEqual([]);
});

test("a component that cannot be sized does not stop the rest being placed", async () => {
  const f = fakeFigma();
  const real = (f.figma as unknown as { combineAsVariants: (...a: unknown[]) => FakeNode })
    .combineAsVariants;
  let first = true;
  (f.figma as unknown as Record<string, unknown>).combineAsVariants = (...a: unknown[]) => {
    const set = real(...a);
    if (first) {
      first = false;
      set.resize = () => {
        throw new Error("refused");
      };
    }
    return set;
  };
  const a = createApplier(f.figma);
  await a.begin(meta);
  const hover = [{ path: [], fills: blueFill }];
  await a.applyBatch([
    main("x-a", { component: { key: "x-a", name: "x-a", hover } }),
    main("x-b", { component: { key: "x-b", name: "x-b", hover } }),
    frame("root"),
  ]);
  const r = await a.end();
  expect(r).toMatchObject({ hoverVariants: 2, layoutFailures: 1 });
  const second = setsOf(f).find((n) => n.name === "x-b") as FakeNode;
  expect(second.width).toBe(224);
  expect(second.x).toBeGreaterThan(40);
});
