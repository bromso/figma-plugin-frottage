import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode, TokenRefs } from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { bindLayers } from "../bind";
import { buildCatalogue } from "../catalogue";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

type FrameOp = Extract<PlanOp, { op: "frame" }>;

const rgba = (css: string) => parseCssColor(css) as NonNullable<ReturnType<typeof parseCssColor>>;

/** Stock shadcn on Tailwind v4, trimmed: the root's values, the authored ones and `.dark`. */
function shadcnTokens(): Capture["tokens"] {
  return {
    cssCustomProperties: {
      "--radius": ".625rem",
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.145 0 0)",
      "--card": "oklch(1 0 0)",
      "--popover": "oklch(1 0 0)",
      "--border": "oklch(0.922 0 0)",
      "--spacing": ".25rem",
      "--color-gray-200": "oklch(0.928 0.006 264.531)",
      "--color-background": "oklch(1 0 0)",
      "--color-card": "oklch(1 0 0)",
      "--color-popover": "oklch(1 0 0)",
      "--radius-lg": ".625rem",
      "--tw-ring-color": "#fff",
    },
    authored: {
      "--color-background": "var(--background)",
      "--color-card": "var(--card)",
      "--color-popover": "var(--popover)",
      "--radius-lg": "var(--radius)",
    },
    themes: [
      {
        context: ".dark",
        mode: "Dark",
        properties: {
          "--background": "oklch(0.145 0 0)",
          "--foreground": "oklch(0.985 0 0)",
          "--card": "oklch(0.205 0 0)",
          "--popover": "oklch(0.205 0 0)",
          "--border": "oklch(1 0 0 / 10%)",
        },
      },
    ],
  };
}

/** A frame filled with `css`, with these refs. */
function painted(id: string, css: string, refs?: TokenRefs, over: Partial<ElementNode> = {}) {
  const base = el(id, [0, 0], [], over);
  return {
    ...base,
    style: { ...base.style, backgroundColor: rgba(css), ...over.style },
    ...(refs ? { tokenRefs: refs } : {}),
  };
}

const LAYERED = { ...DEFAULT_IMPORT_OPTIONS, components: false, layers: true };

function plan(children: CaptureNode[], tokens = shadcnTokens(), options = LAYERED): LayerPlan {
  const capture = cap(el("root", [0, 0], children));
  capture.source.url = "https://mainline.example.com/";
  capture.tokens = tokens;
  return mapCapture(capture, inter, options);
}

const frame = (p: LayerPlan, id: string) =>
  p.ops.find((o): o is FrameOp => o.op === "frame" && o.id === id) as FrameOp;

const fillOf = (p: LayerPlan, id: string) => frame(p, id).fills[0] as Record<string, unknown>;

describe("bindLayers", () => {
  test("two white frames bind to the variables their refs name", () => {
    const p = plan([
      painted("a", "oklch(1 0 0)", { background: "--color-card" }),
      painted("b", "oklch(1 0 0)", { background: "--color-popover" }),
    ]);
    expect(fillOf(p, "a").colorKey).toBe("theme:card");
    expect(fillOf(p, "b").colorKey).toBe("theme:popover");
    expect(p.tokens.layers?.modes).toEqual(["Light", "Dark"]);
  });

  test("a colour equal to exactly one theme Light value binds to it", () => {
    const p = plan([painted("a", "oklch(0.145 0 0)")]);
    expect(fillOf(p, "a").colorKey).toBe("theme:foreground");
    expect(p.report.raw?.colors).toBe(0);
  });

  test("a colour equal to two theme variables and with no ref stays raw", () => {
    const tokens = shadcnTokens();
    delete tokens.cssCustomProperties["--background"];
    delete tokens.cssCustomProperties["--color-background"];
    const p = plan([painted("a", "oklch(1 0 0)")], tokens);
    expect(fillOf(p, "a").colorKey).toBeUndefined();
    expect(p.report.raw?.colors).toBe(1);
  });

  test("a stroke binds to a variable with alpha in Dark and keeps its captured opacity", () => {
    const side = { width: 1, style: "solid", color: rgba("oklch(1 0 0 / 10%)") };
    const base = el("a", [0, 0]);
    const node = {
      ...base,
      style: { ...base.style, borders: { top: side, right: side, bottom: side, left: side } },
      tokenRefs: { border: "--border" },
    };
    const p = plan([node]);
    const stroke = frame(p, "a").strokes;
    expect(stroke?.colorKey).toBe("theme:border");
    expect(stroke?.opacity).toBeCloseTo(0.1, 4);
  });

  test("a radius ref on all corners gives four radius keys", () => {
    const base = el("a", [0, 0]);
    const node = {
      ...base,
      style: { ...base.style, borderRadius: [10, 10, 10, 10] as [number, number, number, number] },
      tokenRefs: { radius: "--radius-lg" },
    };
    const p = plan([node]);
    const key = "primitives:radius/lg";
    expect(frame(p, "a").radiusKeys).toEqual([key, key, key, key]);
    expect(p.report.raw?.radii).toBe(0);
  });

  test("p-4 binds all four sides to spacing/4", () => {
    const child = textNode("t", { box: { x: 16, y: 16, w: 68, h: 20 } });
    const base = el("a", [0, 0], [child], {}, [100, 52]);
    const node: ElementNode = {
      ...base,
      layout: {
        ...base.layout,
        display: "flex",
        flexDirection: "column",
        flexWrap: "nowrap",
        justifyContent: "normal",
        alignItems: "flex-start",
        gap: [0, 0],
        padding: [16, 16, 16, 16],
      },
      tokenRefs: { padding: ["--spacing*4", "--spacing*4", "--spacing*4", "--spacing*4"] },
    };
    const p = plan([node]);
    const layout = frame(p, "a").layout;
    const key = "primitives:spacing/4";
    expect("spacingKeys" in layout && layout.spacingKeys?.padding).toEqual([key, key, key, key]);
    expect(p.tokens.layers?.variables.find((v) => v.key === key)?.values).toEqual([16]);
  });

  test("a length that doesn't hold the ref's value doesn't take it", () => {
    const base = el("a", [0, 0]);
    const node = {
      ...base,
      style: { ...base.style, borderRadius: [4, 4, 4, 4] as [number, number, number, number] },
      tokenRefs: { radius: "--radius-lg" },
    };
    const p = plan([node]);
    expect(frame(p, "a").radiusKeys).toBeUndefined();
    expect(p.report.raw?.radii).toBe(4);
  });

  test("a text run binds through its node's colour ref", () => {
    const text = textNode("t", {
      runs: [run({ color: rgba("oklch(0.145 0 0)") })],
      tokenRefs: { color: "--foreground" },
    });
    const p = plan([text]);
    const op = p.ops.find((o) => o.op === "text");
    expect(op?.op === "text" && op.runs[0]?.colorKey).toBe("theme:foreground");
  });

  test("only primitives that are bound stay; the rest are dropped and counted", () => {
    const tokens: Capture["tokens"] = {
      cssCustomProperties: {
        "--card": "#ffffff",
        "--color-gray-200": "#e5e7eb",
        "--radius-lg": "10px",
      },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "#111111" } }],
    };
    const base = el("a", [0, 0]);
    const node = {
      ...base,
      style: { ...base.style, borderRadius: [10, 10, 10, 10] as [number, number, number, number] },
      tokenRefs: { radius: "--radius-lg" },
    };
    const p = plan([node], tokens);
    const keys = p.tokens.layers?.variables.map((v) => v.key);
    expect(keys).toEqual(["primitives:radius/lg", "theme:card"]);
    expect(p.tokens.layers?.notes.droppedPrimitives).toBe(1);
  });

  test("a primitive a theme value aliases stays", () => {
    const tokens: Capture["tokens"] = {
      cssCustomProperties: { "--gray-900": "#111111", "--card": "#ffffff" },
      authored: {},
      themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "var(--gray-900)" } }],
    };
    const p = plan([], tokens);
    expect(p.tokens.layers?.variables.map((v) => v.key)).toContain("primitives:gray-900");
    expect(p.tokens.layers?.notes.droppedPrimitives).toBe(0);
  });

  test("the layered path leaves colours and spacing empty and reports the modes", () => {
    const p = plan([painted("a", "oklch(1 0 0)", { background: "--color-card" })]);
    expect(p.tokens.colors).toEqual([]);
    expect(p.tokens.spacing).toEqual([]);
    expect(p.report.themeModes).toEqual(["Light", "Dark"]);
    expect(p.report.raw).toEqual({ colors: 0, radii: 0, spacing: 0 });
  });

  test("no refs remain on any op or run of the plan", () => {
    const text = textNode("t", { tokenRefs: { color: "--foreground" } });
    const p = plan([painted("a", "oklch(1 0 0)", { background: "--color-card" }, {}), text]);
    expect(JSON.stringify(p.ops)).not.toContain('"refs"');
    expect(p.ops.some((o) => "refs" in o)).toBe(false);
  });

  test("without the layers option the plan is the single collection", () => {
    const p = plan([painted("a", "oklch(1 0 0)", { background: "--color-card" })], undefined, {
      ...LAYERED,
      layers: false,
    });
    expect(p.tokens.layers).toBeUndefined();
    expect(p.report.raw).toBeUndefined();
    expect(fillOf(p, "a").colorKey).toBeUndefined();
    expect(JSON.stringify(p.ops)).not.toContain('"refs"');
  });

  test("bindLayers can be called on ops directly", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = shadcnTokens();
    const op: PlanOp = {
      op: "frame",
      id: "f",
      parent: null,
      name: "F",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      strokes: null,
      radius: [0, 0, 0, 0],
      opacity: 1,
      effects: [],
      clips: false,
      layout: { mode: "NONE" },
      childCount: 0,
      refs: { background: "--card" },
    };
    const { layers, raw } = bindLayers(buildCatalogue(capture), [op]);
    expect((op.fills[0] as { colorKey?: string }).colorKey).toBe("theme:card");
    expect(raw).toEqual({ colors: 0, radii: 0, spacing: 0 });
    expect(layers.themeSource).toBe("site");
    expect(layers.effectStyles).toEqual([]);
  });
});
