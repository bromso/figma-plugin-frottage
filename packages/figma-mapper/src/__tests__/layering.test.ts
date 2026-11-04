import { describe, expect, test } from "bun:test";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { layerCollections, orderVariables } from "../layering";
import type {
  PlanEffectStyle,
  PlanGradientStyle,
  PlanOp,
  PlanTextStyle,
  PlanVariable,
  StagedCollection,
  StagedLayers,
} from "../plan";

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type TextOp = Extract<PlanOp, { op: "text" }>;

const white = { r: 1, g: 1, b: 1, a: 1 };
const dark = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const darker = { r: 0.2, g: 0.2, b: 0.2, a: 1 };
const gray = { r: 0.9, g: 0.91, b: 0.92, a: 1 };

const COLOR_SCOPES = ["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"];

function variable(
  collection: StagedCollection,
  name: string,
  type: PlanVariable["type"],
  values: PlanVariable<StagedCollection>["values"],
  scopes: string[]
): PlanVariable<StagedCollection> {
  return {
    key: `${collection}:${name}`,
    name,
    collection,
    type,
    values,
    description: `From the site: --${name.replace("/", "-")}`,
    scopes,
    cssVar: `--${name.replace("/", "-")}`,
  };
}

/** PR #7's two collections, as `bindLayers` leaves them. */
function staged(): StagedLayers {
  return {
    hostname: "example.com",
    modes: ["Light", "Dark"],
    activeMode: "Light",
    themeSource: "site",
    variables: [
      variable("primitives", "color/gray-200", "COLOR", [gray], COLOR_SCOPES),
      variable("primitives", "color/brand-primary", "COLOR", [dark], COLOR_SCOPES),
      variable("primitives", "spacing/4", "FLOAT", [16], ["GAP", "WIDTH_HEIGHT"]),
      variable("primitives", "spacing/8", "FLOAT", [32], ["GAP", "WIDTH_HEIGHT"]),
      variable("primitives", "radius/lg", "FLOAT", [10], ["CORNER_RADIUS"]),
      variable("primitives", "text/sm", "FLOAT", [14], ["FONT_SIZE"]),
      variable("theme", "card", "COLOR", [white, dark], COLOR_SCOPES),
      variable("theme", "popover", "COLOR", [white, darker], COLOR_SCOPES),
      variable("theme", "border", "COLOR", [gray, { ...white, a: 0.1 }], COLOR_SCOPES),
      variable(
        "theme",
        "ring",
        "COLOR",
        [{ alias: "primitives:color/gray-200" }, white],
        COLOR_SCOPES
      ),
    ],
    effectStyles: [],
    gradientStyles: [],
    styleColors: [{ key: "paint:#123456", rgba: dark, uses: 3 }],
    notes: { twins: [], inferred: [], droppedPrimitives: 0 },
  };
}

function frameOp(over: Partial<FrameOp> = {}): FrameOp {
  return {
    op: "frame",
    id: "f",
    parent: null,
    name: "Card",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    fills: [{ type: "SOLID", color: white, opacity: 1, colorKey: "theme:card" }],
    strokes: null,
    radius: [10, 10, 10, 10],
    radiusKeys: [
      "primitives:radius/lg",
      "primitives:radius/lg",
      "primitives:radius/lg",
      "primitives:radius/lg",
    ],
    opacity: 1,
    effects: [],
    clips: false,
    layout: {
      mode: "VERTICAL",
      wrap: false,
      itemSpacing: 16,
      counterSpacing: null,
      padding: [16, 16, 16, 16],
      primaryAlign: "MIN",
      counterAlign: "MIN",
      sizingH: "FIXED",
      sizingV: "FIXED",
      spacingKeys: {
        itemSpacing: "primitives:spacing/4",
        padding: [
          "primitives:spacing/4",
          "primitives:spacing/4",
          "primitives:spacing/4",
          "primitives:spacing/4",
        ],
      },
    },
    childCount: 1,
    ...over,
  };
}

function textOp(): TextOp {
  return {
    op: "text",
    id: "t",
    parent: "f",
    name: "Label",
    x: 0,
    y: 0,
    w: 50,
    h: 20,
    text: "Hi",
    runs: [
      {
        start: 0,
        end: 2,
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 14,
        lineHeight: null,
        letterSpacing: 0,
        color: dark,
        opacity: 1,
        decoration: "NONE",
        textCase: "ORIGINAL",
        colorKey: "theme:popover",
      },
    ],
    align: "LEFT",
    wrap: false,
    lineCount: 1,
  };
}

function textStyle(): PlanTextStyle {
  return {
    key: "type:inter-14",
    name: "body/1",
    fontName: { family: "Inter", style: "Regular" },
    fontSize: 14,
    lineHeight: null,
    letterSpacing: 0,
    decoration: "NONE",
    textCase: "ORIGINAL",
    uses: 3,
    bind: { fontSize: "primitives:text/sm" },
  };
}

function setup() {
  const ops: PlanOp[] = [frameOp(), textOp()];
  const textStyles = [textStyle()];
  const layers = layerCollections(staged(), { ops, textStyles });
  const v = (key: string) => layers.variables.find((x) => x.key === key);
  return { layers, ops, textStyles, v, frame: ops[0] as FrameOp, text: ops[1] as TextOp };
}

describe("layerCollections", () => {
  test("each collection lists numbered names smallest first, then the rest by value", () => {
    const space = (name: string, px: number) =>
      variable("primitives", `spacing/${name}`, "FLOAT", [px], ["GAP", "WIDTH_HEIGHT"]);
    const radius = (name: string, px: number) =>
      variable("primitives", `radius/${name}`, "FLOAT", [px], ["CORNER_RADIUS"]);
    const layers = staged();
    // First use, as the owner saw it: 2, 3, 4, 32, 6, 10, ...
    layers.variables = [
      ...["2", "3", "4", "32", "6", "10", "0_5", "1_5", "2_5", "1", "5"].map((n) =>
        space(n, Number(n.replace("_", ".")) * 4)
      ),
      space("section", 96),
      space("gutter", 24),
      radius("xl", 12),
      radius("sm", 4),
      radius("lg", 8),
      ...layers.variables.filter((v) => v.collection === "theme"),
    ];
    const out = layerCollections(layers, { ops: [], textStyles: [] });
    const names = (kind: string) =>
      out.variables.filter((v) => v.collection === kind).map((v) => v.name);
    expect(names("spacing")).toEqual([
      "spacing/0_5",
      "spacing/1",
      "spacing/1_5",
      "spacing/2",
      "spacing/2_5",
      "spacing/3",
      "spacing/4",
      "spacing/5",
      "spacing/6",
      "spacing/10",
      "spacing/32",
      "spacing/gutter",
      "spacing/section",
    ]);
    expect(names("radius")).toEqual(["radius/sm", "radius/lg", "radius/xl"]);
  });

  test("orderVariables keeps groups in first-use order, per-mode groups by the mode order", () => {
    const v = (name: string, value: number): PlanVariable => ({
      key: `typography:${name}`,
      name,
      collection: "typography",
      type: "FLOAT",
      values: [value],
      description: "",
      scopes: ["FONT_SIZE"],
    });
    const out = orderVariables(
      [
        v("text/lg", 18),
        v("min 1400/type/heading/1/size", 60),
        v("md/type/heading/1/size", 48),
        v("text/sm", 14),
        v("base/type/heading/1/size", 30),
        v("lg/type/heading/1/size", 36),
        v("font-weight/700", 700),
        v("font-weight/400", 400),
      ],
      ["base", "md", "lg", "min 1400"]
    );
    expect(out.map((x) => x.name)).toEqual([
      "text/sm",
      "text/lg",
      "base/type/heading/1/size",
      "md/type/heading/1/size",
      "lg/type/heading/1/size",
      "min 1400/type/heading/1/size",
      "font-weight/400",
      "font-weight/700",
    ]);
  });

  test("orderVariables puts a group's single-mode variables first, its multi-mode ones after in incoming order", () => {
    const v = (name: string, values: number[]): PlanVariable => ({
      key: `typography:${name}`,
      name,
      collection: "typography",
      type: "FLOAT",
      values,
      description: "",
      scopes: ["FONT_SIZE"],
    });
    const input = [
      v("text/10", [10]),
      v("text/9", [9, 90]),
      v("text/1", [1]),
      v("text/3", [3, 30]),
      v("text/2", [2]),
    ];
    const want = ["text/1", "text/2", "text/10", "text/9", "text/3"];
    expect(orderVariables(input, []).map((x) => x.name)).toEqual(want);
    expect(orderVariables([...input].reverse(), []).map((x) => x.name)).toEqual([
      "text/1",
      "text/2",
      "text/10",
      "text/3",
      "text/9",
    ]);
  });

  test("collections come in creation order with their modes", () => {
    const { layers } = setup();
    expect(layers.collections).toEqual([
      { kind: "palette", name: "Palette", modes: ["Base"] },
      { kind: "spacing", name: "Spacing", modes: ["Base"] },
      { kind: "radius", name: "Border radius", modes: ["Base"] },
      { kind: "typography", name: "Typography", modes: ["Base"] },
      { kind: "colorMode", name: "Color Mode", modes: ["Light", "Dark"] },
      { kind: "theme", name: "Theme", modes: ["Default"] },
    ]);
    expect(layers.modes).toEqual(["Light", "Dark"]);
    expect(layers.activeMode).toBe("Light");
  });

  test("a theme colour moves to Color Mode with every mode's value", () => {
    const { v } = setup();
    const card = v("colorMode:color/card");
    expect(card?.name).toBe("color/card");
    expect(card?.collection).toBe("colorMode");
    // Each mode's value aliases a Palette colour holding it.
    const held = card?.values.map((x) => v((x as { alias: string }).alias)?.values[0]);
    expect(held).toEqual([white, dark]);
    expect(card?.description).toBe("From the site: --card");
  });

  test("a fill bound to a theme colour binds to its final Theme token", () => {
    const { frame, v } = setup();
    const fill = frame.fills[0] as { colorKey?: string };
    expect(fill.colorKey).toBe("theme:color/card");
    const token = v("theme:color/card");
    expect(token?.collection).toBe("theme");
    expect(token?.values).toEqual([{ alias: "colorMode:color/card" }]);
    expect(token?.description).toBe("Final theme token; source: Color Mode");
    expect(token?.type).toBe("COLOR");
  });

  test("spacing, radius and type bindings move to Theme tokens over their raw collections", () => {
    const { frame, textStyles, v } = setup();
    const layout = frame.layout as Extract<FrameOp["layout"], { wrap: boolean }>;
    expect(layout.spacingKeys?.padding).toEqual([
      "theme:spacing/4",
      "theme:spacing/4",
      "theme:spacing/4",
      "theme:spacing/4",
    ]);
    expect(layout.spacingKeys?.itemSpacing).toBe("theme:spacing/4");
    expect(frame.radiusKeys).toEqual([
      "theme:radius/lg",
      "theme:radius/lg",
      "theme:radius/lg",
      "theme:radius/lg",
    ]);
    expect(textStyles[0]?.bind?.fontSize).toBe("theme:text/sm");
    expect(v("theme:spacing/4")?.values).toEqual([{ alias: "spacing:spacing/4" }]);
    expect(v("theme:spacing/4")?.description).toBe("Final theme token; source: Spacing");
    expect(v("theme:radius/lg")?.values).toEqual([{ alias: "radius:radius/lg" }]);
    expect(v("theme:radius/lg")?.description).toBe("Final theme token; source: Border radius");
    expect(v("theme:text/sm")?.values).toEqual([{ alias: "typography:text/sm" }]);
    expect(v("theme:text/sm")?.description).toBe("Final theme token; source: Typography");
  });

  test("raw values land in their collections, palette names split at the step", () => {
    const { v } = setup();
    expect(v("palette:gray/200")?.values).toEqual([gray]);
    expect(v("palette:brand-primary")?.name).toBe("brand-primary");
    expect(v("spacing:spacing/4")?.values).toEqual([16]);
    expect(v("radius:radius/lg")?.values).toEqual([10]);
    expect(v("typography:text/sm")?.values).toEqual([14]);
  });

  test("a Color Mode alias into a primitive follows it to Palette", () => {
    const { v } = setup();
    expect(v("colorMode:color/ring")?.values).toEqual([
      { alias: "palette:gray/200" },
      { alias: "palette:gray/50" },
    ]);
  });

  test("an unbound source gets no Theme token", () => {
    const { v } = setup();
    expect(v("spacing:spacing/8")).toBeDefined();
    expect(v("theme:spacing/8")).toBeUndefined();
    expect(v("theme:color/border")).toBeUndefined();
    expect(v("theme:color/gray/200")).toBeUndefined();
  });

  test("two Color Mode colours equal in Light stay two variables and two Theme tokens", () => {
    const { v, layers, text } = setup();
    expect(text.runs[0]?.colorKey).toBe("theme:color/popover");
    const popover = v("colorMode:color/popover")?.values.map(
      (x) => v((x as { alias: string }).alias)?.values[0]
    );
    expect(popover).toEqual([white, darker]);
    const colorMode = layers.variables.filter((x) => x.collection === "colorMode");
    expect(colorMode.map((x) => x.name)).toEqual([
      "color/card",
      "color/popover",
      "color/border",
      "color/ring",
    ]);
    const theme = layers.variables.filter((x) => x.collection === "theme");
    expect(theme.map((x) => x.name).sort()).toEqual([
      "color/card",
      "color/popover",
      "radius/lg",
      "spacing/4",
      "text/sm",
    ]);
  });

  test("every Theme token has one value, and every variable a key of its collection", () => {
    const { layers } = setup();
    for (const x of layers.variables) {
      expect(x.key).toBe(`${x.collection}:${x.name}`);
      if (x.collection === "theme") expect(x.values).toHaveLength(1);
    }
  });

  test("effect and gradient colours, and palette sources, rekey to Theme tokens", () => {
    const layers = staged();
    const shadow = {
      type: "DROP_SHADOW" as const,
      color: { ...dark },
      offset: { x: 0, y: 1 },
      radius: 2,
      spread: 0,
    };
    const effect: PlanEffectStyle = {
      key: "e",
      name: "shadow/1",
      shadows: [shadow, shadow],
      colorKeys: ["primitives:color/gray-200", null],
    };
    const gradient: PlanGradientStyle = {
      key: "g",
      name: "gradient/1",
      paint: {
        type: "GRADIENT_LINEAR",
        transform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        stops: [],
      },
      stopKeys: ["theme:border", null],
    };
    layers.effectStyles = [effect];
    layers.gradientStyles = [gradient];
    const out = layerCollections(layers, { ops: [], textStyles: [] });
    expect(effect.colorKeys).toEqual(["theme:color/gray/200", null]);
    expect(gradient.stopKeys).toEqual(["theme:color/border", null]);
    const token = out.variables.find((x) => x.key === "theme:color/gray/200");
    expect(token?.values).toEqual([{ alias: "palette:gray/200" }]);
    expect(token?.description).toBe("Final theme token; source: Palette");
  });

  test("paint style keys and style colours stay as they are", () => {
    const ops: PlanOp[] = [
      frameOp({ fills: [{ type: "SOLID", color: dark, opacity: 1, colorKey: "paint:#123456" }] }),
    ];
    const out = layerCollections(staged(), { ops, textStyles: [] });
    const fill = (ops[0] as FrameOp).fills[0] as { colorKey?: string };
    expect(fill.colorKey).toBe("paint:#123456");
    expect(out.styleColors).toEqual([{ key: "paint:#123456", rgba: dark, uses: 3 }]);
    expect(out.themeSource).toBe("site");
  });

  test("empty raw collections are left out, and Theme always stays", () => {
    const layers = staged();
    layers.variables = layers.variables.filter((x) => x.key === "theme:card");
    const out = layerCollections(layers, { ops: [], textStyles: [] });
    // Its colours still need a Palette to alias.
    expect(out.collections.map((c) => c.kind)).toEqual(["palette", "colorMode", "theme"]);
    const bare = staged();
    bare.variables = [];
    expect(layerCollections(bare, { ops: [], textStyles: [] }).collections).toEqual([
      { kind: "theme", name: "Theme", modes: ["Default"] },
    ]);
  });

  test("a non-colour theme variable keeps its name in Color Mode", () => {
    const layers = staged();
    layers.variables.push(variable("theme", "radius", "FLOAT", [10, 12], ["CORNER_RADIUS"]));
    const ops: PlanOp[] = [frameOp({ radiusKeys: ["theme:radius"] })];
    const out = layerCollections(layers, { ops, textStyles: [] });
    expect(out.variables.find((x) => x.key === "colorMode:radius")?.values).toEqual([10, 12]);
    expect((ops[0] as FrameOp).radiusKeys?.[0]).toBe("theme:radius");
    const token = out.variables.find((x) => x.key === "theme:radius");
    expect(token?.values).toEqual([{ alias: "colorMode:radius" }]);
  });
  describe("Color Mode colours alias Palette", () => {
    const oklchDark = { r: 0.05, g: 0.05, b: 0.05, a: 1 };
    function colours(): StagedLayers {
      const layers = staged();
      layers.variables = [
        variable("primitives", "color/white", "COLOR", [white], COLOR_SCOPES),
        variable("theme", "background", "COLOR", [white, oklchDark], COLOR_SCOPES),
        variable("theme", "foreground", "COLOR", [oklchDark, white], COLOR_SCOPES),
        variable("theme", "border", "COLOR", [white, { ...oklchDark, a: 0.1 }], COLOR_SCOPES),
      ];
      return layers;
    }
    const run = (layers: StagedLayers) => layerCollections(layers, { ops: [], textStyles: [] });
    const get = (out: ReturnType<typeof run>, key: string) =>
      out.variables.find((v) => v.key === key) as PlanVariable;

    test("a value equal to a palette colour aliases it", () => {
      const out = run(colours());
      expect(get(out, "colorMode:color/background").values[0]).toEqual({ alias: "palette:white" });
    });

    test("a value matching no palette colour creates one entry, reused by an equal value", () => {
      const out = run(colours());
      const entry = out.variables.find(
        (v) => v.collection === "palette" && v.name !== "white" && v.values[0] !== undefined
      ) as PlanVariable;
      expect(entry.name).toMatch(/^gray\/\d+$/);
      expect(entry.values).toEqual([oklchDark]);
      expect(entry.description).toBe("From the site: --background (Dark)");
      expect(entry.cssVar).toBeUndefined();
      expect(get(out, "colorMode:color/background").values[1]).toEqual({ alias: entry.key });
      expect(get(out, "colorMode:color/foreground").values[0]).toEqual({ alias: entry.key });
    });

    test("a value equal to a Tailwind color is named for Tailwind", () => {
      const layers = colours();
      const tw = parseCssColor("oklch(14.5% 0 0)") as typeof white;
      layers.variables[1] = variable("theme", "background", "COLOR", [white, tw], COLOR_SCOPES);
      const out = run(layers);
      expect(get(out, "colorMode:color/background").values[1]).toEqual({
        alias: "palette:neutral/950",
      });
      expect(get(out, "palette:neutral/950").values).toEqual([tw]);
    });

    test("a value one 8-bit step from Tailwind's keeps the family and step name", () => {
      const layers = colours();
      const near = { ...(parseCssColor("oklch(14.5% 0 0)") as typeof white) };
      near.r += 1 / 255;
      layers.variables[1] = variable("theme", "background", "COLOR", [white, near], COLOR_SCOPES);
      const out = run(layers);
      const alias = get(out, "colorMode:color/background").values[1] as { alias: string };
      expect(alias.alias).toMatch(/^palette:gray\/\d+$/);
    });

    test("an alpha value gets its own entry carrying the alpha", () => {
      const out = run(colours());
      const border = get(out, "colorMode:color/border").values[1] as { alias: string };
      const entry = get(out, border.alias);
      expect(entry.values).toEqual([{ ...oklchDark, a: 0.1 }]);
      expect(border.alias).not.toBe("palette:white");
    });

    test("a translucent entry is named for its alpha, and unique", () => {
      const layers = colours();
      layers.variables.push(
        variable("theme", "ring", "COLOR", [white, { ...oklchDark, a: 0.5 }], COLOR_SCOPES)
      );
      const out = run(layers);
      const border = get(out, "colorMode:color/border").values[1] as { alias: string };
      expect(get(out, border.alias).name).toMatch(/^gray\/\d+-a10$/);
      const ring = get(out, "colorMode:color/ring").values[1] as { alias: string };
      expect(get(out, ring.alias).name).toMatch(/^gray\/\d+-a50$/);
      const names = out.variables.filter((v) => v.collection === "palette").map((v) => v.name);
      expect(new Set(names).size).toBe(names.length);
    });

    test("a synthesised palette entry takes full colour scopes, not its first user's", () => {
      const layers = colours();
      const bg = layers.variables.find(
        (v) => v.name === "background"
      ) as PlanVariable<StagedCollection>;
      bg.scopes = ["TEXT_FILL"];
      const out = run(layers);
      const dark = get(out, "colorMode:color/background").values[1] as { alias: string };
      expect(get(out, dark.alias).scopes).toEqual(COLOR_SCOPES);
    });

    test("every Color Mode colour value is an alias to Palette", () => {
      const out = run(colours());
      for (const v of out.variables.filter((x) => x.collection === "colorMode")) {
        for (const value of v.values) {
          expect(value).toHaveProperty("alias");
          const alias = (value as { alias: string }).alias;
          expect(alias.startsWith("palette:") || alias.startsWith("colorMode:")).toBe(true);
        }
      }
    });

    test("a variable without a cssVar gets an Inferred description", () => {
      const layers = colours();
      const bg = layers.variables.find(
        (v) => v.key === "theme:background"
      ) as PlanVariable<StagedCollection>;
      delete bg.cssVar;
      const out = run(layers);
      const key = (get(out, "colorMode:color/background").values[1] as { alias: string }).alias;
      expect(get(out, key).description).toBe("Inferred: value of color/background (Dark)");
    });

    test("several palette colours with the value alias the first by name", () => {
      const layers = colours();
      layers.variables.unshift(
        variable("primitives", "color/zeta", "COLOR", [white], COLOR_SCOPES),
        variable("primitives", "color/alpha", "COLOR", [white], COLOR_SCOPES)
      );
      const out = run(layers);
      expect(get(out, "colorMode:color/background").values[0]).toEqual({ alias: "palette:alpha" });
    });

    test("an alias to another Color Mode variable stays", () => {
      const layers = colours();
      layers.variables.push(
        variable(
          "theme",
          "accent",
          "COLOR",
          [{ alias: "theme:background" }, { alias: "theme:background" }],
          COLOR_SCOPES
        )
      );
      const out = run(layers);
      expect(get(out, "colorMode:color/accent").values[0]).toEqual({
        alias: "colorMode:color/background",
      });
    });

    test("at the cap a value stays literal and is counted", () => {
      const layers = colours();
      for (let i = 0; i < 996; i++) {
        const c = { r: (i % 250) / 255, g: 0.5, b: Math.floor(i / 250) / 10, a: 0.5 };
        layers.variables.push(
          variable("primitives", `color/fill-${i}`, "COLOR", [c], COLOR_SCOPES)
        );
      }
      const out = run(layers);
      expect(out.variables.filter((v) => v.collection !== "theme").length).toBeLessThanOrEqual(
        1000
      );
      expect(out.notes.droppedPrimitives).toBeGreaterThan(0);
      expect(get(out, "colorMode:color/background").values[1]).toEqual(oklchDark);
    });
  });
});
