import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode, TokenRefs } from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { type DeviceEntry, mergeDevices } from "../devices";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanLayers, PlanOp, PlanVariable, PlanVarValue } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

const LAYERED = { ...DEFAULT_IMPORT_OPTIONS, components: false, layers: true };
const BOUNDARIES = [640, 768, 1024, 1280, 1400];
const HEADLINE = "Ship faster with Mainline";
const BODY = "Body copy that the page sets in its reading size";

const rgba = (css: string) => parseCssColor(css) as NonNullable<ReturnType<typeof parseCssColor>>;

function tokens(over: Record<string, string> = {}): Capture["tokens"] {
  return {
    cssCustomProperties: {
      "--radius": ".625rem",
      "--card": "oklch(1 0 0)",
      "--color-card": "oklch(1 0 0)",
      "--radius-lg": ".625rem",
      "--text-base": "1rem",
      ...over,
    },
    authored: { "--color-card": "var(--card)", "--radius-lg": "var(--radius)" },
    themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "oklch(0.205 0 0)" } }],
  };
}

function card(id: string, refs: TokenRefs): ElementNode {
  const base = el(id, [0, 0]);
  return {
    ...base,
    style: { ...base.style, backgroundColor: rgba("oklch(1 0 0)"), borderRadius: [10, 10, 10, 10] },
    tokenRefs: refs,
  };
}

type Page = {
  width: number;
  heading: number;
  body?: number;
  version?: Capture["version"];
  boundaries?: number[] | null;
  props?: Record<string, string>;
};

function page({ width, heading, body = 16, version, boundaries = BOUNDARIES, props }: Page) {
  const children: CaptureNode[] = [
    card("card", { background: "--color-card", radius: "--radius-lg" }),
    ...[1, 2, 3].map((n) =>
      textNode(`h${n}`, {
        semantic: { tag: "h1", headingLevel: 1 },
        text: HEADLINE,
        runs: [
          run({ end: HEADLINE.length, size: heading, weight: 700, lineHeight: heading * 1.2 }),
        ],
      })
    ),
    ...[1, 2, 3].map((n) =>
      textNode(`p${n}`, {
        text: BODY,
        runs: [run({ end: BODY.length, size: body, lineHeight: 24 })],
        tokenRefs: { fontSize: "--text-base" },
      })
    ),
  ];
  const capture = cap(el("root", [0, 0], children));
  capture.source.url = "https://mainline.example.com/";
  capture.source.viewport.w = width;
  capture.tokens = tokens(props);
  if (boundaries) capture.breakpoints = { widths: boundaries, unreadable: 0 };
  if (version) capture.version = version;
  return capture;
}

const device = (name: string, height: number): Capture["version"] => ({
  label: name,
  kind: "viewport",
  device: { id: name.toLowerCase().replaceAll(" ", "-"), name, height },
});
const extra = (breakpoint: string): Capture["version"] => ({
  label: breakpoint,
  kind: "viewport",
  breakpoint,
});

function entry(p: Page): DeviceEntry {
  const capture = page(p);
  return { capture, plan: mapCapture(capture, inter, LAYERED) };
}

/** Mainline's default devices plus the extra for `lg`. */
function mainline(over: Partial<Page> = {}): DeviceEntry[] {
  return [
    entry({ width: 1512, heading: 60, version: device("Laptop", 982), ...over }),
    entry({ width: 834, heading: 48, version: device("Tablet portrait", 1194), ...over }),
    entry({ width: 390, heading: 30, version: device("Phone portrait", 844), ...over }),
    entry({ width: 1024, heading: 36, version: extra("lg"), ...over }),
  ];
}

const varOf = (layers: PlanLayers, key: string) => layers.variables.find((v) => v.key === key);
const aliasOf = (value: PlanVarValue | undefined) =>
  typeof value === "object" && value !== null && "alias" in value ? value.alias : undefined;
const modesOf = (layers: PlanLayers, name: string) =>
  layers.collections.find((c) => c.name === name)?.modes;

/** Every key a plan binds by: variables, text styles and effect or gradient styles. */
function keysOf(plan: LayerPlan) {
  const vars: string[] = [];
  const styles: string[] = [];
  const effects: string[] = [];
  const gradients: string[] = [];
  const walk = (value: unknown, field?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, field);
      return;
    }
    if (typeof value === "string") {
      if (field === "colorKey" && !value.startsWith("paint:")) vars.push(value);
      if (field === "radiusKeys" || field === "spacingKeys") vars.push(value);
      if (field === "styleKey") styles.push(value);
      if (field === "effectStyleKey") effects.push(value);
      if (field === "gradientStyleKey") gradients.push(value);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      walk(inner, field === "spacingKeys" ? field : key);
    }
  };
  walk(plan.ops);
  for (const style of plan.tokens.textStyles) vars.push(...Object.values(style.bind ?? {}));
  return { vars, styles, effects, gradients };
}

function expectResolves(layers: PlanLayers, plans: LayerPlan[]) {
  const byKey = new Map(layers.variables.map((v) => [v.key, v]));
  const modes = new Map(layers.collections.map((c) => [c.kind, c.modes.length]));
  for (const v of layers.variables) {
    expect(v.values).toHaveLength(modes.get(v.collection) ?? -1);
    for (const value of v.values) {
      const alias = aliasOf(value);
      if (alias) expect(byKey.has(alias)).toBe(true);
    }
  }
  for (const style of layers.effectStyles) {
    for (const key of style.colorKeys) if (key) expect(byKey.has(key)).toBe(true);
  }
  for (const style of layers.gradientStyles) {
    for (const key of style.stopKeys) if (key) expect(byKey.has(key)).toBe(true);
  }
  for (const plan of plans) {
    expect(plan.tokens.layers).toBe(layers);
    const keys = keysOf(plan);
    for (const key of keys.vars) expect(byKey.has(key)).toBe(true);
    const styleKeys = new Set(plan.tokens.textStyles.map((s) => s.key));
    for (const key of keys.styles) expect(styleKeys.has(key)).toBe(true);
    for (const key of keys.effects) {
      expect(layers.effectStyles.some((s) => s.key === key)).toBe(true);
    }
    for (const key of keys.gradients) {
      expect(layers.gradientStyles.some((s) => s.key === key)).toBe(true);
    }
  }
}

const headingRuns = (plan: LayerPlan) =>
  plan.ops.flatMap((op) =>
    op.op === "text" && op.text === HEADLINE ? (op as Extract<PlanOp, { op: "text" }>).runs : []
  );

describe("mergeDevices", () => {
  test("devices become Device modes with their width and nominal height", () => {
    const { layers } = mergeDevices(mainline());
    expect(modesOf(layers, "Device")).toEqual(["Laptop", "Tablet portrait", "Phone portrait"]);
    expect(varOf(layers, "device:device/width")?.values).toEqual([1512, 834, 390]);
    expect(varOf(layers, "device:device/height")?.values).toEqual([982, 1194, 844]);
  });

  test("collections are created in order, Device and Breakpoint before Color Mode", () => {
    const { layers } = mergeDevices(mainline());
    expect(layers.collections.map((c) => c.kind)).toEqual([
      "palette",
      "radius",
      "typography",
      "device",
      "breakpoint",
      "colorMode",
      "theme",
    ]);
    expect(layers.collections.map((c) => c.name)).toContain("Breakpoint");
  });

  test("breakpoints with a capture become modes; the ones without are dropped and reported", () => {
    const { layers, report } = mergeDevices(mainline());
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "md", "lg", "min 1400"]);
    expect(report).toContain("No capture for the sm breakpoint");
    expect(report).toContain("No capture for the xl breakpoint");
    expect(varOf(layers, "breakpoint:breakpoint/min-width")?.values).toEqual([0, 768, 1024, 1400]);
    expect(varOf(layers, "breakpoint:breakpoint/max-width")?.values).toEqual([639, 1023, 1279, 0]);
  });

  test("a text size that differs by breakpoint aliases per-breakpoint raw values", () => {
    const { layers, plans } = mergeDevices(mainline());
    const token = varOf(layers, "theme:type/heading/1/size");
    expect(token?.values).toEqual([{ alias: "breakpoint:type/heading/1/size" }]);
    expect(token?.description).toBe("Final theme token; source: Breakpoint");
    expect(varOf(layers, "breakpoint:type/heading/1/size")?.values).toEqual([
      { alias: "typography:base/type/heading/1/size" },
      { alias: "typography:md/type/heading/1/size" },
      { alias: "typography:lg/type/heading/1/size" },
      { alias: "typography:min 1400/type/heading/1/size" },
    ]);
    const raw = (mode: string) => varOf(layers, `typography:${mode}/type/heading/1/size`)?.values;
    expect(raw("min 1400")).toEqual([60]);
    expect(raw("md")).toEqual([48]);
    expect(raw("lg")).toEqual([36]);
    expect(raw("base")).toEqual([30]);
    // Line height differs too; tracking is 0 everywhere and stays unbound.
    expect(varOf(layers, "theme:type/heading/1/line-height")).toBeDefined();
    expect(varOf(layers, "theme:type/heading/1/tracking")).toBeUndefined();

    // Every device's headings link one text style, bound through those tokens.
    const keys = new Set(plans.flatMap((p) => headingRuns(p).map((r) => r.styleKey)));
    expect(keys.size).toBe(1);
    const style = plans[0]?.tokens.textStyles.find((s) => s.key === [...keys][0]);
    expect(style?.name).toBe("heading/1");
    expect(style?.bind?.fontSize).toBe("theme:type/heading/1/size");
    expect(style?.bind?.lineHeight).toBe("theme:type/heading/1/line-height");
  });

  test("values equal across every capture stay single, with no Breakpoint variable", () => {
    const { layers } = mergeDevices(mainline());
    expect(varOf(layers, "theme:color/card")?.values).toEqual([{ alias: "colorMode:color/card" }]);
    expect(layers.variables.filter((v) => v.name.endsWith("color/card"))).toHaveLength(2);
    expect(varOf(layers, "breakpoint:color/card")).toBeUndefined();
    expect(varOf(layers, "theme:radius/lg")?.values).toEqual([{ alias: "radius:radius/lg" }]);
    expect(varOf(layers, "breakpoint:radius/lg")).toBeUndefined();
    expect(modesOf(layers, "Color Mode")).toEqual(["Light", "Dark"]);
    expect(layers.activeMode).toBe("Light");
  });

  test("a site token that differs by breakpoint gets per-breakpoint raw values", () => {
    const entries = [
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
      entry({
        width: 390,
        heading: 30,
        body: 14,
        version: device("Phone portrait", 844),
        props: { "--text-base": "0.875rem" },
      }),
    ];
    const { layers, plans } = mergeDevices(entries);
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "min 1400"]);
    expect(varOf(layers, "theme:text/base")?.values).toEqual([{ alias: "breakpoint:text/base" }]);
    expect(varOf(layers, "breakpoint:text/base")?.values).toEqual([
      { alias: "typography:base/text/base" },
      { alias: "typography:min 1400/text/base" },
    ]);
    expect(varOf(layers, "typography:base/text/base")?.values).toEqual([14]);
    expect(varOf(layers, "typography:min 1400/text/base")?.values).toEqual([16]);
    // The body style keeps its binding to the site's token.
    const body = plans[0]?.tokens.textStyles.find((s) => s.name === "body/1");
    expect(body?.bind?.fontSize).toBe("theme:text/base");
    expectResolves(layers, plans);
  });

  test("frames list the devices with their modes, and no extra", () => {
    const { frames } = mergeDevices(mainline());
    expect(frames).toEqual([
      { index: 0, device: "Laptop", breakpoint: "min 1400" },
      { index: 1, device: "Tablet portrait", breakpoint: "md" },
      { index: 2, device: "Phone portrait", breakpoint: "base" },
    ]);
  });

  test("two devices in one range both get it, and the range takes the wider one's values", () => {
    const { layers, frames } = mergeDevices([
      entry({ width: 1440, heading: 56, version: device("Desktop", 900) }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
      entry({ width: 390, heading: 30, version: device("Phone portrait", 844) }),
    ]);
    expect(frames.map((f) => f.breakpoint)).toEqual(["min 1400", "min 1400", "base"]);
    expect(varOf(layers, "typography:min 1400/type/heading/1/size")?.values).toEqual([60]);
  });

  test("no boundaries: no Breakpoint collection and no breakpoint on any frame", () => {
    const entries = mainline({ boundaries: null }).slice(0, 3);
    const { layers, frames, plans } = mergeDevices(entries);
    expect(layers.collections.map((c) => c.kind)).not.toContain("breakpoint");
    expect(frames.map((f) => f.breakpoint)).toEqual([null, null, null]);
    expect(modesOf(layers, "Device")).toEqual(["Laptop", "Tablet portrait", "Phone portrait"]);
    expectResolves(layers, plans);
  });

  test("older captures with only a width become Device modes named by it", () => {
    const { layers, frames } = mergeDevices([
      entry({ width: 1512, heading: 60 }),
      entry({ width: 834, heading: 48 }),
      entry({ width: 390, heading: 30 }),
    ]);
    expect(modesOf(layers, "Device")).toEqual(["1512", "834", "390"]);
    expect(varOf(layers, "device:device/height")?.values).toEqual([0, 0, 0]);
    expect(frames.map((f) => f.device)).toEqual(["1512", "834", "390"]);
  });

  test("every plan's keys resolve in the merged layers", () => {
    const { layers, plans } = mergeDevices(mainline());
    expect(plans).toHaveLength(4);
    expectResolves(layers, plans);
  });

  test("the merged layers stay within the variable cap, and say what was left out", () => {
    const entries = mainline({ boundaries: null }).slice(0, 2);
    entries.forEach((e, at) => {
      const layers = e.plan.tokens.layers as PlanLayers;
      const filler = Array.from(
        { length: 900 },
        (_, n): PlanVariable => ({
          key: `palette:filler-${at}/${n}`,
          name: `filler-${at}/${n}`,
          collection: "palette",
          type: "FLOAT",
          values: [n],
          description: "Filler",
          scopes: [],
        })
      );
      layers.variables = [...filler, ...layers.variables];
    });
    const { layers, plans, report } = mergeDevices(entries);
    expect(layers.variables.length).toBeLessThanOrEqual(1000);
    expect(
      report.some((line) => /variables past the 1,000-variable limit were left out/.test(line))
    ).toBe(true);
    expectResolves(layers, plans);
  });
});
