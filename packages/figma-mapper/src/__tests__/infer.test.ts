import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { nearTwins, primitiveName } from "../infer";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp, PlanVariable } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

type FrameOp = Extract<PlanOp, { op: "frame" }>;

const rgba = (css: string) => parseCssColor(css) as NonNullable<ReturnType<typeof parseCssColor>>;
const rgb = (css: string) => {
  const { r, g, b } = rgba(css);
  return { r, g, b };
};

const LAYERED = { ...DEFAULT_IMPORT_OPTIONS, components: false, layers: true };

/** A frame filled with `css`. */
function filled(id: string, css: string, over: Partial<ElementNode> = {}): ElementNode {
  const base = el(id, [0, 0], [], over);
  return { ...base, style: { ...base.style, backgroundColor: rgba(css) } };
}

/** A frame with a 1 px border in `css`. */
function bordered(id: string, css: string): ElementNode {
  const side = { width: 1, style: "solid", color: rgba(css) };
  const base = el(id, [0, 0]);
  return {
    ...base,
    style: { ...base.style, borders: { top: side, right: side, bottom: side, left: side } },
  };
}

/** `n` characters of text in `css`. */
function text(id: string, css: string, n: number): TextNode {
  return textNode(id, { text: "x".repeat(n), runs: [run({ end: n, color: rgba(css) })] });
}

function plan(children: CaptureNode[], tokens: Capture["tokens"] = { cssCustomProperties: {} }) {
  const root = filled("root", "#ffffff", { children });
  const capture = cap(root);
  capture.tokens = tokens;
  return mapCapture(capture, inter, LAYERED);
}

const button = (id: string) => filled(id, "#2563eb", { semantic: { tag: "button" } });

/** White page, `#111` on 90% of characters, `#e5e5e5` borders on 4 frames, 3 of 3 buttons blue. */
function plainPage(foreground = 90): CaptureNode[] {
  const rest = (100 - foreground) / 2;
  return [
    text("t1", "#111111", foreground),
    text("t2", "#737373", rest),
    text("t3", "#a3a3a3", rest),
    ...["b1", "b2", "b3", "b4"].map((id) => bordered(id, "#e5e5e5")),
    button("btn1"),
    button("btn2"),
    button("btn3"),
  ];
}

const theme = (p: LayerPlan) =>
  p.tokens.layers?.variables.filter((v) => v.collection === "theme") ?? [];

const frame = (p: LayerPlan, id: string) =>
  p.ops.find((o): o is FrameOp => o.op === "frame" && o.id === id) as FrameOp;

describe("inferTheme", () => {
  test("a plain page gives background, foreground, border and primary, and no muted", () => {
    const p = plan(plainPage());
    const layers = p.tokens.layers;
    expect(layers?.themeSource).toBe("inferred");
    expect(theme(p).map((v) => v.name)).toEqual(["background", "foreground", "border", "primary"]);
    expect(layers?.notes.inferred).toEqual(["background", "foreground", "border", "primary"]);
    for (const v of theme(p)) expect(v.description).toStartWith("Inferred: ");
    const fg = theme(p).find((v) => v.name === "foreground");
    expect(fg?.description).toBe("Inferred: used on 90% of body text");
    expect(theme(p).find((v) => v.name === "border")?.description).toBe(
      "Inferred: used on 100% of bordered frames"
    );
    expect(layers?.modes).toEqual(["Light"]);
    expect(fg?.values).toHaveLength(1);
  });

  test("layers bind to the inferred roles", () => {
    const p = plan(plainPage());
    const fill = frame(p, "btn1").fills[0] as { colorKey?: string };
    expect(fill.colorKey).toBe("theme:primary");
    expect(frame(p, "b1").strokes?.colorKey).toBe("theme:border");
    expect((frame(p, "root").fills[0] as { colorKey?: string }).colorKey).toBe("theme:background");
    const t = p.ops.find((o) => o.op === "text" && o.id === "t1");
    expect(t?.op === "text" && t.runs[0]?.colorKey).toBe("theme:foreground");
  });

  test("with 40% text coverage no foreground is inferred", () => {
    const p = plan([
      text("t1", "#111111", 40),
      text("t2", "#737373", 30),
      text("t3", "#a3a3a3", 30),
    ]);
    expect(theme(p).map((v) => v.name)).not.toContain("foreground");
    expect(theme(p).map((v) => v.name)).toContain("background");
  });

  test("a second text colour with lower contrast is muted-foreground", () => {
    const p = plan([text("t1", "#111111", 70), text("t2", "#737373", 30)]);
    const muted = theme(p).find((v) => v.name === "muted-foreground");
    expect(muted?.description).toBe("Inferred: used on 30% of body text");
  });

  test("a site with a theme block infers nothing", () => {
    const p = plan(plainPage(), {
      cssCustomProperties: { "--card": "#ffffff" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "#000000" } }],
    });
    expect(p.tokens.layers?.themeSource).toBe("site");
    expect(theme(p).map((v) => v.name)).toEqual(["card"]);
    expect(p.tokens.layers?.notes.inferred).toEqual([]);
  });

  test("a page whose layers bound to the site's own variables infers nothing", () => {
    const node = { ...filled("a", "#ff0000"), tokenRefs: { background: "--color-red" } };
    const p = plan([node, ...plainPage()], { cssCustomProperties: { "--color-red": "#ff0000" } });
    expect(p.tokens.layers?.themeSource).toBe("none");
    expect(theme(p)).toEqual([]);
  });

  test("a repeated colour that fills no role becomes a primitive named by family and step", () => {
    const green = ["g1", "g2", "g3"].map((id) => text(id, "#16a34a", 1));
    const p = plan([...plainPage(), ...green]);
    const v = p.tokens.layers?.variables.find((x) => x.collection === "primitives");
    expect(v?.name).toBe("color/green-350");
    expect(v?.description).toStartWith("Inferred: ");
    const t = p.ops.find((o) => o.op === "text" && o.id === "g1");
    expect(t?.op === "text" && t.runs[0]?.colorKey).toBe("primitives:color/green-350");
    // Only the two greys used once stay raw.
    expect(p.report.raw?.colors).toBe(2);
  });
});

describe("primitiveName", () => {
  test("names a colour by family and step", () => {
    expect(primitiveName(rgb("#ffffff"), new Set())).toBe("color/gray-50");
    expect(primitiveName(rgb("#111111"), new Set())).toBe("color/gray-800");
    expect(primitiveName(rgb("#2563eb"), new Set())).toBe("color/blue-450");
  });

  test("a taken name gets -2, then -3", () => {
    const taken = new Set(["color/gray-50"]);
    expect(primitiveName(rgb("#ffffff"), taken)).toBe("color/gray-50-2");
    taken.add("color/gray-50-2");
    expect(primitiveName(rgb("#fefefe"), taken)).toBe("color/gray-50-3");
  });
});

describe("nearTwins", () => {
  const colour = (name: string, css: string): PlanVariable => ({
    key: `primitives:${name}`,
    name,
    collection: "primitives",
    type: "COLOR",
    values: [{ ...rgba(css) }],
    description: `From the site: --${name}`,
    scopes: ["ALL_FILLS"],
  });

  test("#2563eb and #2564ea are near twins, and both say so", () => {
    const a = colour("brand", "#2563eb");
    const b = colour("brand-alt", "#2564ea");
    const c = colour("red", "#ff0000");
    expect(nearTwins([a, b, c])).toEqual([["primitives:brand", "primitives:brand-alt"]]);
    expect(a.description).toBe("From the site: --brand\nNear twin of brand-alt");
    expect(b.description).toBe("From the site: --brand-alt\nNear twin of brand");
    expect(c.description).toBe("From the site: --red");
  });

  test("near twins on a page stay two variables and are noted", () => {
    const p = plan(
      [
        { ...filled("a", "#2563eb"), tokenRefs: { background: "--color-brand" } },
        { ...filled("b", "#2564ea"), tokenRefs: { background: "--color-brand-alt" } },
      ],
      { cssCustomProperties: { "--color-brand": "#2563eb", "--color-brand-alt": "#2564ea" } }
    );
    const keys = p.tokens.layers?.variables.map((v) => v.key);
    expect(keys).toEqual(["primitives:color/brand", "primitives:color/brand-alt"]);
    expect(p.tokens.layers?.notes.twins).toEqual([
      ["primitives:color/brand", "primitives:color/brand-alt"],
    ]);
  });

  test("translucent colours and identical ones are not near twins", () => {
    const a = colour("a", "rgb(0 0 0 / 0.5)");
    const b = colour("b", "rgb(1 0 0 / 0.5)");
    const c = colour("c", "#ffffff");
    const d = colour("d", "#ffffff");
    expect(nearTwins([a, b, c, d])).toEqual([]);
  });
});
