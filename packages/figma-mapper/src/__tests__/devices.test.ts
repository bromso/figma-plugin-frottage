import { describe, expect, test } from "bun:test";
import type {
  Capture,
  CaptureNode,
  ElementNode,
  PageLanguage,
  TextNode,
  TokenRefs,
} from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { type DeviceEntry, MAX_LANGUAGE_VARIABLES, mergeDevices } from "../devices";
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
  themeChoice?: { light: boolean; dark: boolean };
};

function page({
  width,
  heading,
  body = 16,
  version,
  boundaries = BOUNDARIES,
  props,
  themeChoice,
}: Page) {
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
  if (themeChoice) capture.themeChoice = themeChoice;
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

const BREAKPOINTS = ["base", "sm", "md", "lg", "xl", "min 1400"];
const order = (mode: string | undefined) => BREAKPOINTS.indexOf(mode ?? "");
const varOf = (layers: PlanLayers, key: string) => layers.variables.find((v) => v.key === key);
const aliasOf = (value: PlanVarValue | undefined) =>
  typeof value === "object" && value !== null && "alias" in value ? value.alias : undefined;
const modesOf = (layers: PlanLayers, name: string) =>
  layers.collections.find((c) => c.name === name)?.modes;
const priorityOf = (layers: PlanLayers, name: string) =>
  layers.collections.find((c) => c.name === name)?.priority;

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
  test("Color Mode holds the themes the first device chose", () => {
    const dark = { light: false, dark: true };
    const set = mainline({ themeChoice: dark });
    const { layers } = mergeDevices(set);
    expect(modesOf(layers, "Color Mode")).toEqual(["Dark"]);
    expect(layers.modes).toEqual(["Dark"]);
    expect(layers.activeMode).toBe("Dark");
    // The first device's choice, though the widest one chose both.
    const mixed = [
      entry({ width: 390, heading: 30, version: device("Phone portrait", 844), themeChoice: dark }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
    ];
    expect(mergeDevices(mixed).layers.modes).toEqual(["Dark"]);
  });

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
    // Smallest to largest; the frames' ranges lead the priority, widest device's first.
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "md", "lg", "min 1400"]);
    expect(priorityOf(layers, "Breakpoint")).toEqual(["min 1400", "md", "base", "lg"]);
    expect(report).toContain("No capture for the sm breakpoint.");
    expect(report).toContain("No capture for the xl breakpoint.");
    expect(varOf(layers, "breakpoint:breakpoint/min-width")?.values).toEqual([0, 768, 1024, 1400]);
    // A range's end is where the next mode starts, so the ranges with no capture leave no gap.
    expect(varOf(layers, "breakpoint:breakpoint/max-width")?.values).toEqual([767, 1023, 1399, 0]);
  });

  test("Breakpoint priority puts the frames' ranges first, so a mode limit drops extras' ranges", () => {
    const { layers } = mergeDevices([
      entry({ width: 390, heading: 30, version: device("Phone portrait", 844) }),
      entry({ width: 1280, heading: 40, version: extra("xl") }),
      entry({ width: 834, heading: 48, version: device("Tablet portrait", 1194) }),
      entry({ width: 640, heading: 32, version: extra("sm") }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
    ]);
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "sm", "md", "xl", "min 1400"]);
    expect(priorityOf(layers, "Breakpoint")).toEqual(["min 1400", "md", "base", "xl", "sm"]);
    const size = "theme:type/heading/1/size";
    expect(valueIn(layers, size, "min 1400")).toBe(60);
    expect(valueIn(layers, size, "xl")).toBe(40);
    expect(valueIn(layers, size, "sm")).toBe(32);
  });

  test("Mainline's breakpoints are smallest to largest, each Typography group after the last", () => {
    const { layers } = mergeDevices([
      ...mainline(),
      entry({ width: 640, heading: 32, version: extra("sm") }),
      entry({ width: 1280, heading: 40, version: extra("xl") }),
    ]);
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "sm", "md", "lg", "xl", "min 1400"]);
    expect(priorityOf(layers, "Breakpoint")).toEqual(["min 1400", "md", "base", "xl", "lg", "sm"]);
    const groups = layers.variables
      .filter((v) => v.collection === "typography" && v.name.includes("/type/"))
      .map((v) => v.name.split("/")[0]);
    expect([...new Set(groups)]).toEqual(["base", "sm", "md", "lg", "xl", "min 1400"]);
    // Each group is whole: no mode's variables come back after the next mode's.
    expect(groups).toEqual([...groups].sort((a, b) => order(a) - order(b)));
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

  test("a Color Mode token that differs by breakpoint keeps the widest range's value", () => {
    const { layers, report } = mergeDevices([
      entry({
        width: 390,
        heading: 30,
        version: device("Phone portrait", 844),
        props: { "--card": "oklch(0.9 0 0)" },
      }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
    ]);
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "min 1400"]);
    expect(report).toContain(
      "color/card differs by breakpoint in Color Mode; kept the min 1400 value."
    );
    const card = aliasOf(varOf(layers, "theme:color/card")?.values[0]);
    expect(card && varOf(layers, card)?.values.length).toBe(2);
    expect(JSON.stringify(varOf(layers, card as string))).not.toContain("0.9");
  });

  test("says how many stylesheets' breakpoints couldn't be read, the most of any capture", () => {
    const unreadable = (n: number) => (e: DeviceEntry) => {
      e.capture.breakpoints = { widths: BOUNDARIES, unreadable: n };
      return e;
    };
    const [laptop, tablet, phone] = mainline();
    const { report } = mergeDevices([
      unreadable(2)(laptop as DeviceEntry),
      unreadable(3)(tablet as DeviceEntry),
      unreadable(0)(phone as DeviceEntry),
    ]);
    expect(report).toContain("Breakpoints from 3 stylesheets couldn't be read.");
    const one = mergeDevices(mainline().map(unreadable(1)));
    expect(one.report).toContain("Breakpoints from 1 stylesheet couldn't be read.");
    expect(mergeDevices(mainline()).report.some((l) => l.includes("stylesheet"))).toBe(false);
  });

  test("a breakpoint whose extra the user left out isn't reported as having no capture", () => {
    const { report } = mergeDevices(mainline().slice(0, 3), { leftOut: ["lg"] });
    expect(report).not.toContain("No capture for the lg breakpoint.");
    expect(report).toContain("No capture for the sm breakpoint.");
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
    const { layers, frames, report } = mergeDevices([
      entry({ width: 1440, heading: 56, version: device("Desktop", 900) }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
      entry({ width: 390, heading: 30, version: device("Phone portrait", 844) }),
    ]);
    expect(frames.map((f) => f.breakpoint)).toEqual(["min 1400", "min 1400", "base"]);
    expect(varOf(layers, "typography:min 1400/type/heading/1/size")?.values).toEqual([60]);
    expect(report).toContain(
      "Desktop shares the min 1400 breakpoint with Laptop and uses its values."
    );
  });

  test("a device sharing a range with the same values is not reported", () => {
    const { report } = mergeDevices([
      entry({ width: 1440, heading: 60, version: device("Desktop", 900) }),
      entry({ width: 1512, heading: 60, version: device("Laptop", 982) }),
    ]);
    expect(report.some((line) => line.includes("shares"))).toBe(false);
  });

  /** The value a Theme token holds in a Breakpoint mode, following every alias. */
  const valueIn = (layers: PlanLayers, key: string, mode: string): PlanVarValue | undefined => {
    const modes = new Map(layers.collections.map((c) => [c.kind, c.modes]));
    let v = varOf(layers, key);
    for (let depth = 0; v && depth < 8; depth++) {
      const at = v.collection === "breakpoint" ? (modes.get("breakpoint")?.indexOf(mode) ?? 0) : 0;
      const value = v.values[at];
      const alias = aliasOf(value);
      if (!alias) return value;
      v = varOf(layers, alias);
    }
    return undefined;
  };

  test("no recorded boundaries: each device width but the narrowest becomes one", () => {
    const entries = mainline({ boundaries: null }).slice(0, 3);
    const { layers, frames, plans, report } = mergeDevices(entries);
    expect(report).toContain(
      "This page records no breakpoints, so each device width was used as one."
    );
    expect(modesOf(layers, "Breakpoint")).toEqual(["base", "min 834", "min 1512"]);
    expect(priorityOf(layers, "Breakpoint")).toEqual(["min 1512", "min 834", "base"]);
    expect(varOf(layers, "breakpoint:breakpoint/min-width")?.values).toEqual([0, 834, 1512]);
    expect(frames.map((f) => f.breakpoint)).toEqual(["min 1512", "min 834", "base"]);
    expect(modesOf(layers, "Device")).toEqual(["Laptop", "Tablet portrait", "Phone portrait"]);
    const size = "theme:type/heading/1/size";
    expect(valueIn(layers, size, "min 1512")).toBe(60);
    expect(valueIn(layers, size, "min 834")).toBe(48);
    expect(valueIn(layers, size, "base")).toBe(30);
    expect(report.some((line) => line.startsWith("No capture"))).toBe(false);
    expectResolves(layers, plans);
  });

  test("one device and no boundaries: no Breakpoint collection and no breakpoint", () => {
    const { layers, frames, plans, report } = mergeDevices(
      mainline({ boundaries: null }).slice(0, 1)
    );
    expect(layers.collections.map((c) => c.kind)).not.toContain("breakpoint");
    expect(frames).toEqual([{ index: 0, device: "Laptop", breakpoint: null }]);
    expect(report).toEqual([]);
    expectResolves(layers, plans);
  });

  test("older captures with only a width become Device modes named by it", () => {
    const entries = [
      entry({ width: 1512, heading: 60, boundaries: null }),
      entry({ width: 834, heading: 48, boundaries: null }),
      entry({ width: 390, heading: 30, boundaries: null }),
    ];
    for (const e of entries) {
      expect(e.capture.breakpoints).toBeUndefined();
      expect(e.capture.version).toBeUndefined();
    }
    const { layers, frames, plans } = mergeDevices(entries);
    expect(modesOf(layers, "Device")).toEqual(["1512", "834", "390"]);
    expect(varOf(layers, "device:device/height")?.values).toEqual([0, 0, 0]);
    expect(frames).toEqual([
      { index: 0, device: "1512", breakpoint: "min 1512" },
      { index: 1, device: "834", breakpoint: "min 834" },
      { index: 2, device: "390", breakpoint: "base" },
    ]);
    // The phone's heading reads the phone's size through its Breakpoint mode.
    expect(valueIn(layers, "theme:type/heading/1/size", "base")).toBe(30);
    expect(valueIn(layers, "theme:type/heading/1/size", "min 834")).toBe(48);
    expectResolves(layers, plans);
  });

  test("effect styles from different captures get unique names", () => {
    const shadowed = (id: string, blur: number): ElementNode => {
      const base = el(id, [0, 0]);
      const color = rgba("rgb(0 0 0 / 0.1)");
      return {
        ...base,
        style: {
          ...base.style,
          boxShadows: [{ inset: false, x: 0, y: 1, blur, spread: 0, color }],
        },
      };
    };
    const withShadows = (p: Page, blur: number): DeviceEntry => {
      const capture = page(p);
      if (capture.root.kind === "element") {
        capture.root.children.push(...["s1", "s2", "s3"].map((id) => shadowed(id, blur)));
      }
      return { capture, plan: mapCapture(capture, inter, LAYERED) };
    };
    const { layers, plans } = mergeDevices([
      withShadows({ width: 1512, heading: 60, version: device("Laptop", 982) }, 3),
      withShadows({ width: 390, heading: 30, version: device("Phone portrait", 844) }, 8),
    ]);
    expect(layers.effectStyles.map((s) => s.name)).toEqual(["shadow/1", "shadow/2"]);
    expectResolves(layers, plans);
  });

  test("every plan's keys resolve in the merged layers", () => {
    const { layers, plans } = mergeDevices(mainline());
    expect(plans).toHaveLength(4);
    expectResolves(layers, plans);
  });

  test("a split near the cap counts its Breakpoint variables", () => {
    const filled = (filler: number) => {
      const entries = mainline();
      const layers = entries[0]?.plan.tokens.layers as PlanLayers;
      layers.variables = [
        ...Array.from(
          { length: filler },
          (_, n): PlanVariable => ({
            key: `palette:filler/${n}`,
            name: `filler/${n}`,
            collection: "palette",
            type: "FLOAT",
            values: [n],
            description: "Filler",
            scopes: [],
          })
        ),
        ...layers.variables,
      ];
      return mergeDevices(entries);
    };
    // Each type split costs 4 raw values, a Breakpoint variable and a Theme token: 6.
    const before = filled(0).layers.variables.length - 12;
    // Room for 11 more: the size splits, and the line height no longer fits.
    const { layers, plans, report } = filled(1000 - 11 - before);
    expect(layers.variables.length).toBeLessThanOrEqual(1000);
    expect(varOf(layers, "theme:type/heading/1/size")).toBeDefined();
    expect(varOf(layers, "theme:type/heading/1/line-height")).toBeUndefined();
    expect(report).toContain(
      "heading/1 line-height differs by breakpoint; kept, at the variable limit."
    );
    expect(report.some((line) => line.includes("past the 1,000-variable limit"))).toBe(true);
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

  test("captures go by the width they were laid out at, not their client width", () => {
    // A classic scrollbar takes 15 px off the client width; media queries match the full width.
    const at = (width: number, heading: number, version: Capture["version"]) =>
      entry({ width: width - 15, heading, version: { ...version, width } as Capture["version"] });
    const { layers, frames, report } = mergeDevices([
      at(1512, 60, device("Laptop", 982)),
      at(834, 48, device("Tablet portrait", 1194)),
      at(390, 30, device("Phone portrait", 844)),
      at(640, 32, extra("sm")),
      at(1024, 36, extra("lg")),
      at(1280, 40, extra("xl")),
    ]);
    expect([...(modesOf(layers, "Breakpoint") ?? [])].sort()).toEqual(
      ["base", "lg", "md", "min 1400", "sm", "xl"].sort()
    );
    expect(report.some((line) => line.startsWith("No capture"))).toBe(false);
    expect(report.some((line) => line.includes("shares"))).toBe(false);
    expect(varOf(layers, "device:device/width")?.values).toEqual([1512, 834, 390]);
    expect(frames.map((f) => f.breakpoint)).toEqual(["min 1400", "md", "base"]);
    const size = "theme:type/heading/1/size";
    expect(valueIn(layers, size, "md")).toBe(48);
    expect(valueIn(layers, size, "lg")).toBe(36);
    expect(valueIn(layers, size, "sm")).toBe(32);
    expect(valueIn(layers, size, "xl")).toBe(40);
  });

  test("an older extra goes in the range it was captured for, whatever its client width", () => {
    const { layers, report } = mergeDevices([
      entry({ width: 1497, heading: 60, version: device("Laptop", 982) }),
      entry({ width: 1009, heading: 36, version: extra("lg") }),
      entry({ width: 375, heading: 30, version: device("Phone portrait", 844) }),
    ]);
    expect(modesOf(layers, "Breakpoint")).toContain("lg");
    expect(modesOf(layers, "Breakpoint")).not.toContain("md");
    expect(valueIn(layers, "theme:type/heading/1/size", "lg")).toBe(36);
    expect(report).not.toContain("No capture for the lg breakpoint.");
  });

  test("a capture without device data goes by its numeric label, not its client width", () => {
    const widthOnly = (label: string, width: number): Capture["version"] => ({
      label,
      kind: "viewport",
    });
    // A classic scrollbar makes the client width 15 px narrower than the width chosen.
    const { layers, frames } = mergeDevices([
      entry({ width: 1497, heading: 60, version: widthOnly("1512", 1497) }),
      entry({ width: 819, heading: 48, version: widthOnly("834", 819) }),
      entry({ width: 390, heading: 30, version: widthOnly("Phone", 390) }),
    ]);
    expect(modesOf(layers, "Device")).toEqual(["1512", "834", "390"]);
    expect(varOf(layers, "device:device/width")?.values).toEqual([1512, 834, 390]);
    expect(frames.map((f) => f.device)).toEqual(["1512", "834", "390"]);
  });
});

test("a radius name with different values is reported once for the set, not per device", () => {
  const rounded = (id: string, px: number): ElementNode => {
    const base = el(id, [0, 0]);
    return {
      ...base,
      style: { ...base.style, borderRadius: [px, px, px, px] },
      tokenRefs: { radiusClass: ["md", "md", "md", "md"] },
    };
  };
  const entries = mainline().map(({ capture }) => {
    const root = capture.root as ElementNode;
    capture.root = { ...root, children: [...root.children, rounded("m1", 6), rounded("m2", 7)] };
    return { capture, plan: mapCapture(capture, inter, LAYERED) };
  });
  const line = "radius/md has different values on this page.";
  for (const { plan } of entries) expect(plan.report.warnings).toContain(line);
  const { report, plans } = mergeDevices(entries);
  expect(report.filter((l) => l === line)).toHaveLength(1);
  for (const plan of plans) expect(plan.report.warnings).not.toContain(line);
});

test("theme notes are reported once for the set, not per device", () => {
  const line = "This page has no dark theme, so only Light was made.";
  const entries = mainline({ themeChoice: { light: false, dark: true } }).map(({ capture }) => {
    capture.tokens.themes = [];
    return { capture, plan: mapCapture(capture, inter, LAYERED) };
  });
  for (const { plan } of entries) expect(plan.report.warnings).toContain(line);
  const { report, plans } = mergeDevices(entries);
  expect(report.filter((l) => l === line)).toHaveLength(1);
  for (const plan of plans) expect(plan.report.warnings).not.toContain(line);
});

test("a set with no language merges as before", () => {
  const { layers, plans, frames, report } = mergeDevices(mainline());
  // Recorded before languages were added: a set without them must merge exactly so.
  expect({
    collections: layers.collections,
    variables: layers.variables.map((v) => `${v.key} ${JSON.stringify(v.values)}`),
    frames,
    report,
    textStyles: plans[0]?.tokens.textStyles.map((s) => `${s.key} ${JSON.stringify(s.bind ?? {})}`),
    texts: plans.map((plan) =>
      plan.ops.flatMap((op) =>
        op.op === "text" ? [`${op.id} ${op.runs.map((r) => r.styleKey).join(",")}`] : []
      )
    ),
  }).toMatchSnapshot();
});

describe("languages", () => {
  const LANGUAGES: Record<string, PageLanguage> = {
    en: { code: "en", name: "English", url: "https://lang.example.com/en", current: true },
    sv: { code: "sv", name: "Svenska", url: "https://lang.example.com/sv", current: false },
  };
  const EN = {
    header: ["Frottage", "Import any page"],
    main: ["Learn more", "Learn more", "Learn more", "Learn more", "Learn more", "Learn more"],
  };
  const SV = {
    header: ["Frottage", "Importera vilken sida som helst"],
    main: ["Läs mer", "Läs mer", "Läs mer", "Mer info", "Mer info", "Mer info"],
  };
  type Copy = { header: string[]; main: (string | TextNode)[] };
  const DEVICES = { Laptop: [1512, 982], Phone: [390, 844] } as const;

  const text = (id: string, copy: string | TextNode) =>
    typeof copy === "string"
      ? textNode(id, { text: copy, runs: [run({ end: copy.length })] })
      : copy;

  function langEntry(code: string, name: keyof typeof DEVICES, copy: Copy): DeviceEntry {
    const [width, height] = DEVICES[name];
    const capture = cap(
      el(
        "root",
        [0, 0],
        [
          el(
            "header",
            [0, 0],
            copy.header.map((c, i) => text(`h${i}`, c)),
            { semantic: { tag: "header", landmark: "banner" } }
          ),
          el(
            "main",
            [0, 100],
            copy.main.map((c, i) => text(`m${i}`, c)),
            { semantic: { tag: "main", landmark: "main" } }
          ),
        ],
        { semantic: { tag: "body" } }
      )
    );
    capture.source.url = (LANGUAGES[code] as PageLanguage).url;
    capture.source.viewport.w = width;
    capture.version = device(name, height);
    capture.language = LANGUAGES[code];
    return { capture, plan: mapCapture(capture, inter, LAYERED) };
  }

  const textOps = (plan: LayerPlan) =>
    plan.ops.filter((op): op is Extract<PlanOp, { op: "text" }> => op.op === "text");
  const languageVars = (layers: PlanLayers) =>
    layers.variables.filter((v) => v.collection === "language");

  test("paired texts bind to Language variables shared across devices", () => {
    const entries = [
      langEntry("en", "Laptop", EN),
      langEntry("en", "Phone", EN),
      langEntry("sv", "Laptop", SV),
      langEntry("sv", "Phone", SV),
    ];
    const { layers, plans, frames } = mergeDevices(entries);
    expect(modesOf(layers, "Language")).toEqual(["English", "Svenska"]);
    const kinds = layers.collections.map((c) => c.kind);
    expect(kinds.indexOf("language")).toBe(kinds.indexOf("theme") - 1);
    expect(frames.map((f) => f.index)).toEqual([0, 1]);

    const vars = languageVars(layers);
    expect(vars.map((v) => v.values)).toEqual([
      ["Frottage", "Frottage"],
      ["Import any page", "Importera vilken sida som helst"],
      ["Learn more", "Läs mer"],
      ["Learn more", "Mer info"],
    ]);
    expect(vars.map((v) => v.name)).toEqual([
      "Header/Frottage",
      "Header/Import any page",
      "Main/Learn more",
      "Main/Learn more-2",
    ]);
    for (const v of vars) {
      expect(v.type).toBe("STRING");
      expect(v.scopes).toEqual(["TEXT_CONTENT"]);
      expect(v.description).toBe("From the page in English, Svenska");
    }
    const keysOn = (plan: LayerPlan) => textOps(plan).map((op) => op.textKey);
    expect(keysOn(plans[0] as LayerPlan)).toEqual([
      "language:Header/Frottage",
      "language:Header/Import any page",
      ...Array(3).fill("language:Main/Learn more"),
      ...Array(3).fill("language:Main/Learn more-2"),
    ]);
    expect(keysOn(plans[1] as LayerPlan)).toEqual(keysOn(plans[0] as LayerPlan));
    expectResolves(layers, plans);
  });

  test("a device whose language page pairs under 80% still binds its paired texts", () => {
    const longer = { header: EN.header, main: [...EN.main, "Learn more", "Learn more"] };
    const few = { header: SV.header, main: SV.main.slice(0, 4) };
    const entries = [
      langEntry("en", "Laptop", EN),
      langEntry("en", "Phone", longer),
      langEntry("sv", "Laptop", SV),
      langEntry("sv", "Phone", few),
    ];
    const merge = mergeDevices(entries);
    const { layers, plans, report } = merge;
    expect("languageFrames" in merge).toBe(false);
    expect(modesOf(layers, "Language")).toEqual(["English", "Svenska"]);
    expect(textOps(plans[0] as LayerPlan).every((op) => op.textKey !== undefined)).toBe(true);
    // Six of the Phone's ten texts pair; the other four stay in English.
    expect(textOps(plans[1] as LayerPlan).map((op) => op.textKey !== undefined)).toEqual([
      ...Array(6).fill(true),
      ...Array(4).fill(false),
    ]);
    expect(report).toContain("Only 60% of the English page matches Svenska on Phone.");
    expect(report).toContain("4 texts have no Svenska version and stay in English.");
    expect(report.some((line) => line.startsWith("Only") && line.endsWith("on Laptop."))).toBe(
      false
    );
    expect(report.some((line) => line.includes("differs too much"))).toBe(false);
  });

  /** An entry whose elements `tags` are sections instead: their texts pair by place with none. */
  const elsewhere = (entry: DeviceEntry, ...tags: string[]): DeviceEntry => {
    const root = entry.capture.root as ElementNode;
    entry.capture.root = {
      ...root,
      children: root.children.map((c) =>
        c.kind === "element" && tags.includes(c.semantic.tag)
          ? { ...c, semantic: { ...c.semantic, tag: "section" } }
          : c
      ),
    };
    return entry;
  };

  test("a page that pairs no text makes no Language collection, and says why", () => {
    const unrelated = { header: ["Nyheter", "Kalender"], main: ["Om oss", "Kontakt"] };
    const { layers, plans, report } = mergeDevices([
      langEntry("en", "Laptop", EN),
      elsewhere(langEntry("sv", "Laptop", unrelated), "header", "main"),
    ]);
    expect(layers.collections.map((c) => c.kind)).not.toContain("language");
    expect(languageVars(layers)).toEqual([]);
    expect(textOps(plans[0] as LayerPlan).some((op) => op.textKey !== undefined)).toBe(false);
    expect(report).toContain("Only 0% of the English page matches Svenska on Laptop.");
    expect(report).toContain("8 texts have no Svenska version and stay in English.");
    expect(report).toContain("4 texts exist only in Svenska and weren't added.");
  });

  test("a page whose other language shares only its header binds the header", () => {
    // Like kth.se: the Svenska start page and the English one share the header, little else.
    const own = { ...LANGUAGES.sv, current: true } as PageLanguage;
    const other = { ...LANGUAGES.en, current: false } as PageLanguage;
    const header = ["KTH", "Utbildning", "Forskning", "Samverkan", "Om KTH", "Sök", "Meny"];
    const sv = { header, main: Array.from({ length: 13 }, (_, i) => `Nyhet ${i + 1}`) };
    const en = {
      header: ["KTH", "Education", "Research", "Collaboration", "About KTH", "Search", "Menu"],
      main: ["Welcome to KTH", "Study with us", "Find a programme"],
    };
    const entry = (code: "sv" | "en", name: keyof typeof DEVICES) => {
      const made = langEntry(code, name, code === "sv" ? sv : en);
      made.capture.language = code === "sv" ? own : other;
      return code === "en" ? elsewhere(made, "main") : made;
    };
    const { layers, plans, report } = mergeDevices([
      entry("sv", "Laptop"),
      entry("sv", "Phone"),
      entry("en", "Laptop"),
      entry("en", "Phone"),
    ]);
    expect(modesOf(layers, "Language")).toEqual(["Svenska", "English"]);
    for (const plan of plans.slice(0, 2)) {
      const bound = textOps(plan as LayerPlan).map((op) => op.textKey !== undefined);
      expect(bound).toEqual([...Array(7).fill(true), ...Array(13).fill(false)]);
    }
    expect(languageVars(layers).map((v) => v.values[1])).toEqual(en.header);
    expect(report).toContain("Only 35% of the Svenska page matches English on Laptop.");
    expect(report).toContain("Only 35% of the Svenska page matches English on Phone.");
    expect(report).toContain("26 texts have no English version and stay in Svenska.");
    expect(report).toContain("6 texts exist only in English and weren't added.");
  });

  test("with three languages, one that pairs nothing on a device keeps English there", () => {
    const de = { code: "de", name: "Deutsch", url: "https://lang.example.com/de", current: false };
    const DE = {
      header: ["Frottage", "Importiere jede Seite"],
      main: ["Mehr", "Mehr", "Mehr", "Weiter", "Weiter", "Weiter"],
    };
    const german = (name: keyof typeof DEVICES, copy: Copy) => {
      const made = langEntry("sv", name, copy);
      made.capture.language = de;
      return made;
    };
    const phoneEn = { header: ["Frottage", "Open menu"], main: EN.main };
    const phoneSv = { header: ["Frottage", "Öppna meny"], main: SV.main };
    const unrelated = { header: ["Neuigkeiten", "Kalender"], main: ["Über uns", "Kontakt"] };
    const { layers, plans, report } = mergeDevices([
      langEntry("en", "Laptop", EN),
      langEntry("en", "Phone", phoneEn),
      langEntry("sv", "Laptop", SV),
      langEntry("sv", "Phone", phoneSv),
      german("Laptop", DE),
      elsewhere(
        german("Phone", { ...unrelated, main: [...unrelated.main, ...DE.main] }),
        "header",
        "main"
      ),
    ]);
    expect(modesOf(layers, "Language")).toEqual(["English", "Svenska", "Deutsch"]);
    const laptopKeys = new Set(textOps(plans[0] as LayerPlan).map((op) => op.textKey));
    expect(textOps(plans[1] as LayerPlan).every((op) => op.textKey !== undefined)).toBe(true);
    const phoneOnly = languageVars(layers).filter((v) => !laptopKeys.has(v.key));
    expect(phoneOnly.length).toBeGreaterThan(0);
    for (const v of phoneOnly) expect(v.values[2]).toBe(v.values[0]);
    expect(phoneOnly.map((v) => v.values[1])).toContain("Öppna meny");
    expect(report).toContain("Only 0% of the English page matches Deutsch on Phone.");
    expect(report).toContain("8 texts have no Deutsch version and stay in English.");
    expect(report).toContain("10 texts exist only in Deutsch and weren't added.");
    expect(report.some((line) => line.includes("Svenska"))).toBe(false);
  });

  test("unpaired and mixed texts stay plain and are reported", () => {
    const mixed = textNode("m0", {
      text: "Läs mer",
      runs: [run({ end: 3 }), run({ start: 3, end: 7, weight: 700 })],
    });
    const sv = {
      header: [...SV.header, "Bara på svenska", "Också bara på svenska"],
      main: [mixed, ...SV.main.slice(1, 5)],
    };
    const entries = [langEntry("en", "Laptop", EN), langEntry("sv", "Laptop", sv)];
    const { plans, report } = mergeDevices(entries);
    expect(report).toContain("2 texts exist only in Svenska and weren't added.");
    expect(report).toContain("1 text has no Svenska version and stays in English.");
    expect(report).toContain("1 text with mixed styles stays in English.");
    const ops = textOps(plans[0] as LayerPlan);
    expect(ops[2]?.textKey).toBeUndefined();
    expect(ops[7]?.textKey).toBeUndefined();
    expect(ops.filter((op) => op.textKey !== undefined)).toHaveLength(6);
  });

  test("counts in the report lines are summed across devices", () => {
    const sv = { header: SV.header, main: SV.main.slice(0, 5) };
    const { report } = mergeDevices([
      langEntry("en", "Laptop", EN),
      langEntry("en", "Phone", EN),
      langEntry("sv", "Laptop", sv),
      langEntry("sv", "Phone", sv),
    ]);
    expect(report).toContain("2 texts have no Svenska version and stay in English.");
  });

  test("a set with no capture in the page's own language merges without languages", () => {
    const entries = [langEntry("en", "Laptop", EN), langEntry("sv", "Phone", SV)];
    for (const e of entries)
      e.capture.language = { ...(e.capture.language as PageLanguage), current: false };
    const { layers, report } = mergeDevices(entries);
    expect(layers.collections.map((c) => c.kind)).not.toContain("language");
    expect(report).toContain("No capture in the page's own language, so languages were left out.");
  });

  describe("in repeated parts", () => {
    const COMPONENTS = { ...LAYERED, components: true };
    /** Three `x-card`s in main, each holding one text: a component with three instances. */
    function cards(code: string, words: string[]): DeviceEntry {
      const row = {
        ...el("main", [0, 0]).layout,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
      } as ElementNode["layout"];
      const capture = cap(
        el(
          "root",
          [0, 0],
          [
            el(
              "main",
              [0, 0],
              words.map((w, i) =>
                el(
                  `card${i}`,
                  [i * 120, 0],
                  [{ ...text(`t${i}`, w), box: { x: i * 120, y: 0, w: 100, h: 20 } }],
                  { semantic: { tag: "x-card" } }
                )
              ),
              { semantic: { tag: "main", landmark: "main" }, layout: row }
            ),
          ],
          { semantic: { tag: "body" } }
        )
      );
      capture.source.viewport.w = 1512;
      capture.version = device("Laptop", 982);
      capture.language = LANGUAGES[code];
      return { capture, plan: mapCapture(capture, inter, COMPONENTS) };
    }
    const instances = (plan: LayerPlan) =>
      plan.ops.filter((op): op is Extract<PlanOp, { op: "instance" }> => op.op === "instance");
    const overrideKeys = (plan: LayerPlan) =>
      instances(plan).map((op) =>
        op.overrides.map((o) => (o.kind === "text" ? o.textKey : o.kind))
      );

    test("each instance's text binds, and the main binds its first occurrence's", () => {
      const en = cards("en", ["Learn more", "Learn more", "Learn more"]);
      expect(en.plan.report.components).toBe(1);
      const { layers, plans, report } = mergeDevices([
        en,
        cards("sv", ["Läs mer", "Mer info", "Läs mer"]),
      ]);
      const vars = languageVars(layers);
      expect(vars.map((v) => v.values)).toEqual([
        ["Learn more", "Läs mer"],
        ["Learn more", "Mer info"],
      ]);
      const [first, second] = vars.map((v) => v.key);
      const plan = plans[0] as LayerPlan;
      expect(textOps(plan).map((op) => op.textKey)).toEqual([first]);
      // The first occurrence is the main, so its instance shows the main's binding.
      expect(overrideKeys(plan)).toEqual([[], [second], [first]]);
      expect(vars.map((v) => v.name)).toEqual(["Main/Learn more", "Main/Learn more-2"]);
      expect(JSON.stringify(plan.ops)).not.toContain('"source"');
      expect(report.some((line) => line.includes("repeated"))).toBe(false);
      expectResolves(layers, plans);
    });

    test("a paired text no layer shows on its own is reported", () => {
      const en = cards("en", ["Learn more", "Learn more", "Learn more"]);
      for (const op of instances(en.plan)) op.overrides = [];
      const { layers, report } = mergeDevices([en, cards("sv", ["Läs mer", "Läs mer", "Läs mer"])]);
      expect(languageVars(layers)).toHaveLength(1);
      expect(report).toContain("2 texts in repeated parts stay in English.");
    });
  });

  test("texts past the Language cap stay plain and are reported once", () => {
    const many = (prefix: string) =>
      Array.from({ length: MAX_LANGUAGE_VARIABLES + 3 }, (_, i) => `${prefix} ${i}`);
    const entries = [
      langEntry("en", "Laptop", { header: [], main: many("Item") }),
      langEntry("sv", "Laptop", { header: [], main: many("Sak") }),
    ];
    const { layers, report } = mergeDevices(entries);
    expect(languageVars(layers)).toHaveLength(MAX_LANGUAGE_VARIABLES);
    expect(report).toContain("3 texts stay in English: the Language collection is full.");
  });
});
