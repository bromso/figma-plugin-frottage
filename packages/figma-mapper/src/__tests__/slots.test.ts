import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode } from "@repo/capture-schema";
import { type DeviceEntry, mergeDevices } from "../devices";
import { mapCaptureParts } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

const ON = { ...DEFAULT_IMPORT_OPTIONS, components: true, layers: true };
const SIZES = { Laptop: [1512, 982], Phone: [390, 844] } as const;
const white = { r: 1, g: 1, b: 1, a: 1 };

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type InstanceOp = Extract<PlanOp, { op: "instance" }>;

const device = (name: string, height: number): Capture["version"] => ({
  label: name,
  kind: "viewport",
  device: { id: name.toLowerCase().replaceAll(" ", "-"), name, height },
});

function on(
  name: keyof typeof SIZES,
  children: CaptureNode[],
  language?: Capture["language"]
): DeviceEntry {
  const [width, height] = SIZES[name];
  const capture = cap(el("root", [0, 0], children, { semantic: { tag: "body" } }));
  capture.source.url = language?.url ?? "https://mainline.example.com/";
  if (language) capture.language = language;
  capture.source.viewport.w = width;
  capture.version = device(name, height);
  capture.breakpoints = { widths: [640, 768, 1024, 1280, 1400], unreadable: 0 };
  capture.tokens = { cssCustomProperties: {} };
  return { capture, ...mapCaptureParts(capture, inter, ON) };
}

const LINE = 16;

function words(id: string, text: string, x: number, y: number): CaptureNode {
  return textNode(id, {
    text,
    box: { x, y, w: 80, h: LINE },
    lines: [{ x, y, w: 80, h: LINE }],
    runs: [run({ end: text.length })],
  });
}

/** A flex column at `at`, `size` big, with `gap` between its children and `pad` round them. */
function column(
  id: string,
  at: [number, number],
  size: [number, number],
  children: CaptureNode[],
  { gap = 0, pad = 0, over = {} }: { gap?: number; pad?: number; over?: Partial<ElementNode> } = {}
): ElementNode {
  const base = el(id, at);
  return el(
    id,
    at,
    children,
    {
      layout: {
        display: "flex",
        flexDirection: "column",
        flexWrap: "nowrap",
        justifyContent: "normal",
        alignItems: "stretch",
        gap: [gap, gap],
        position: "static",
        padding: [pad, pad, pad, pad],
        margin: [0, 0, 0, 0],
        order: 0,
        grow: 0,
        shrink: 1,
      },
      style: { ...base.style, backgroundColor: white },
      ...over,
    },
    size
  );
}

/**
 * A coded CardContent: a title over a list of features, the list as long as the card has
 * features. `listGap` sets the list's own gap, which is the slot layer's look.
 */
function content(id: string, features: string[], listGap = 4, pad = 24): ElementNode {
  const name = "CardContent";
  const listH = features.length * LINE + Math.max(0, features.length - 1) * listGap;
  const list = column(
    `${id}-list`,
    [pad, pad + LINE + 12],
    [192, listH],
    features.map((f, i) => words(`${id}-f${i}`, f, pad, pad + LINE + 12 + i * (LINE + listGap))),
    { gap: listGap }
  );
  return column(
    id,
    [0, 0],
    [240, 2 * pad + LINE + 12 + listH],
    [words(`${id}-t`, id, pad, pad), list],
    { gap: 12, pad, over: { component: { source: "react", name, props: {} } } }
  );
}

const instancesOf = (plan: LayerPlan) =>
  plan.ops.filter((o): o is InstanceOp => o.op === "instance");
const mainsOf = (ops: PlanOp[]) =>
  ops.filter((o): o is FrameOp => o.op === "frame" && o.parent === null && !!o.component);

describe("slots", () => {
  test("two card contents with different features are one component with a slot", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["One", "Two", "Three"])]),
    ]);
    const [laptop] = merge.plans;
    expect(instancesOf(laptop as LayerPlan).map((o) => o.key)).toEqual([
      "component:CardContent",
      "component:CardContent",
    ]);
    expect(merge.report.some((line) => line.includes("look different"))).toBe(false);
  });

  test("a layer that differs in itself puts the slot in its parent", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["One", "Two", "Three"], 10)]),
    ]);
    const [, b] = instancesOf(merge.plans[0] as LayerPlan);
    // The list's own gap differs, so the slot holds the title and the list.
    expect(b?.slots).toEqual([{ path: [0], id: `${b?.id}#slot0` }]);
  });

  test("an occurrence whose root looks different still stays as it is", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["One", "Two", "Three"], 4, 16)]),
    ]);
    expect(merge.report).toContain(
      "1 card content looks different from its CardContent component and stays as it is."
    );
  });

  test("occurrences that differ only in text join with text overrides and no slot", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["Uno", "Dos"])]),
    ]);
    const ops = [...merge.components, ...(merge.plans[0] as LayerPlan).ops];
    expect(ops.some((o) => o.op === "frame" && o.slot)).toBe(false);
    const [, b] = instancesOf(merge.plans[0] as LayerPlan);
    expect(b?.slots).toBeUndefined();
    // The title is the Label property; the features are text overrides.
    expect(b?.properties).toEqual({ Label: "b" });
    expect(b?.overrides.filter((o) => o.kind === "text")).toHaveLength(2);
  });

  test("the main holds a slot with its first occurrence's layers; each instance fills its own", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["One", "Two", "Three"])]),
    ]);
    const defs = merge.components;
    const [main] = mainsOf(defs);
    expect(main?.component?.key).toBe("component:CardContent");
    const slot = defs.find((o): o is FrameOp => o.op === "frame" && o.slot === true);
    expect(slot?.name).toBe("Content");
    const list = defs.find((o) => o.id === slot?.parent) as FrameOp;
    expect(list.childCount).toBe(1);
    expect(defs.filter((o) => o.parent === slot?.id).map((o) => o.op)).toEqual(["text", "text"]);

    const ops = (merge.plans[0] as LayerPlan).ops;
    const [a, b] = instancesOf(merge.plans[0] as LayerPlan);
    // The occurrence the main was made from shows the main's own content.
    expect(a?.slots).toBeUndefined();
    expect(b?.slots).toEqual([{ path: [1, 0], id: `${b?.id}#slot0` }]);
    const filled = ops.filter((o) => o.parent === `${b?.id}#slot0`);
    expect(filled.map((o) => (o.op === "text" ? o.text : o.op))).toEqual(["One", "Two", "Three"]);
    // Content sits in the slot, which starts where the list did.
    expect(filled.map((o) => o.y)).toEqual([0, 20, 40]);
    // Nothing in the slot is an override.
    expect(b?.overrides.every((o) => o.path[0] !== 1)).toBe(true);
  });

  test("a card holding card contents fills the nested slot through its own instance", () => {
    const card = (id: string, features: string[]) =>
      column(id, [0, 0], [242, 200], [content(`${id}-c`, features)], {
        over: { component: { source: "react", name: "Card", props: {} } },
      });
    const merge = mergeDevices([
      on("Laptop", [card("a", ["One", "Two"]), card("b", ["One", "Two", "Three"])]),
    ]);
    expect(merge.report.some((line) => line.includes("look different"))).toBe(false);
    const plan = merge.plans[0] as LayerPlan;
    const cards = instancesOf(plan).filter((o) => o.key === "component:Card");
    expect(cards).toHaveLength(2);
    const b = cards[1] as InstanceOp;
    expect(b.slots).toEqual([{ path: [0, 1, 0], id: `${b.id}#slot0` }]);
    const filled = plan.ops.filter((o) => o.parent === `${b.id}#slot0`);
    expect(filled).toHaveLength(3);
    // Instances of a named component carry its name, in the page and in another's main.
    expect(cards.map((o) => o.name)).toEqual(["Card", "Card"]);
    const nested = merge.components.find((o) => o.op === "instance");
    expect(nested?.name).toBe("CardContent");
  });

  test("one layer styled differently is a different look, not content", () => {
    const red = { r: 1, g: 0, b: 0, a: 1 };
    const b = content("b", ["One", "Two"]);
    const title = b.children[0] as Extract<CaptureNode, { kind: "text" }>;
    title.runs = [run({ end: title.text.length, color: red })];
    const merge = mergeDevices([on("Laptop", [content("a", ["One", "Two"]), b])]);
    expect(merge.report).toContain(
      "1 card content looks different from its CardContent component and stays as it is."
    );
  });

  test("a label-only component never gets a slot", () => {
    const label = (id: string, texts: string[]) =>
      column(
        id,
        [0, 0],
        [80, texts.length * LINE],
        texts.map((t, i) => words(`${id}-${i}`, t, 0, i * LINE)),
        { over: { component: { source: "react", name: "Tag", props: {} } } }
      );
    const merge = mergeDevices([on("Laptop", [label("a", ["One"]), label("b", ["One", "Two"])])]);
    expect(merge.components.some((o) => o.op === "frame" && o.slot)).toBe(false);
    expect(merge.report).toContain(
      "1 tag looks different from its Tag component and stays as it is."
    );
  });

  test("an occurrence on another device joins with its slot filled", () => {
    const merge = mergeDevices([
      on("Laptop", [content("a", ["One", "Two"]), content("b", ["One", "Two"])]),
      on("Phone", [content("p", ["One", "Two", "Three"]), content("q", ["One"])]),
    ]);
    expect(merge.report.some((line) => line.includes("look different"))).toBe(false);
    const phone = instancesOf(merge.plans[1] as LayerPlan);
    expect(phone.map((o) => o.key)).toEqual(["component:CardContent", "component:CardContent"]);
    expect(phone.every((o) => o.slots?.length === 1)).toBe(true);
  });

  test("in two languages, every text in a nested slot binds its Language variable", () => {
    const en = {
      code: "en",
      name: "English",
      url: "https://mainline.example.com/en",
      current: true,
    };
    const sv = {
      code: "sv",
      name: "Svenska",
      url: "https://mainline.example.com/sv",
      current: false,
    };
    const card = (id: string, features: string[]) =>
      column(id, [0, 0], [242, 200], [content(`${id}-c`, features)], {
        over: { component: { source: "react", name: "Card", props: {} } },
      });
    // CardContent's main is the one standing alone, so the Card main's own fills its slot.
    const page = (words: string[]) => [
      content("s", words.slice(0, 1)),
      card("a", words.slice(0, 2)),
      card("b", words.slice(0, 3)),
    ];
    const merge = mergeDevices([
      on("Laptop", page(["One", "Two", "Three"]), en),
      on("Laptop", page(["Ett", "Två", "Tre"]), sv),
    ]);
    const texts = [...merge.components, ...(merge.plans[0] as LayerPlan).ops].filter(
      (o): o is Extract<PlanOp, { op: "text" }> => o.op === "text"
    );
    const slotted = texts.filter((t) => t.parent.includes("#slot"));
    expect(slotted.some((t) => merge.components.includes(t))).toBe(true);
    for (const t of texts) expect(t.textKey).toBeDefined();
  });
});
