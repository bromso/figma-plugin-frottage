import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode, TokenRefs } from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

type FrameOp = Extract<PlanOp, { op: "frame" }>;

const rgba = (css: string) => parseCssColor(css) as NonNullable<ReturnType<typeof parseCssColor>>;

const LAYERED = { ...DEFAULT_IMPORT_OPTIONS, components: false, layers: true };

function plan(children: CaptureNode[], props: Record<string, string> = {}): LayerPlan {
  const capture = cap(el("root", [0, 0], children));
  capture.tokens = { cssCustomProperties: props } satisfies Capture["tokens"];
  return mapCapture(capture, inter, LAYERED);
}

const frame = (p: LayerPlan, id: string) =>
  p.ops.find((o): o is FrameOp => o.op === "frame" && o.id === id) as FrameOp;

const SHADOW = [
  { inset: false, x: 0, y: 1, blur: 3, spread: 0, color: rgba("rgb(0 0 0 / 0.1)") },
  { inset: false, x: 0, y: 1, blur: 2, spread: -1, color: rgba("rgb(0 0 0 / 0.1)") },
];

function shadowed(id: string, boxShadows = SHADOW): ElementNode {
  const base = el(id, [0, 0]);
  return { ...base, style: { ...base.style, boxShadows } };
}

const STOPS = [
  { color: rgba("#2563eb"), position: 0 },
  { color: rgba("#9333ea"), position: 1 },
];

function graded(id: string): ElementNode {
  const base = el(id, [0, 0]);
  const image = {
    type: "linear-gradient" as const,
    css: "linear-gradient()",
    angle: 90,
    stops: STOPS,
  };
  return { ...base, style: { ...base.style, backgroundImages: [image] } };
}

describe("effect styles", () => {
  test("three frames with the same shadow give one effect style", () => {
    const p = plan(["a", "b", "c"].map((id) => shadowed(id)));
    const styles = p.tokens.layers?.effectStyles ?? [];
    expect(styles).toHaveLength(1);
    const style = styles[0];
    expect(style?.name).toBe("shadow/1");
    expect(style?.shadows).toHaveLength(2);
    expect(style?.colorKeys).toEqual([null, null]);
    for (const id of ["a", "b", "c"]) expect(frame(p, id).effectStyleKey).toBe(style?.key);
  });

  test("two frames with a shadow give no effect style", () => {
    const p = plan(["a", "b"].map((id) => shadowed(id)));
    expect(p.tokens.layers?.effectStyles).toEqual([]);
    expect(frame(p, "a").effectStyleKey).toBeUndefined();
  });

  test("a --shadow-* property with the same shadows names the style", () => {
    const p = plan(
      ["a", "b", "c"].map((id) => shadowed(id)),
      {
        "--shadow-md": "0 4px 6px -1px rgb(0 0 0 / 0.1)",
        "--shadow-sm": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
      }
    );
    expect(p.tokens.layers?.effectStyles.map((s) => s.name)).toEqual(["shadow/sm"]);
  });

  test("a shadow colour binds to the colour variable equal to it", () => {
    const one = [{ ...(SHADOW[0] as (typeof SHADOW)[number]), color: rgba("#111111") }];
    const p = plan(
      ["a", "b", "c"].map((id) => shadowed(id, one)),
      { "--color-ink": "#111111" }
    );
    const style = p.tokens.layers?.effectStyles[0];
    expect(style?.colorKeys).toEqual(["theme:color/ink"]);
    expect(p.tokens.layers?.variables.map((v) => v.key)).toContain("palette:ink");
  });
});

describe("gradient styles", () => {
  test("two fills with the same gradient give one paint style", () => {
    const p = plan([graded("a"), graded("b")], { "--color-blue": "#2563eb" });
    const styles = p.tokens.layers?.gradientStyles ?? [];
    expect(styles).toHaveLength(1);
    expect(styles[0]?.name).toBe("gradient/1");
    expect(styles[0]?.paint.type).toBe("GRADIENT_LINEAR");
    expect(styles[0]?.stopKeys).toEqual(["theme:color/blue", null]);
    const fill = frame(p, "a").fills.find((f) => f.type === "GRADIENT_LINEAR");
    expect(fill && "gradientStyleKey" in fill && fill.gradientStyleKey).toBe(styles[0]?.key);
    expect(styles[0]?.paint).not.toHaveProperty("gradientStyleKey");
  });

  test("one gradient fill gives no paint style", () => {
    const p = plan([graded("a")]);
    expect(p.tokens.layers?.gradientStyles).toEqual([]);
  });
});

describe("text style bindings", () => {
  const TYPE = {
    "--text-sm": "0.875rem",
    "--text-sm--line-height": "calc(1.25 / 0.875)",
    "--leading-normal": "1.5",
    "--tracking-tight": "-0.025em",
    "--font-sans": "Inter, ui-sans-serif, system-ui",
    "--font-weight-semibold": "600",
  };

  function texts(refs: TokenRefs, weight = 400) {
    return ["t1", "t2", "t3"].map((id) =>
      textNode(id, {
        runs: [run({ size: 14, lineHeight: 21, weight })],
        tokenRefs: refs,
      })
    );
  }

  test("runs that all use --text-sm bind fontSize, and a line-height ratio stays unbound", () => {
    const p = plan(texts({ fontSize: "--text-sm", lineHeight: "--leading-normal" }), TYPE);
    const style = p.tokens.textStyles[0];
    expect(style?.bind).toEqual({ fontSize: "theme:text/sm" });
    expect(p.tokens.layers?.variables.map((v) => v.key)).toContain("typography:text/sm");
  });

  test("family and weight bind when they match the style's font", () => {
    const refs = { fontFamily: "--font-sans", fontWeight: "--font-weight-semibold" };
    const p = plan(texts(refs, 600), TYPE);
    expect(p.tokens.textStyles[0]?.bind).toEqual({
      fontFamily: "theme:font/sans",
      fontWeight: "theme:font-weight/semibold",
    });
  });

  test("em tracking stays unbound", () => {
    const p = plan(texts({ letterSpacing: "--tracking-tight" }), TYPE);
    expect(p.tokens.textStyles[0]?.bind).toBeUndefined();
  });

  test("runs that disagree leave the style unbound", () => {
    const [a, b, c] = texts({ fontSize: "--text-sm" });
    const other = { ...(c as ReturnType<typeof textNode>), tokenRefs: {} };
    const p = plan([a, b, other] as CaptureNode[], TYPE);
    expect(p.tokens.textStyles[0]?.bind).toBeUndefined();
  });
});
