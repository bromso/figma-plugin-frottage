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

const rgbOf = (hex: string) => {
  const n = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5) };
};
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
    expect(fillOf(p, "a").colorKey).toBe("theme:color/card");
    expect(fillOf(p, "b").colorKey).toBe("theme:color/popover");
    expect(p.tokens.layers?.modes).toEqual(["Light", "Dark"]);
  });

  test("a colour equal to exactly one theme Light value binds to it", () => {
    const p = plan([painted("a", "oklch(0.145 0 0)")]);
    expect(fillOf(p, "a").colorKey).toBe("theme:color/foreground");
    expect(p.report.raw?.colors).toBe(0);
  });

  test("on a page captured dark, a colour binds by its Dark value and the page opens in Dark", () => {
    const tokens = shadcnTokens();
    const dark = tokens.themes?.[0]?.properties ?? {};
    const light: Record<string, string> = {};
    for (const [prop, value] of Object.entries(dark)) {
      light[prop] = tokens.cssCustomProperties[prop] as string;
      tokens.cssCustomProperties[prop] = value;
    }
    tokens.activeTheme = "Dark";
    tokens.base = light;
    // The dark background, with no ref: equal to exactly one theme variable's Dark value.
    const p = plan([painted("a", "oklch(0.145 0 0)")], tokens);
    expect(fillOf(p, "a").colorKey).toBe("theme:color/background");
    expect(p.tokens.layers?.activeMode).toBe("Dark");
    // Light is the light page's: white.
    const bg = p.tokens.layers?.variables.find((v) => v.key === "colorMode:color/background");
    const lightKey = (bg?.values[0] as { alias: string } | undefined)?.alias;
    const held = p.tokens.layers?.variables.find((v) => v.key === lightKey);
    expect(held?.values[0]).toMatchObject({ r: expect.closeTo(1, 4), g: expect.closeTo(1, 4) });
  });

  test("a page captured light opens in Light", () => {
    expect(plan([painted("a", "oklch(1 0 0)")]).tokens.layers?.activeMode).toBe("Light");
  });

  test("an unbound colour used three times is offered to the user's paint styles", () => {
    const blue = "#2563eb";
    const p = plan([
      painted("a", blue),
      painted("b", blue),
      painted("c", blue),
      painted("once", "#16a34a"),
      painted("card", "oklch(1 0 0)", { background: "--color-card" }),
    ]);
    const key = "paint:#2563eb";
    for (const id of ["a", "b", "c"]) expect(fillOf(p, id).colorKey).toBe(key);
    expect(fillOf(p, "once").colorKey).toBeUndefined();
    // A bound colour keeps its variable.
    expect(fillOf(p, "card").colorKey).toBe("theme:color/card");
    expect(p.tokens.layers?.styleColors).toEqual([
      { key, rgba: { ...rgbOf(blue), a: 1 }, uses: 3 },
    ]);
    // Still raw: no variable holds them.
    expect(p.report.raw?.colors).toBe(4);
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
    expect(stroke?.colorKey).toBe("theme:color/border");
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
    const key = "theme:radius/lg";
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
    const key = "theme:spacing/4";
    expect("spacingKeys" in layout && layout.spacingKeys?.padding).toEqual([key, key, key, key]);
    const raw = p.tokens.layers?.variables.find((v) => v.key === "spacing:spacing/4");
    expect(raw?.values).toEqual([16]);
    expect(p.tokens.layers?.variables.find((v) => v.key === key)?.values).toEqual([
      { alias: "spacing:spacing/4" },
    ]);
  });

  /** A p-4 column with a border of these widths on each side, [top, right, bottom, left]. */
  function bordered(widths: [number, number, number, number]) {
    const [t, r, b, l] = widths;
    const child = textNode("t", { box: { x: 16 + l, y: 16 + t, w: 68, h: 20 } });
    const base = el("a", [0, 0], [child], {}, [100 + l + r, 52 + t + b]);
    const side = (width: number) => ({ width, style: "solid", color: rgba("oklch(0.922 0 0)") });
    return {
      ...base,
      style: {
        ...base.style,
        borders: { top: side(t), right: side(r), bottom: side(b), left: side(l) },
      },
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
    } as ElementNode;
  }

  test("border p-4 binds its padding inside a uniform stroke, which counts in the layout", () => {
    const p = plan([bordered([1, 1, 1, 1])]);
    const layout = frame(p, "a").layout;
    const key = "theme:spacing/4";
    expect("spacingKeys" in layout && layout.spacingKeys?.padding).toEqual([key, key, key, key]);
    // The padding stays the inset from each edge; the applier takes the stroke out of it.
    expect("padding" in layout && layout.padding).toEqual([17, 17, 17, 17]);
    expect("strokesIncluded" in layout && layout.strokesIncluded).toBe(true);
    expect(p.report.raw?.spacing).toBe(0);
  });

  test("a stroke that differs by side leaves the padding as it was", () => {
    const p = plan([bordered([1, 2, 1, 1])]);
    const layout = frame(p, "a").layout;
    expect("spacingKeys" in layout ? layout.spacingKeys?.padding : undefined).toBeUndefined();
    expect("strokesIncluded" in layout).toBe(false);
  });

  test("a length named for nothing binds by its ref, never by value alone", () => {
    const tokens = shadcnTokens();
    tokens.cssCustomProperties["--blur-sm"] = "8px";
    const radiusOf = (id: string, refs?: TokenRefs) => {
      const base = el(id, [0, 0]);
      return {
        ...base,
        style: { ...base.style, borderRadius: [8, 8, 8, 8] as [number, number, number, number] },
        ...(refs ? { tokenRefs: refs } : {}),
      };
    };
    const p = plan([radiusOf("plain"), radiusOf("named", { radius: "--blur-sm" })], tokens);
    expect(frame(p, "plain").radiusKeys).toBeUndefined();
    const key = "theme:blur/sm";
    expect(frame(p, "named").radiusKeys).toEqual([key, key, key, key]);
    expect(p.report.raw?.radii).toBe(4);
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
    expect(op?.op === "text" && op.runs[0]?.colorKey).toBe("theme:color/foreground");
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
    expect(keys).toEqual([
      "palette:gray/50",
      "palette:gray/800",
      "radius:radius/lg",
      "colorMode:color/card",
      "theme:radius/lg",
    ]);
    expect(p.tokens.layers?.notes.droppedPrimitives).toBe(1);
  });

  test("a primitive a theme value aliases stays", () => {
    const tokens: Capture["tokens"] = {
      cssCustomProperties: { "--gray-900": "#111111", "--card": "#ffffff" },
      authored: {},
      themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "var(--gray-900)" } }],
    };
    const p = plan([], tokens);
    expect(p.tokens.layers?.variables.map((v) => v.key)).toContain("palette:gray/900");
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

describe("radii named by the site's classes", () => {
  type Four<T> = [T, T, T, T];
  /** Mainline's tokens: only `--radius`, every size a class's calc() of it. */
  const mainline = (): Capture["tokens"] => ({ cssCustomProperties: { "--radius": "8px" } });
  const rounded = (id: string, radius: Four<number>, refs?: TokenRefs) => {
    const base = el(id, [0, 0]);
    return {
      ...base,
      style: { ...base.style, borderRadius: radius },
      ...(refs ? { tokenRefs: refs } : {}),
    };
  };
  const all = <T>(v: T): Four<T> => [v, v, v, v];
  const chainOf = (p: LayerPlan, key: string | undefined) => {
    const vars = p.tokens.layers?.variables ?? [];
    let at = vars.find((v) => v.key === key);
    const chain: string[] = [];
    while (at) {
      chain.push(at.key);
      const value = at.values[0];
      if (typeof value === "object" && value !== null && "alias" in value) {
        const next: string = value.alias;
        at = vars.find((v) => v.key === next);
      } else return { value, chain };
    }
    return { value: undefined, chain };
  };

  test("md, 2xl and full bind to radius/<name> in Border radius through Theme tokens", () => {
    const FULL = 3.40282e38;
    const p = plan(
      [
        rounded("md", all(6), { radiusClass: all("md") }),
        rounded("top", [16, 16, 0, 0], { radiusClass: ["2xl", "2xl", null, null] }),
        rounded("pill", all(FULL), { radiusClass: all("full"), radius: "--radius*2" }),
      ],
      mainline()
    );
    expect(frame(p, "md").radiusKeys).toEqual(all("theme:radius/md"));
    expect(frame(p, "top").radiusKeys).toEqual([
      "theme:radius/2xl",
      "theme:radius/2xl",
      undefined,
      undefined,
    ]);
    expect(frame(p, "pill").radiusKeys).toEqual(all("theme:radius/full"));
    expect(chainOf(p, "theme:radius/md")).toEqual({
      value: 6,
      chain: ["theme:radius/md", "radius:radius/md"],
    });
    expect(chainOf(p, "theme:radius/2xl").value).toBe(16);
    expect(chainOf(p, "theme:radius/full").value).toBe(9999);
    const collections = p.tokens.layers?.collections.map((c) => c.name);
    expect(collections).toContain("Border radius");
    expect(p.tokens.layers?.variables.find((v) => v.key === "radius:radius/md")?.scopes).toEqual([
      "CORNER_RADIUS",
    ]);
    expect(p.report.raw?.radii).toBe(0);
  });

  test("bare rounded is radius/default, and any corner past 9999 px is 9999", () => {
    const p = plan(
      [
        rounded("a", all(4), { radiusClass: all("DEFAULT") }),
        rounded("b", all(1e6), { radiusClass: all("huge") }),
      ],
      mainline()
    );
    expect(frame(p, "a").radiusKeys).toEqual(all("theme:radius/default"));
    expect(chainOf(p, "theme:radius/default").value).toBe(4);
    expect(chainOf(p, "theme:radius/huge").value).toBe(9999);
  });

  test("a literal 6 px corner with no class binds to radius/md by its unique value", () => {
    const p = plan(
      [rounded("md", all(6), { radiusClass: all("md") }), rounded("plain", all(6))],
      mainline()
    );
    expect(frame(p, "plain").radiusKeys).toEqual(all("theme:radius/md"));
  });

  test("a name whose corners differ keeps the first value and is reported once", () => {
    const p = plan(
      [
        rounded("a", all(6), { radiusClass: all("md") }),
        rounded("b", all(7), { radiusClass: all("md") }),
        rounded("c", all(5), { radiusClass: all("md") }),
        rounded("d", all(16), { radiusClass: all("md"), radius: "--radius*2" }),
      ],
      mainline()
    );
    expect(frame(p, "a").radiusKeys).toEqual(all("theme:radius/md"));
    expect(frame(p, "b").radiusKeys).toBeUndefined();
    // One that differs goes on as a corner with no class would: here, by its ref.
    expect(frame(p, "d").radiusKeys).toEqual(all("theme:radius/x2"));
    expect(chainOf(p, "theme:radius/md").value).toBe(6);
    const said = p.report.warnings.filter((w) => w.includes("radius/md"));
    expect(said).toEqual(["radius/md has different values on this page."]);
  });

  test("a capture without radiusClass binds as before", () => {
    const p = plan([rounded("a", all(10), { radius: "--radius-lg" })]);
    expect(frame(p, "a").radiusKeys).toEqual(all("theme:radius/lg"));
    const p2 = plan([rounded("b", all(6))], mainline());
    expect(frame(p2, "b").radiusKeys).toBeUndefined();
    expect(p2.report.raw?.radii).toBe(4);
  });

  test("--radius*2 with no class resolves to radius/x2", () => {
    const p = plan([rounded("a", all(16), { radius: "--radius*2" })], mainline());
    expect(frame(p, "a").radiusKeys).toEqual(all("theme:radius/x2"));
    expect(chainOf(p, "theme:radius/x2")).toEqual({
      value: 16,
      chain: ["theme:radius/x2", "radius:radius/x2"],
    });
  });
});
