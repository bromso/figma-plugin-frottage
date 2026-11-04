import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportOptions,
  type PlanEffectStyle,
  type PlanGradientStyle,
  type PlanLayers,
  type PlanVariable,
} from "@repo/figma-mapper";
import { createLayerSet, getModeLimit } from "../layers";
import { createTokenSet, type TokenRuntime } from "../tokens";
import { fakeFigma } from "./fake-figma";

type Fake = ReturnType<typeof fakeFigma>;
type Rgba = { r: number; g: number; b: number; a: number };

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const NIGHT: Rgba = { r: 0.125, g: 0.125, b: 0.25, a: 1 };
const GRAY: Rgba = { r: 0.875, g: 0.875, b: 0.75, a: 1 };

const NAMES = {
  palette: "Palette",
  spacing: "Spacing",
  radius: "Border radius",
  typography: "Typography",
  device: "Device",
  breakpoint: "Breakpoint",
  colorMode: "Color Mode",
  language: "Language",
  theme: "Theme",
} as const;

const raw = (
  collection: "palette" | "spacing" | "radius" | "typography",
  name: string,
  type: "COLOR" | "FLOAT",
  value: Rgba | number,
  scopes: string[]
): PlanVariable => ({
  key: `${collection}:${name}`,
  name,
  collection,
  type,
  values: [value],
  description: `From the site: --${name.replace("/", "-")}`,
  scopes,
});
const white = raw("palette", "white", "COLOR", WHITE, ["ALL_FILLS"]);
const night = raw("palette", "night", "COLOR", NIGHT, ["ALL_FILLS"]);
const gray = {
  ...raw("palette", "gray/200", "COLOR", GRAY, ["ALL_FILLS", "STROKE_COLOR"]),
  cssVar: "--gray-200",
};
const space = raw("spacing", "spacing/4", "FLOAT", 16, ["GAP"]);
const radius = { ...raw("radius", "radius/lg", "FLOAT", 8, ["CORNER_RADIUS"]), cssVar: "--radius" };
const textSm = raw("typography", "text/sm", "FLOAT", 14, ["FONT_SIZE"]);
const card: PlanVariable = {
  key: "colorMode:card",
  name: "card",
  collection: "colorMode",
  type: "COLOR",
  values: [{ alias: white.key }, { alias: night.key }],
  description: "From the site: --card",
  scopes: ["FRAME_FILL", "SHAPE_FILL"],
  cssVar: "--card",
};
const border: PlanVariable = {
  key: "colorMode:border",
  name: "border",
  collection: "colorMode",
  type: "COLOR",
  values: [{ alias: gray.key }, { alias: gray.key }],
  description: "Inferred: the color of most borders\nNear twin of input",
  scopes: ["STROKE_COLOR"],
};
const token = (source: PlanVariable, name: string): PlanVariable => ({
  key: `theme:${name}`,
  name,
  collection: "theme",
  type: source.type,
  values: [{ alias: source.key }],
  description: `Final theme token; source: ${NAMES[source.collection]}`,
  scopes: source.scopes,
  ...(source.cssVar ? { cssVar: source.cssVar } : {}),
});
const themeCard = token(card, "color/card");
const themeBorder = token(border, "color/border");
const themeGray = token(gray, "color/gray/200");
const themeSpace = token(space, "spacing/4");
const themeRadius = token(radius, "radius/lg");
const themeText = token(textSm, "text/sm");
const ALL = [
  white,
  night,
  gray,
  space,
  radius,
  textSm,
  card,
  border,
  themeCard,
  themeBorder,
  themeGray,
  themeSpace,
  themeRadius,
  themeText,
];
const shadow: PlanEffectStyle = {
  key: "shadow:sm",
  name: "shadow/sm",
  shadows: [
    {
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 1 },
      radius: 2,
      spread: 0,
    },
  ],
  colorKeys: [themeCard.key],
};
const gradient: PlanGradientStyle = {
  key: "gradient:hero",
  name: "gradient/hero",
  paint: {
    type: "GRADIENT_LINEAR",
    transform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    stops: [
      { position: 0, color: GRAY },
      { position: 1, color: WHITE },
    ],
  },
  stopKeys: [themeGray.key, null],
};

const collectionsFor = (modes: string[]) =>
  (Object.keys(NAMES) as (keyof typeof NAMES)[]).map((kind) => ({
    kind,
    name: NAMES[kind],
    modes: kind === "colorMode" ? modes : [kind === "theme" ? "Default" : "Base"],
  }));

// As the mapper lays them out: grouped by collection, in creation order.
const layers = (over: Partial<PlanLayers> = {}): PlanLayers => ({
  hostname: "example.com",
  modes: ["Light", "Dark"],
  themeSource: "site",
  collections: collectionsFor(["Light", "Dark"]),
  variables: ALL,
  effectStyles: [shadow],
  gradientStyles: [gradient],
  notes: { twins: [], inferred: [], droppedPrimitives: 0 },
  ...over,
});
const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...over,
});
const runtimeFor = (over: Partial<TokenRuntime> = {}): TokenRuntime => ({
  overBudget: () => false,
  breathe: async () => true,
  ensureFont: async () => true,
  ...over,
});

async function settle(f: Fake, plan = layers(), opts = options(), runtime = runtimeFor()) {
  const set = createLayerSet(f.figma);
  await set.resolve(plan, opts, runtime);
  return set;
}

const collectionNamed = (f: Fake, name: string): any =>
  [...f.tokens.collections.values()].find((c) => c.name === name);
const collectionNames = (f: Fake) => [...f.tokens.collections.values()].map((c: any) => c.name);
/** A variable by name in a collection by name. */
const variableIn = (f: Fake, collection: string, name: string): any => {
  const c = collectionNamed(f, collection);
  return [...f.tokens.variables.values()].find(
    (v) => v.name === name && v.variableCollectionId === c?.id
  );
};
const modesOf = (c: any) => c?.modes.map((m: { name: string }) => m.name);
const modeId = (c: any, name: string) =>
  c?.modes.find((m: { name: string }) => m.name === name)?.modeId;
const aliasTo = (v: any) => ({ type: "VARIABLE_ALIAS", id: v?.id });
const near = (a: Rgba | undefined, b: Rgba) => {
  for (const c of ["r", "g", "b", "a"] as const) expect(a?.[c]).toBeCloseTo(b[c], 5);
};

describe("createLayerSet", () => {
  test("creates the six collections with their names, modes and tags", async () => {
    const f = fakeFigma();
    const set = await settle(f);
    expect(collectionNames(f)).toEqual([
      "Palette",
      "Spacing",
      "Border radius",
      "Typography",
      "Color Mode",
      "Theme",
    ]);
    for (const kind of ["palette", "spacing", "radius", "typography"] as const) {
      const c = collectionNamed(f, NAMES[kind]);
      expect(modesOf(c)).toEqual(["Base"]);
      expect(c.getSharedPluginData("frottage", "collection")).toBe(`example.com#layer:${kind}`);
    }
    expect(modesOf(collectionNamed(f, "Color Mode"))).toEqual(["Light", "Dark"]);
    expect(collectionNamed(f, "Color Mode").getSharedPluginData("frottage", "collection")).toBe(
      "example.com#layer:colorMode"
    );
    expect(modesOf(collectionNamed(f, "Theme"))).toEqual(["Default"]);
    expect(collectionNamed(f, "Theme").getSharedPluginData("frottage", "collection")).toBe(
      "example.com#layer:theme"
    );

    const grayVar = variableIn(f, "Palette", "gray/200");
    near(grayVar.valuesByMode[collectionNamed(f, "Palette").defaultModeId], GRAY);
    expect(grayVar.scopes).toEqual(["ALL_FILLS", "STROKE_COLOR"]);
    expect(grayVar.codeSyntax.WEB).toBe("var(--gray-200)");
    expect(
      variableIn(f, "Border radius", "radius/lg").valuesByMode[
        collectionNamed(f, "Border radius").defaultModeId
      ]
    ).toBe(8);
    expect(variableIn(f, "Spacing", "spacing/4")).toBeDefined();
    expect(variableIn(f, "Typography", "text/sm")).toBeDefined();
    expect(variableIn(f, "Color Mode", "border").description).toBe(border.description);
    const themeCardVar = variableIn(f, "Theme", "color/card");
    expect(themeCardVar.description).toBe("Final theme token; source: Color Mode");
    expect(themeCardVar.scopes).toEqual(["FRAME_FILL", "SHAPE_FILL"]);

    expect(set.counts()).toMatchObject({
      variablesCreated: 14,
      variablesReused: 0,
      variablesRenamed: 0,
      modesDropped: [],
      stylesCreated: 2,
      stylesReused: 0,
      legacyCollections: false,
    });
  });

  test("Theme aliases Color Mode, which aliases the Palette per mode", async () => {
    const f = fakeFigma();
    await settle(f);
    const colorMode = collectionNamed(f, "Color Mode");
    const theme = collectionNamed(f, "Theme");
    const cardVar = variableIn(f, "Color Mode", "card");
    const themeCardVar = variableIn(f, "Theme", "color/card");
    expect(themeCardVar.valuesByMode).toEqual({ [modeId(theme, "Default")]: aliasTo(cardVar) });
    expect(cardVar.valuesByMode[modeId(colorMode, "Light")]).toEqual(
      aliasTo(variableIn(f, "Palette", "white"))
    );
    expect(cardVar.valuesByMode[modeId(colorMode, "Dark")]).toEqual(
      aliasTo(variableIn(f, "Palette", "night"))
    );
    expect(variableIn(f, "Theme", "radius/lg").valuesByMode[modeId(theme, "Default")]).toEqual(
      aliasTo(variableIn(f, "Border radius", "radius/lg"))
    );
  });

  test("theme: keys resolve to the Theme variables, and the modes to Color Mode", async () => {
    const f = fakeFigma();
    const set = await settle(f);
    expect(set.variable(themeCard.key)).toBe(variableIn(f, "Theme", "color/card"));
    expect(set.variable(themeRadius.key)).toBe(variableIn(f, "Theme", "radius/lg"));
    const colorMode = collectionNamed(f, "Color Mode");
    expect(set.themeMode("Dark")).toEqual({
      collection: colorMode,
      modeId: modeId(colorMode, "Dark"),
    });
    expect(set.openingMode()).toEqual({
      collection: colorMode,
      modeId: modeId(colorMode, "Light"),
    });
    const dark = await settle(fakeFigma(), layers({ activeMode: "Dark" }));
    expect(dark.openingMode()?.modeId).toBe(dark.themeMode("Dark")?.modeId);
  });

  test("binds effect and gradient styles to the Theme variables", async () => {
    const f = fakeFigma();
    const set = await settle(f);
    const effect: any = [...f.tokens.effectStyles.values()][0];
    expect(effect.name).toBe("shadow/sm");
    expect(set.effectStyleId(shadow.key)).toBe(effect.id);
    expect(effect.effects[0].boundVariables.color.id).toBe(variableIn(f, "Theme", "color/card").id);
    const paint: any = [...f.tokens.paintStyles.values()].find((s) => s.name === "gradient/hero");
    expect(set.gradientStyleId(gradient.key)).toBe(paint?.id);
    const [first, last] = paint?.paints[0].gradientStops ?? [];
    expect(first.boundVariables.color.id).toBe(variableIn(f, "Theme", "color/gray/200").id);
    expect(last.boundVariables).toBeUndefined();
  });

  test("PR #7's collections for the host are left untouched and reported", async () => {
    const f = fakeFigma();
    const old = f.tokens.seedCollection("example.com · Theme", ["Light", "Dark"]);
    old.setSharedPluginData("frottage", "collection", "example.com#theme");
    const oldCard = f.tokens.seedVariable("card", old, WHITE);
    oldCard.setSharedPluginData("frottage", "valueKey", "theme:card");
    const held = structuredClone(oldCard.valuesByMode);
    f.tokens.writes.length = 0;
    const set = await settle(f);
    expect(f.tokens.writes.filter((w) => w.startsWith("example.com · Theme"))).toEqual([]);
    expect(oldCard.valuesByMode).toEqual(held);
    expect(modesOf(old)).toEqual(["Light", "Dark"]);
    expect(old.getSharedPluginData("frottage", "collection")).toBe("example.com#theme");
    expect(collectionNamed(f, "Theme")).toBeDefined();
    expect(set.counts().legacyCollections).toBe(true);
    expect(set.counts().variablesCreated).toBe(14);

    // Another host's old collection says nothing about this one.
    const g = fakeFigma();
    const other = g.tokens.seedCollection("other.com · Primitives");
    other.setSharedPluginData("frottage", "collection", "other.com#primitives");
    expect((await settle(g)).counts().legacyCollections).toBe(false);
  });

  test("a user's collection called Palette leads to Palette (Frottage)", async () => {
    const f = fakeFigma();
    const users = f.tokens.seedCollection("Palette");
    const theirs = f.tokens.seedVariable("white", users, { r: 0.5, g: 0.5, b: 0.5, a: 1 });
    const held = structuredClone(theirs.valuesByMode);
    await settle(f);
    expect(users.name).toBe("Palette");
    expect(theirs.valuesByMode).toEqual(held);
    expect(f.tokens.writes.filter((w) => w.startsWith("Palette:"))).toEqual([]);
    const own = collectionNamed(f, "Palette (Frottage)");
    expect(own.getSharedPluginData("frottage", "collection")).toBe("example.com#layer:palette");
    expect(variableIn(f, "Palette (Frottage)", "white")).toBeDefined();
    // Found again by its tag, not by name.
    const again = await settle(f);
    expect(again.counts().variablesCreated).toBe(0);
    expect(collectionNamed(f, "Palette (Frottage) (2)")).toBeUndefined();
  });

  test("another host's Palette leads to Palette (other.com), then (2)", async () => {
    const f = fakeFigma();
    const theirs = f.tokens.seedCollection("Palette");
    theirs.setSharedPluginData("frottage", "collection", "other.com#layer:palette");
    await settle(f);
    expect(theirs.name).toBe("Palette");
    expect(collectionNamed(f, "Palette (example.com)")).toBeDefined();

    const g = fakeFigma();
    const a = g.tokens.seedCollection("Palette");
    a.setSharedPluginData("frottage", "collection", "other.com#layer:palette");
    g.tokens.seedCollection("Palette (example.com)");
    await settle(g);
    expect(collectionNamed(g, "Palette (example.com) (2)")).toBeDefined();
  });

  test("importing the same plan twice creates nothing the second time", async () => {
    const f = fakeFigma();
    await settle(f);
    const before = f.tokens.log.length;
    const set = await settle(f);
    const made = f.tokens.log
      .slice(before)
      // An alias is a value to compare with, not a token in the file.
      .filter((c) => /^create(?!VariableAlias)|addMode|setValueForMode|renameMode/.test(c));
    expect(made).toEqual([]);
    expect(set.counts()).toMatchObject({
      variablesCreated: 0,
      variablesReused: 14,
      variablesRenamed: 0,
      modesDropped: [],
      stylesCreated: 0,
      stylesReused: 0,
      legacyCollections: false,
    });
    expect(f.tokens.collections.size).toBe(6);
    expect(set.variable(themeCard.key)).toBe(variableIn(f, "Theme", "color/card"));
  });

  test("a changed value leaves the old variable and creates <name> (2)", async () => {
    const f = fakeFigma();
    await settle(f);
    const old = variableIn(f, "Color Mode", "card");
    const oldValues = structuredClone(old.valuesByMode);
    const changed = { ...card, values: [{ alias: white.key }, { alias: gray.key }] };
    const plan = layers({ variables: ALL.map((v) => (v === card ? changed : v)) });
    const set = await settle(f, plan);
    expect(old.valuesByMode).toEqual(oldValues);
    const second = variableIn(f, "Color Mode", "card (2)");
    expect(set.variable(card.key)).toBe(second);
    // Theme's card now points at the new one, so it too is new.
    expect(set.variable(themeCard.key)).toBe(variableIn(f, "Theme", "color/card (2)"));
    expect(set.counts()).toMatchObject({ variablesCreated: 2, variablesRenamed: 2 });
    const again = await settle(f, plan);
    expect(again.variable(card.key)).toBe(second);
    expect(again.counts().variablesCreated).toBe(0);
  });

  test("a mode limit of 1 drops Dark from Color Mode only", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const set = await settle(f);
    expect(set.counts().modesDropped).toEqual(["Dark"]);
    expect(collectionNames(f)).toHaveLength(6);
    const colorMode = collectionNamed(f, "Color Mode");
    expect(modesOf(colorMode)).toEqual(["Light"]);
    expect(modesOf(collectionNamed(f, "Palette"))).toEqual(["Base"]);
    expect(modesOf(collectionNamed(f, "Theme"))).toEqual(["Default"]);
    const cardVar = variableIn(f, "Color Mode", "card");
    expect(Object.keys(cardVar.valuesByMode)).toEqual([colorMode.defaultModeId]);
    expect(Object.values(cardVar.valuesByMode)).toEqual([
      aliasTo(variableIn(f, "Palette", "white")),
    ]);
    expect(set.themeMode("Dark")).toBeNull();
    expect(set.openingMode()?.modeId).toBe(colorMode.defaultModeId);
  });

  test("with local styles, a palette color equal to a user's variable binds to it", async () => {
    const f = fakeFigma();
    const brand = f.tokens.seedCollection("Brand");
    const theirs = f.tokens.seedVariable("neutral/200", brand, GRAY);
    // A user's number of the same value is never taken: only Palette colors are.
    f.tokens.seedVariable("eight", brand, 8, "FLOAT");
    const set = await settle(f);
    expect(set.variable(gray.key)?.id).toBe(theirs.id);
    expect(variableIn(f, "Palette", "gray/200")).toBeUndefined();
    expect(variableIn(f, "Border radius", "radius/lg")).toBeDefined();
    const borderVar = variableIn(f, "Color Mode", "border");
    expect(Object.values(borderVar.valuesByMode)[0]).toEqual(aliasTo(theirs));
    expect(f.tokens.writes.filter((w) => w.startsWith("neutral/200"))).toEqual([]);
    expect(set.counts()).toMatchObject({ variablesCreated: 13, variablesReused: 1 });

    const g = fakeFigma();
    g.tokens.seedVariable("neutral/200", g.tokens.seedCollection("Brand"), GRAY);
    const off = await settle(g, layers(), options({ useLocalStyles: false }));
    expect(off.variable(gray.key)?.name).toBe("gray/200");
  });

  test("a user's multi-mode color is not reused, so a mode switch cannot recolor the page", async () => {
    const f = fakeFigma();
    const ds = f.tokens.seedCollection("DS Theme", ["Light", "Dark"]);
    f.tokens.seedVariable("surface/default", ds, GRAY);
    const brand = f.tokens.seedCollection("Brand");
    const single = f.tokens.seedVariable("neutral/200", brand, GRAY);
    const set = await settle(f);
    // The single-mode one is still taken; the multi-mode one never is.
    expect(set.variable(gray.key)?.id).toBe(single.id);

    const g = fakeFigma();
    const ds2 = g.tokens.seedCollection("DS Theme", ["Light", "Dark"]);
    const surface = g.tokens.seedVariable("surface/default", ds2, GRAY);
    const set2 = await settle(g);
    expect(set2.variable(gray.key)?.id).not.toBe(surface.id);
    expect(variableIn(g, "Palette", "gray/200")).toBeDefined();
    const borderVar = variableIn(g, "Color Mode", "border");
    expect(Object.values(borderVar.valuesByMode)[0]).not.toEqual(aliasTo(surface));
  });

  test("a plan without its collections still lands in the six, by kind", async () => {
    const f = fakeFigma();
    await settle(f, layers({ collections: [] }));
    expect(collectionNames(f)).toEqual([
      "Palette",
      "Spacing",
      "Border radius",
      "Typography",
      "Color Mode",
      "Theme",
    ]);
    expect(modesOf(collectionNamed(f, "Color Mode"))).toEqual(["Light", "Dark"]);
  });

  test("discard after a partial import removes the created collections, top layer first", async () => {
    const f = fakeFigma();
    const set = createLayerSet(f.figma);
    const runtime = runtimeFor({
      overBudget: () => true,
      breathe: async () => {
        // Partway through the Color Mode variables.
        if (variableIn(f, "Color Mode", "card")) await set.discard();
      },
    });
    await set.resolve(layers(), options(), runtime);
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.effectStyles.size).toBe(0);
    expect(f.tokens.paintStyles.size).toBe(0);
    expect(f.tokens.count("createVariable")).toBeGreaterThan(0);
    expect(f.tokens.count("createVariable")).toBeLessThan(14);
    // Each collection goes before the ones it aliases.
    const removed = f.tokens.writes.filter((w) => w.startsWith("remove collection "));
    expect(removed[0]).toBe("remove collection Color Mode");
    expect(removed.at(-1)).toBe("remove collection Palette");
  });

  test("discard after a whole import keeps nothing it made", async () => {
    const f = fakeFigma();
    const set = await settle(f);
    await set.discard();
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.effectStyles.size).toBe(0);
    expect(f.tokens.paintStyles.size).toBe(0);
  });
});

describe("the token set with layers", () => {
  test("delegates its lookups to the layer set and counts it", async () => {
    const f = fakeFigma();
    const tokens = createTokenSet(f.figma);
    await tokens.resolve(
      { textStyles: [], colors: [], spacing: [], collection: "example.com", layers: layers() },
      options(),
      runtimeFor()
    );
    const cardVar = variableIn(f, "Theme", "color/card");
    expect(tokens.color(themeCard.key)).toEqual({ variable: cardVar });
    const radiusVar = variableIn(f, "Theme", "radius/lg");
    expect(tokens.radius(themeRadius.key)).toBe(radiusVar);
    expect(tokens.spacing(themeRadius.key)).toBe(radiusVar);
    expect(tokens.effectStyleId(shadow.key)).toBe([...f.tokens.effectStyles.keys()][0]);
    expect(tokens.gradientStyleId(gradient.key)).toBeDefined();
    expect(tokens.openingMode()?.collection).toBe(collectionNamed(f, "Color Mode"));
    expect(tokens.counts()).toMatchObject({
      variablesCreated: 14,
      stylesCreated: 2,
      stylesReused: 0,
      layers: {
        variablesCreated: 14,
        variablesReused: 0,
        variablesRenamed: 0,
        modesDropped: [],
        stylesCreated: 2,
        stylesReused: 0,
        legacyCollections: false,
      },
    });
    await tokens.discard();
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
  });

  test("without layers the new lookups find nothing", async () => {
    const f = fakeFigma();
    const tokens = createTokenSet(f.figma);
    await tokens.resolve(
      { textStyles: [], colors: [], collection: "example.com" },
      options(),
      runtimeFor()
    );
    expect(tokens.radius("theme:radius/lg")).toBeUndefined();
    expect(tokens.effectStyleId("shadow:sm")).toBeUndefined();
    expect(tokens.counts().layers).toBeUndefined();
  });

  test("a re-import of 1,000 tokens over 1,000 of the user's reads each variable a few times", async () => {
    const f = fakeFigma();
    const theirs = f.tokens.seedCollection("Brand");
    for (let i = 0; i < 1000; i++) {
      f.tokens.seedVariable(`brand/${i}`, theirs, { r: 0, g: 0, b: i / 2000, a: 1 });
    }
    const many: PlanVariable[] = Array.from({ length: 1000 }, (_, i) => ({
      ...gray,
      key: `palette:c${i}`,
      name: `c${i}`,
      values: [{ r: 1, g: i / 1000, b: 0, a: 1 }],
    }));
    const plan = layers({ variables: many, effectStyles: [], gradientStyles: [] });
    await settle(f, plan);

    // Count every read of what the scans look at, on the second import.
    let reads = 0;
    const watched = new Set(["variableCollectionId", "valuesByMode", "name", "resolvedType"]);
    const local = f.figma.variables.getLocalVariablesAsync.bind(f.figma.variables);
    f.figma.variables.getLocalVariablesAsync = async () =>
      (await local()).map(
        (v) =>
          new Proxy(v, {
            get(target, prop, receiver) {
              if (watched.has(prop as string) || prop === "getSharedPluginData") reads++;
              return Reflect.get(target, prop, receiver);
            },
          })
      );
    const again = await settle(f, plan);
    expect(again.counts().variablesReused).toBe(1000);
    expect(again.counts().variablesCreated).toBe(0);
    // Linear in tokens plus variables: a scan per token would be about two million.
    expect(reads).toBeLessThan(20_000);
  });
});

describe("device and breakpoint modes", () => {
  const sized = (
    collection: "device" | "breakpoint",
    name: string,
    values: number[]
  ): PlanVariable => ({
    key: `${collection}:${name}`,
    name,
    collection,
    type: "FLOAT",
    values,
    description: "",
    scopes: ["WIDTH_HEIGHT"],
  });
  const deviceWidth = sized("device", "device/width", [1440, 768, 390]);
  const minWidth = sized("breakpoint", "breakpoint/min-width", [0, 768, 1024]);
  const withDevices = (colorModes = ["Light", "Dark"]) =>
    layers({
      modes: colorModes,
      collections: collectionsFor(colorModes).map((c) =>
        c.kind === "device"
          ? { ...c, modes: ["Desktop", "Tablet", "Phone"] }
          : c.kind === "breakpoint"
            ? { ...c, modes: ["base", "md", "lg"] }
            : c
      ),
      variables: [...ALL, deviceWidth, minWidth],
    });

  test("modeOf finds a mode of any kind by its name", async () => {
    const f = fakeFigma();
    const set = await settle(f, withDevices());
    const device = collectionNamed(f, "Device");
    const breakpoint = collectionNamed(f, "Breakpoint");
    expect(modesOf(device)).toEqual(["Desktop", "Tablet", "Phone"]);
    expect(set.modeOf("device", "Tablet")).toEqual({
      collection: device,
      modeId: modeId(device, "Tablet"),
    });
    expect(set.modeOf("breakpoint", "lg")).toEqual({
      collection: breakpoint,
      modeId: modeId(breakpoint, "lg"),
    });
    expect(set.modeOf("colorMode", "Dark")?.modeId).toBe(
      modeId(collectionNamed(f, "Color Mode"), "Dark")
    );
    expect(set.modeOf("device", "Watch")).toBeNull();
  });

  test("a mode the file had no room for is null", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    const set = await settle(f, withDevices());
    expect(set.modeOf("device", "Tablet")).not.toBeNull();
    expect(set.modeOf("device", "Phone")).toBeNull();
    expect(set.counts().modesDropped).toEqual(["Phone", "lg"]);
  });

  test("counts name each collection's modes that exist, and those added to one already there", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    const first = await settle(f, withDevices());
    const modes = (set: typeof first, kind: string) =>
      set.counts().modes.find((m) => m.kind === kind);
    expect(modes(first, "device")).toEqual({
      kind: "device",
      collection: "Device",
      created: ["Desktop", "Tablet"],
      added: [],
    });
    expect(modes(first, "breakpoint")?.created).toEqual(["base", "md"]);

    // Again, with room: the modes left out before are added now.
    const again = fakeFigma();
    await settle(
      again,
      layers({
        modes: ["Light", "Dark"],
        collections: collectionsFor(["Light", "Dark"]).map((c) =>
          c.kind === "breakpoint" ? { ...c, modes: ["base", "md"] } : c
        ),
        variables: [...ALL, minWidth],
      })
    );
    const second = await settle(again, withDevices());
    expect(modes(second, "breakpoint")).toEqual({
      kind: "breakpoint",
      collection: "Breakpoint",
      created: ["base", "md", "lg"],
      added: ["lg"],
    });
    expect(modes(second, "device")?.added).toEqual([]);
  });

  test("a refusal of Limited to 3 modes only stores 3, which getModeLimit gives", async () => {
    const f = fakeFigma({ modeLimit: 3 });
    expect(await getModeLimit(f.figma)).toBeNull();
    await settle(f, withDevices(["Light", "Dark", "Sepia", "Night"]));
    expect(f.storage.get("modeLimit")).toBe(3);
    expect(await getModeLimit(f.figma)).toBe(3);
  });

  test("with room for every mode nothing is stored", async () => {
    const f = fakeFigma();
    await settle(f, withDevices());
    expect(f.storage.has("modeLimit")).toBe(false);
  });

  // Mainline: smallest to largest, the frames' ranges (min 1400, md, base) leading the priority.
  const ASCENDING = ["base", "sm", "md", "lg", "xl", "min 1400"];
  const PRIORITY = ["min 1400", "md", "base", "xl", "lg", "sm"];
  const mainline = (labels = ASCENDING, priority: string[] | undefined = PRIORITY) =>
    layers({
      collections: collectionsFor(["Light", "Dark"]).map((c) =>
        c.kind === "breakpoint" ? { ...c, modes: labels, ...(priority ? { priority } : {}) } : c
      ),
      variables: [
        ...ALL,
        sized(
          "breakpoint",
          "breakpoint/min-width",
          labels.map((l) => [0, 640, 768, 1024, 1280, 1400][ASCENDING.indexOf(l)] as number)
        ),
      ],
    });

  test("Breakpoint modes are made smallest to largest", async () => {
    const f = fakeFigma();
    const set = await settle(f, mainline());
    const breakpoint = collectionNamed(f, "Breakpoint");
    expect(modesOf(breakpoint)).toEqual(ASCENDING);
    expect(breakpoint.defaultModeId).toBe(modeId(breakpoint, "base"));
    expect(set.counts().modes.find((m) => m.kind === "breakpoint")?.created).toEqual(ASCENDING);
  });

  test("at a limit of 4 a new collection keeps the frames' modes, smallest to largest", async () => {
    const f = fakeFigma({ modeLimit: 4 });
    const set = await settle(f, mainline());
    const breakpoint = collectionNamed(f, "Breakpoint");
    expect(modesOf(breakpoint)).toEqual(["base", "md", "xl", "min 1400"]);
    expect(breakpoint.defaultModeId).toBe(modeId(breakpoint, "base"));
    for (const frame of ["base", "md", "min 1400"]) {
      expect(set.modeOf("breakpoint", frame)?.modeId).toBe(modeId(breakpoint, frame));
    }
    expect(set.modeOf("breakpoint", "sm")).toBeNull();
    expect(set.counts().modesDropped).toEqual(["sm", "lg"]);
    expect(set.counts().modes.find((m) => m.kind === "breakpoint")?.created).toEqual([
      "base",
      "md",
      "xl",
      "min 1400",
    ]);
    expect(f.storage.get("modeLimit")).toBe(4);
    // Every variable holds a value in each mode kept.
    const minWidth = variableIn(f, "Breakpoint", "breakpoint/min-width");
    expect(
      breakpoint.modes.map((m: { modeId: string }) => minWidth.valuesByMode[m.modeId])
    ).toEqual([0, 768, 1280, 1400]);
  });

  test("a remembered limit chooses the modes up front, with no refusal", async () => {
    const f = fakeFigma({ modeLimit: 4 });
    await f.figma.clientStorage.setAsync("modeLimit", 4);
    const set = await settle(f, mainline());
    expect(modesOf(collectionNamed(f, "Breakpoint"))).toEqual(["base", "md", "xl", "min 1400"]);
    expect(f.tokens.writes.filter((w) => w.startsWith("Breakpoint: remove mode"))).toEqual([]);
    expect(set.counts().modesDropped).toEqual(["sm", "lg"]);
  });

  test("a remembered limit the file no longer has still makes every mode", async () => {
    const f = fakeFigma();
    await f.figma.clientStorage.setAsync("modeLimit", 4);
    const set = await settle(f, mainline());
    expect(modesOf(collectionNamed(f, "Breakpoint"))).toEqual(ASCENDING);
    expect(set.counts().modesDropped).toEqual([]);
  });

  test("a re-import appends the new modes after the ones already there", async () => {
    const f = fakeFigma();
    await settle(f, mainline(["base", "md", "min 1400"], ["min 1400", "md", "base"]));
    const set = await settle(f, mainline());
    expect(modesOf(collectionNamed(f, "Breakpoint"))).toEqual([
      "base",
      "md",
      "min 1400",
      "sm",
      "lg",
      "xl",
    ]);
    expect(set.counts().modes.find((m) => m.kind === "breakpoint")?.added).toEqual([
      "sm",
      "lg",
      "xl",
    ]);
  });

  test("a re-import at a limit appends the next by priority, smallest to largest", async () => {
    const f = fakeFigma({ modeLimit: 5 });
    await settle(f, mainline(["base", "md", "min 1400"], ["min 1400", "md", "base"]));
    const set = await settle(f, mainline());
    expect(modesOf(collectionNamed(f, "Breakpoint"))).toEqual([
      "base",
      "md",
      "min 1400",
      "lg",
      "xl",
    ]);
    expect(set.counts().modesDropped).toEqual(["sm"]);
  });

  describe("a Breakpoint collection already there", () => {
    const labels = ["base", "md", "lg"];
    const plan = () =>
      layers({
        collections: collectionsFor(["Light", "Dark"]).map((c) =>
          c.kind === "breakpoint" ? { ...c, modes: labels } : c
        ),
        variables: [...ALL, sized("breakpoint", "breakpoint/min-width", [0, 768, 1024])],
      });
    const seeded = (f: Fake, modes: string[]) => {
      const old = f.tokens.seedCollection("Breakpoint", modes);
      old.setSharedPluginData("frottage", "collection", "example.com#layer:breakpoint");
      return old;
    };

    test("a mode already named for a label keeps it, whatever the default mode is called", async () => {
      const f = fakeFigma();
      const old = seeded(f, ["Mode 1", "base"]);
      const [, baseMode] = old.modes;
      const set = await settle(f, plan());
      expect(set.modeOf("breakpoint", "base")?.modeId).toBe(baseMode.modeId);
      expect(modesOf(old)).toEqual(["Mode 1", "base", "md", "lg"]);
      const width = variableIn(f, "Breakpoint", "breakpoint/min-width");
      expect(width.valuesByMode[baseMode.modeId]).toBe(0);
      expect(width.valuesByMode[modeId(old, "md")]).toBe(768);
      expect(width.valuesByMode[modeId(old, "lg")]).toBe(1024);
    });

    test("a mode outside the labels reads the widest, not the narrowest", async () => {
      const f = fakeFigma();
      const old = seeded(f, ["Mode 1", "base"]);
      await settle(f, plan());
      const width = variableIn(f, "Breakpoint", "breakpoint/min-width");
      expect(width.valuesByMode[old.defaultModeId]).toBe(1024);
    });

    test("a default mode with none of the labels still becomes the first's", async () => {
      const f = fakeFigma();
      const old = seeded(f, ["Mode 1"]);
      await settle(f, plan());
      expect(modesOf(old)).toEqual(["Mode 1", "md", "lg"]);
      const width = variableIn(f, "Breakpoint", "breakpoint/min-width");
      expect(width.valuesByMode[old.defaultModeId]).toBe(0);
    });
  });

  test("getModeLimit ignores a stored value that is not a positive whole number", async () => {
    const f = fakeFigma();
    for (const bad of ["3", -1, 0, 2.5, null, { n: 3 }]) {
      await f.figma.clientStorage.setAsync("modeLimit", bad);
      expect(await getModeLimit(f.figma)).toBeNull();
    }
  });
});
