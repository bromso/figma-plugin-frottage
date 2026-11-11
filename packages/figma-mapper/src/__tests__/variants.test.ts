import { describe, expect, test } from "bun:test";
import type { CaptureComponent, CaptureNode, ElementNode } from "@repo/capture-schema";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp } from "../plan";
import { extractVariantSets, type FoundComponent } from "../variants";
import { cap, el, inter, run, textNode } from "./fixtures";

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type InstanceOp = Extract<PlanOp, { op: "instance" }>;

const on = { ...DEFAULT_IMPORT_OPTIONS, components: true };

const white = { r: 1, g: 1, b: 1, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const red = { r: 1, g: 0, b: 0, a: 1 };

const row = (pad: number): Pick<ElementNode, "layout"> => ({
  layout: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "normal",
    alignItems: "flex-start",
    gap: [0, 0],
    position: "static",
    padding: [pad, pad, pad, pad],
    margin: [0, 0, 0, 0],
    order: 0,
    grow: 0,
    shrink: 1,
  },
});

const svg = (id: string, markup: string, x = 0, y = 0): CaptureNode => ({
  id,
  kind: "svg",
  box: { x, y, w: 16, h: 16 },
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "svg" },
  markup,
});

type ButtonOptions = {
  bg?: typeof white;
  /** Padding: an icon button has less. */
  pad?: number;
  label?: string;
  icon?: string;
  found?: Partial<CaptureComponent>;
};

/** A button as the probe finds it: a code component with props, a label and maybe an icon. */
function button(
  id: string,
  props: CaptureComponent["props"],
  { bg = white, pad = 16, label, icon, found = {} }: ButtonOptions = {}
): ElementNode {
  const base = el(id, [0, 0]);
  const text = label ?? id;
  const at = icon ? pad + 16 : pad;
  const children: CaptureNode[] = [
    ...(icon ? [svg(`${id}-i`, icon, pad, pad)] : []),
    textNode(`${id}-t`, {
      text,
      box: { x: at, y: pad, w: 40, h: 16 },
      lines: [{ x: at, y: pad, w: 40, h: 16 }],
      runs: [run({ end: text.length })],
    }),
  ];
  return el(
    id,
    [0, 0],
    children,
    {
      semantic: { tag: "button" },
      ...row(pad),
      style: { ...base.style, backgroundColor: bg },
      component: { source: "react", name: "Button", props, ...found },
    },
    [at + 40 + pad, 16 + 2 * pad]
  );
}

const plan = (children: CaptureNode[], options = on): LayerPlan =>
  mapCapture(cap(el("root", [0, 0], children)), inter, options);

const mains = (p: LayerPlan) =>
  p.ops.filter((o): o is FrameOp => o.op === "frame" && o.component !== undefined);
const variantNames = (p: LayerPlan, set: string) =>
  mains(p)
    .filter((m) => m.component?.set?.name === set)
    .map((m) => m.component?.name);
const instance = (p: LayerPlan, id: string) =>
  p.ops.find((o): o is InstanceOp => o.op === "instance" && o.id === id);
const main = (p: LayerPlan, key: string) => mains(p).find((m) => m.component?.key === key);
const below = (p: LayerPlan, id: string): PlanOp[] => {
  const kids = p.ops.filter((o) => o.parent === id);
  return [...kids, ...kids.flatMap((k) => below(p, k.id))];
};

/** The four Mainline-like buttons: outline/icon, outline, default, outline/icon. */
const mainline = () => [
  button("a", { variant: "outline", size: "icon" }, { bg: white, pad: 8, label: "A" }),
  button("b", { variant: "outline" }, { bg: white, label: "B" }),
  button("c", {}, { bg: black, label: "C" }),
  button("d", { variant: "outline", size: "icon" }, { bg: white, pad: 8, label: "D" }),
];

describe("a set from the page's components", () => {
  test("one variant per combination, a missing prop as default", () => {
    const p = plan(mainline());
    expect(variantNames(p, "Button")).toEqual([
      "Variant=outline, Size=icon",
      "Variant=outline, Size=default",
      "Variant=default, Size=default",
    ]);
    const first = main(p, "set:Button|Variant=outline, Size=icon");
    expect(first?.component?.set).toEqual({
      key: "set:Button",
      name: "Button",
      values: [
        ["Variant", "outline"],
        ["Size", "icon"],
      ],
    });
    expect(first?.name).toBe("Variant=outline, Size=icon");
  });

  test("every occurrence is an instance with its label", () => {
    const p = plan(mainline());
    const keys = ["a", "b", "c", "d"].map((id) => instance(p, id)?.key);
    expect(keys).toEqual([
      "set:Button|Variant=outline, Size=icon",
      "set:Button|Variant=outline, Size=default",
      "set:Button|Variant=default, Size=default",
      "set:Button|Variant=outline, Size=icon",
    ]);
    expect(["a", "b", "c", "d"].map((id) => instance(p, id)?.properties?.Label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    // The label is a property, so no text override says it again.
    expect(instance(p, "d")?.overrides).toEqual([]);
    expect(main(p, "set:Button|Variant=outline, Size=icon")?.component?.properties).toEqual([
      { type: "TEXT", name: "Label", path: [0], default: "A" },
    ]);
  });

  test("the report names the set and its properties", () => {
    const { report } = plan(mainline());
    expect(report.warnings).toContain("Button: 3 variants from the page's code (Variant, Size).");
    expect(report.components).toBe(3);
    expect(report.instances).toBe(4);
  });

  test("a button with the same props and another background stays as it is", () => {
    const p = plan([...mainline(), button("e", { variant: "outline" }, { bg: red, label: "E" })]);
    expect(instance(p, "e")).toBeUndefined();
    expect(p.ops.find((o) => o.id === "e")?.op).toBe("frame");
    expect(p.report.warnings).toContain(
      "1 button looks different from its Button variant and stays as it is."
    );
  });

  test("two that look different are counted together", () => {
    const p = plan([
      ...mainline(),
      button("e", { variant: "outline" }, { bg: red }),
      button("f", { variant: "outline" }, { bg: red }),
    ]);
    expect(p.report.warnings).toContain(
      "2 buttons look different from their Button variant and stay as they are."
    );
  });

  test("a component that occurs once stays plain layers", () => {
    const card = el("card", [0, 0], [textNode("t")], {
      component: { source: "react", name: "Card", props: {} },
    });
    const p = plan([card]);
    expect(mains(p)).toEqual([]);
    expect(p.ops.find((o) => o.id === "card")?.op).toBe("frame");
  });

  test("a static button with only its data-slot joins the variant it looks like", () => {
    const p = plan([
      ...mainline(),
      button("s", {}, { bg: white, label: "S", found: { source: "marker" } }),
    ]);
    expect(instance(p, "s")?.key).toBe("set:Button|Variant=outline, Size=default");
    expect(instance(p, "s")?.properties?.Label).toBe("S");
  });

  test("a static button that looks like none stays as it is", () => {
    const p = plan([...mainline(), button("s", {}, { bg: red, found: { source: "marker" } })]);
    expect(instance(p, "s")).toBeUndefined();
    expect(p.report.warnings).toContain(
      "1 button looks different from its Button variant and stays as it is."
    );
  });

  test("a prop that changes nothing in the look is no variant property", () => {
    const items = [0, 1, 2].map((i) =>
      el(`i${i}`, [0, 0], [textNode(`i${i}-t`, { text: `Item ${i}` })], {
        component: { source: "react", name: "CarouselItem", props: { index: i } },
      })
    );
    const p = plan(items);
    // No variant property leaves nothing to choose: a plain component, and no set line.
    const made = main(p, "component:CarouselItem");
    expect(made?.name).toBe("CarouselItem");
    expect(made?.component?.set).toBeUndefined();
    expect(["i0", "i1", "i2"].map((id) => instance(p, id)?.key)).toEqual([
      "component:CarouselItem",
      "component:CarouselItem",
      "component:CarouselItem",
    ]);
    expect(p.report.warnings.some((w) => w.startsWith("CarouselItem:"))).toBe(false);
  });

  test("a boolean prop missing elsewhere is false", () => {
    const p = plan([
      button("a", { variant: "outline" }),
      button("b", { variant: "outline", disabled: true }, { bg: red }),
    ]);
    // Variant is outline everywhere, so it is no property.
    expect(variantNames(p, "Button")).toEqual(["Disabled=false", "Disabled=true"]);
  });
});

describe("names from markers", () => {
  test("a set named by a data-slot is counted, and a replaced code name said once", () => {
    const found = { codeName: "d" };
    const p = plan([
      button("a", { variant: "outline" }, { found }),
      button("b", { variant: "outline" }, { found }),
    ]);
    expect(p.report.warnings).toContain("1 component named by shadcn markers.");
    expect(
      p.report.warnings.filter(
        (w) => w === 'A component named "d" in the code was named Button from its data-slot.'
      )
    ).toHaveLength(1);
  });

  test("a readable code name says neither", () => {
    const p = plan([button("a", { variant: "outline" }), button("b", { variant: "outline" })]);
    expect(p.report.warnings.some((w) => w.includes("shadcn"))).toBe(false);
    expect(p.report.warnings.some((w) => w.includes("data-slot"))).toBe(false);
  });
});

const arrow = '<svg data-icon="arrow-right"><path d="M0 0L1 1"/></svg>';
const plus = '<svg class="lucide lucide-plus size-4"><path d="M0 1L1 0"/></svg>';

describe("icons", () => {
  test("two icon buttons with different svgs give an Icon swap and two icon components", () => {
    const p = plan([
      button("a", { size: "icon" }, { icon: arrow }),
      button("b", { size: "icon" }, { icon: plus }),
    ]);
    const icons = mains(p).filter((m) => m.component?.key.startsWith("icon:"));
    expect(icons.map((m) => m.component?.name)).toEqual(["arrow-right", "lucide-plus"]);
    const [first, second] = icons.map((m) => m.component?.key as string);
    expect(first).toMatch(/^icon:[0-9a-f]{8}$/);
    expect(second).toMatch(/^icon:[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
    const variant = main(p, "component:Button") as FrameOp;
    expect(variant.component?.properties).toContainEqual({
      type: "INSTANCE_SWAP",
      name: "Icon",
      path: [0],
      default: first,
    });
    // The main shows its icon as an instance of the icon component.
    expect(below(p, variant.id).find((o) => o.op === "instance")).toMatchObject({ key: first });
    expect(instance(p, "a")?.properties?.Icon).toBe(first);
    expect(instance(p, "b")?.properties?.Icon).toBe(second);
  });

  test("an icon's key is its markup's, whatever else the page holds", () => {
    const alone = plan([
      button("a", { size: "icon" }, { icon: plus }),
      button("b", { size: "icon" }, { icon: arrow }),
    ]);
    const before = plan([
      button("x", { size: "icon" }, { icon: arrow }),
      button("y", { size: "icon" }, { icon: plus }),
    ]);
    expect(instance(alone, "a")?.properties?.Icon).toBe(
      instance(before, "y")?.properties?.Icon as string
    );
  });

  test("the same svg everywhere is no Icon property", () => {
    const p = plan([
      button("a", { size: "icon" }, { icon: arrow }),
      button("b", { size: "icon" }, { icon: arrow }),
    ]);
    expect(mains(p).some((m) => m.component?.key.startsWith("icon:"))).toBe(false);
    expect(instance(p, "b")?.properties?.Icon).toBeUndefined();
  });

  test("an icon some buttons have and others don't is Show icon, the main holding it", () => {
    const p = plan([
      button("a", { variant: "outline" }, { label: "A" }),
      button("b", { variant: "outline" }, { label: "B", icon: arrow }),
    ]);
    const variant = main(p, "component:Button") as FrameOp;
    expect(variant.component?.properties).toEqual([
      { type: "TEXT", name: "Label", path: [1], default: "B" },
      { type: "BOOLEAN", name: "Show icon", path: [0], default: true },
    ]);
    expect(below(p, variant.id).filter((o) => o.parent === variant.id)).toHaveLength(2);
    expect(instance(p, "a")?.properties).toEqual({ Label: "A", "Show icon": false });
    expect(instance(p, "b")?.properties).toEqual({ Label: "B", "Show icon": true });
  });
});

describe("an occurrence without the main's icon", () => {
  const pair = () => [
    button("a", { variant: "outline" }, { label: "A" }),
    button("b", { variant: "outline" }, { label: "B", icon: arrow }),
  ];

  test("names its text by the main's path, past the hidden icon", () => {
    const capture = cap(el("root", [0, 0], pair()));
    const language = { code: "en", name: "English", url: "https://example.com", current: true };
    const p = mapCapture({ ...capture, language }, inter, on);
    expect(instance(p, "a")?.overrides).toEqual([
      expect.objectContaining({ path: [1], kind: "text", text: "A", source: "a-t" }),
    ]);
  });

  test("gives its hover to the main at the main's paths", () => {
    const [a, b] = pair() as [ElementNode, ElementNode];
    const hovered = {
      ...a,
      hover: { backgroundColor: red },
    };
    const p = mapCapture(cap(el("root", [0, 0], [hovered, b])), inter, {
      ...on,
      hoverComponents: true,
    });
    const variant = main(p, "component:Button") as FrameOp;
    expect(variant.component?.hover).toEqual([
      { path: [], fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }] },
    ]);
  });
});

describe("a component inside another (Review Focus 5)", () => {
  const card = (id: string, inner: ElementNode) =>
    el(id, [0, 0], [inner], {
      semantic: { tag: "div" },
      component: { source: "react", name: "Card", props: {} },
    });

  test("the Card main holds a Button instance; each Card keeps its own button", () => {
    const p = plan([
      card("c1", button("b1", { variant: "outline" }, { bg: white, label: "One" })),
      card("c2", button("b2", {}, { bg: black, label: "Two" })),
    ]);
    const cardMain = main(p, "component:Card") as FrameOp;
    expect(cardMain).toBeDefined();
    const inside = below(p, cardMain.id).find((o): o is InstanceOp => o.op === "instance");
    expect(inside?.key).toBe("set:Button|Variant=outline");
    expect(inside?.properties?.Label).toBe("One");
    const second = instance(p, "c2");
    expect(second?.key).toBe("component:Card");
    expect(second?.overrides).toContainEqual({
      path: [0],
      kind: "swap",
      key: "set:Button|Variant=default",
    });
    expect(second?.overrides).toContainEqual({
      path: [0],
      kind: "properties",
      properties: { Label: "Two" },
    });
    // Two Cards, and a Button in the Card main and in each of its two copies.
    expect(p.report.instances).toBe(5);
    // The Button mains come before the Card main that uses them.
    const order = mains(p).map((m) => m.component?.key);
    expect(order.indexOf("component:Card")).toBeGreaterThan(
      order.indexOf("set:Button|Variant=default")
    );
  });
});

describe("options", () => {
  test("components off makes no sets", () => {
    const p = plan(mainline(), { ...on, components: false });
    expect(mains(p)).toEqual([]);
  });

  test("with a language every instance text stays an override naming its text", () => {
    const capture = cap(el("root", [0, 0], mainline()));
    const language = { code: "en", name: "English", url: "https://example.com", current: true };
    const p = mapCapture({ ...capture, language }, inter, on);
    expect(instance(p, "d")?.overrides).toEqual([
      expect.objectContaining({ path: [0], kind: "text", text: "D", source: "d-t" }),
    ]);
    expect(instance(p, "d")?.properties?.Label).toBe("D");
  });
});

describe("extractVariantSets", () => {
  const frame = (id: string, parent: string | null, childCount: number): FrameOp => ({
    op: "frame",
    id,
    parent,
    name: id,
    x: 0,
    y: 0,
    w: 300,
    h: 100,
    fills: [],
    strokes: null,
    radius: [0, 0, 0, 0],
    opacity: 1,
    effects: [],
    clips: false,
    layout: {
      mode: "VERTICAL",
      wrap: false,
      itemSpacing: 0,
      counterSpacing: null,
      padding: [0, 0, 0, 0],
      primaryAlign: "MIN",
      counterAlign: "MIN",
      sizingH: "FIXED",
      sizingV: "HUG",
    },
    childCount,
  });
  const quote = (id: string, parent: string, w: number, text: string): PlanOp => ({
    op: "text",
    id,
    parent,
    name: text,
    x: 0,
    y: 0,
    w,
    h: 40,
    text,
    runs: [],
    align: "LEFT",
    wrap: true,
    lineCount: 2,
    childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "HUG" },
  });
  const item: FoundComponent = { source: "react", name: "CarouselItem", props: {} };

  test("text that fills its item compares no width: the instance lays it out again", () => {
    const ops = [
      frame("root", null, 2),
      frame("a", "root", 1),
      quote("a-t", "a", 247.36, "We're misusing it as a CRM"),
      frame("b", "root", 1),
      quote("b-t", "b", 232.38, "I replaced my team with bots"),
    ];
    const named = new Map([
      ["a", item],
      ["b", item],
    ]);
    const found = extractVariantSets(ops, named);
    expect(found.sets).toEqual([]);
    expect(found.plain).toEqual(["CarouselItem"]);
    expect(found.notJoined.size).toBe(0);
    expect(found.ops.filter((o) => o.op === "instance").map((o) => o.id)).toEqual(["a", "b"]);
  });

  test("text that hugs its lines compares neither height nor line count", () => {
    const hugging = (id: string, parent: string, lines: number): PlanOp => ({
      ...(quote(id, parent, 300, "Quote") as Extract<PlanOp, { op: "text" }>),
      h: 20 * lines,
      lineCount: lines,
    });
    const ops = [
      frame("root", null, 2),
      frame("a", "root", 1),
      hugging("a-t", "a", 2),
      frame("b", "root", 1),
      hugging("b-t", "b", 3),
    ];
    const named = new Map([
      ["a", item],
      ["b", item],
    ]);
    expect(extractVariantSets(ops, named).notJoined.size).toBe(0);
  });

  test("a card its grid row stretches is its hugging variant, resized by its parent", () => {
    const card: FoundComponent = { source: "react", name: "Card", props: {} };
    const hugging = (id: string): FrameOp => ({
      ...frame(id, "root", 1),
      childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "HUG" },
    });
    const stretched = (id: string, h: number): FrameOp => ({
      ...frame(id, "root", 1),
      h,
      layout: { ...(frame(id, "root", 1).layout as object), sizingV: "FIXED" } as FrameOp["layout"],
      childLayout: { positioning: "AUTO", sizingH: "FILL", sizingV: "FILL" },
    });
    const ops = [
      frame("root", null, 3),
      hugging("a"),
      quote("a-t", "a", 300, "One"),
      stretched("b", 180),
      quote("b-t", "b", 300, "Two"),
      stretched("c", 240),
      quote("c-t", "c", 300, "Three"),
    ];
    const named = new Map([
      ["a", card],
      ["b", card],
      ["c", card],
    ]);
    const found = extractVariantSets(ops, named);
    expect(found.notJoined.size).toBe(0);
    const instances = found.ops.filter((o): o is InstanceOp => o.op === "instance");
    expect(instances.map((o) => o.id)).toEqual(["a", "b", "c"]);
    // The parent's FILL sizes it; the main hugs, so no resize is needed.
    expect(instances.map((o) => o.childLayout?.sizingV)).toEqual(["HUG", "FILL", "FILL"]);
  });

  test("a root fixed at its own size is still another look from a hugging one", () => {
    const card: FoundComponent = { source: "react", name: "Card", props: {} };
    const fixed = (id: string): FrameOp => ({
      ...frame(id, "root", 1),
      layout: { ...(frame(id, "root", 1).layout as object), sizingV: "FIXED" } as FrameOp["layout"],
    });
    const ops = [
      frame("root", null, 3),
      frame("a", "root", 1),
      quote("a-t", "a", 300, "One"),
      frame("b", "root", 1),
      quote("b-t", "b", 300, "Two"),
      fixed("c"),
      quote("c-t", "c", 300, "Three"),
    ];
    const named = new Map([
      ["a", card],
      ["b", card],
      ["c", card],
    ]);
    expect(extractVariantSets(ops, named).notJoined.get("Card")).toBe(1);
  });

  test("markup with only a data-slot joins only at its variant's own size", () => {
    const fixed = (id: string, w: number): FrameOp => ({
      ...frame(id, "root", 0),
      w,
      layout: { ...(frame(id, "root", 0).layout as object), sizingV: "FIXED" } as FrameOp["layout"],
    });
    const ops = [frame("root", null, 3), fixed("a", 300), fixed("b", 300), fixed("s", 200)];
    const coded: FoundComponent = { source: "react", name: "Item", props: { variant: "x" } };
    const named = new Map([
      ["a", coded],
      ["b", coded],
      ["s", { source: "marker", name: "Item", props: {} } as FoundComponent],
    ]);
    expect(extractVariantSets(ops, named).notJoined.get("Item")).toBe(1);
  });

  test("nothing named leaves the ops as they are", () => {
    const ops = [frame("root", null, 1), frame("a", "root", 0)];
    expect(extractVariantSets(ops, new Map()).ops).toBe(ops);
  });
});

describe("fix round 1", () => {
  test("props that change the look together are both properties", () => {
    const p = plan([
      button("a", { variant: "destructive", size: "sm" }, { bg: red, label: "A" }),
      button("b", {}, { bg: white, label: "B" }),
    ]);
    expect(variantNames(p, "Button")).toEqual([
      "Variant=destructive, Size=sm",
      "Variant=default, Size=default",
    ]);
    expect(p.report.warnings).toContain("Button: 2 variants from the page's code (Variant, Size).");
  });

  test("a custom element holding differently labelled buttons is a structural component again", () => {
    const xcard = (id: string, inner: ElementNode) =>
      el(id, [0, 0], [inner], { semantic: { tag: "x-card" } });
    const p = plan([
      xcard("c1", button("b1", { variant: "outline" }, { label: "One" })),
      xcard("c2", button("b2", { variant: "outline" }, { label: "Two" })),
    ]);
    expect(instance(p, "c1")?.key).toBe("x-card#1");
    expect(instance(p, "c2")?.key).toBe("x-card#1");
    const held = below(p, "x-card#1/c1").find((o): o is InstanceOp => o.op === "instance");
    expect(held?.properties?.Label).toBe("One");
    expect(instance(p, "c2")?.overrides).toContainEqual({
      path: [0],
      kind: "properties",
      properties: { Label: "Two" },
    });
  });

  test("a component that looks different is named in words", () => {
    const item = (id: string, bg: typeof white) => {
      const base = el(id, [0, 0]);
      return el(id, [0, 0], [], {
        style: { ...base.style, backgroundColor: bg },
        component: { source: "react", name: "CarouselItem", props: {} },
      });
    };
    const p = plan([item("a", white), item("b", red)]);
    expect(p.report.warnings).toContain(
      "1 carousel item looks different from its CarouselItem component and stays as it is."
    );
  });

  test("two props that read as one property name keep the first seen", () => {
    const p = plan([
      button("a", { size: "sm", Size: "x" }, { bg: white }),
      button("b", { size: "lg", Size: "y" }, { bg: red }),
    ]);
    expect(variantNames(p, "Button")).toEqual(["Size=sm", "Size=lg"]);
    expect(p.report.warnings).toContain("Button: 2 variants from the page's code (Size).");
  });

  test("a set only markers name says so", () => {
    const marked = (id: string, variant: string, bg: typeof white) =>
      button(id, { variant }, { bg, found: { source: "marker" } });
    const p = plan([marked("a", "outline", white), marked("b", "default", red)]);
    expect(p.report.warnings).toContain("Button: 2 variants from the page's markers (Variant).");
  });
});

describe("fix round 2", () => {
  test("a prop the others already decide the look by is no property", () => {
    const p = plan([
      button("a", { variant: "outline", index: 0 }, { bg: white }),
      button("b", { variant: "default", index: 1 }, { bg: red }),
      button("c", { variant: "outline", index: 2 }, { bg: white }),
    ]);
    expect(p.report.warnings).toContain("Button: 2 variants from the page's code (Variant).");
  });

  test("text that wraps in auto layout compares no width", () => {
    const wrapping = (id: string, parent: string, w: number): PlanOp => ({
      op: "text",
      id,
      parent,
      name: "Question",
      x: 0,
      y: 0,
      w,
      h: 40,
      text: "Question",
      runs: [],
      align: "LEFT",
      wrap: true,
      lineCount: 2,
      childLayout: { positioning: "AUTO", sizingH: "FIXED", sizingV: "FIXED" },
    });
    const frame = (id: string, parent: string | null, childCount: number): PlanOp => ({
      op: "frame",
      id,
      parent,
      name: id,
      x: 0,
      y: 0,
      w: 300,
      h: 40,
      fills: [],
      strokes: null,
      radius: [0, 0, 0, 0],
      opacity: 1,
      effects: [],
      clips: false,
      layout: {
        mode: "HORIZONTAL",
        wrap: false,
        itemSpacing: 0,
        counterSpacing: null,
        padding: [0, 0, 0, 0],
        primaryAlign: "MIN",
        counterAlign: "MIN",
        sizingH: "FIXED",
        sizingV: "HUG",
      },
      childCount,
    });
    const ops = [
      frame("root", null, 2),
      frame("a", "root", 1),
      wrapping("a-t", "a", 253.58),
      frame("b", "root", 1),
      wrapping("b-t", "b", 244.53),
    ];
    const trigger: FoundComponent = { source: "react", name: "CollapsibleTrigger", props: {} };
    const named = new Map([
      ["a", trigger],
      ["b", trigger],
    ]);
    expect(extractVariantSets(ops, named).notJoined.size).toBe(0);
  });
});
