import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportOptions,
  type PlanEffectStyle,
  type PlanGradientStyle,
  type PlanLayers,
  type PlanVariable,
} from "@repo/figma-mapper";
import { createLayerSet } from "../layers";
import { createTokenSet, type TokenRuntime } from "../tokens";
import { fakeFigma } from "./fake-figma";

type Fake = ReturnType<typeof fakeFigma>;
type Rgba = { r: number; g: number; b: number; a: number };

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const NIGHT: Rgba = { r: 0.125, g: 0.125, b: 0.25, a: 1 };
const GRAY: Rgba = { r: 0.875, g: 0.875, b: 0.75, a: 1 };

const gray: PlanVariable = {
  key: "primitives:color/gray-200",
  name: "color/gray-200",
  collection: "primitives",
  type: "COLOR",
  values: [GRAY],
  description: "From the site: --gray-200",
  scopes: ["ALL_FILLS", "STROKE_COLOR"],
  cssVar: "--gray-200",
};
const radius: PlanVariable = {
  key: "primitives:radius/lg",
  name: "radius/lg",
  collection: "primitives",
  type: "FLOAT",
  values: [8],
  description: "From the site: --radius",
  scopes: ["CORNER_RADIUS"],
  cssVar: "--radius",
};
const card: PlanVariable = {
  key: "theme:card",
  name: "card",
  collection: "theme",
  type: "COLOR",
  values: [WHITE, NIGHT],
  description: "From the site: --card",
  scopes: ["FRAME_FILL", "SHAPE_FILL"],
  cssVar: "--card",
};
const border: PlanVariable = {
  key: "theme:border",
  name: "border",
  collection: "theme",
  type: "COLOR",
  values: [{ alias: gray.key }, { alias: gray.key }],
  description: "Inferred: the colour of most borders\nNear twin of input",
  scopes: ["STROKE_COLOR"],
};
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
  colorKeys: [card.key],
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
  stopKeys: [gray.key, null],
};

// Theme variables first: primitives are still made before them.
const layers = (over: Partial<PlanLayers> = {}): PlanLayers => ({
  hostname: "example.com",
  modes: ["Light", "Dark"],
  themeSource: "site",
  variables: [card, border, gray, radius],
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
const variableNamed = (f: Fake, name: string): any =>
  [...f.tokens.variables.values()].find((v) => v.name === name);
const near = (a: Rgba | undefined, b: Rgba) => {
  for (const c of ["r", "g", "b", "a"] as const) expect(a?.[c]).toBeCloseTo(b[c], 5);
};

describe("createLayerSet", () => {
  test("creates the Primitives and Theme collections with modes, descriptions and scopes", async () => {
    const f = fakeFigma();
    const set = await settle(f);

    const primitives = collectionNamed(f, "example.com · Primitives");
    const theme = collectionNamed(f, "example.com · Theme");
    expect(primitives?.modes.map((m: { name: string }) => m.name)).toEqual(["Value"]);
    expect(theme?.modes.map((m: { name: string }) => m.name)).toEqual(["Light", "Dark"]);
    expect(primitives?.getSharedPluginData("frottage", "collection")).toBe(
      "example.com#primitives"
    );
    expect(theme?.getSharedPluginData("frottage", "collection")).toBe("example.com#theme");

    const cardVar = variableNamed(f, "card");
    expect(cardVar.variableCollectionId).toBe(theme?.id);
    const [light, dark] = theme?.modes.map((m: { modeId: string }) => m.modeId) ?? [];
    near(cardVar.valuesByMode[light], WHITE);
    near(cardVar.valuesByMode[dark], NIGHT);
    expect(cardVar.description).toBe("From the site: --card");
    expect(cardVar.scopes).toEqual(["FRAME_FILL", "SHAPE_FILL"]);
    expect(cardVar.codeSyntax.WEB).toBe("var(--card)");
    expect(variableNamed(f, "border").description).toBe(border.description);

    const grayVar = variableNamed(f, "color/gray-200");
    expect(grayVar.variableCollectionId).toBe(primitives?.id);
    near(grayVar.valuesByMode[primitives?.defaultModeId], GRAY);
    expect(grayVar.scopes).toEqual(["ALL_FILLS", "STROKE_COLOR"]);
    expect(variableNamed(f, "radius/lg").valuesByMode[primitives?.defaultModeId]).toBe(8);

    expect(set.variable(card.key)).toBe(cardVar);
    expect(set.themeMode("Dark")).toEqual({ collection: theme, modeId: dark });
    expect(set.counts()).toEqual({
      variablesCreated: 4,
      variablesReused: 0,
      variablesRenamed: 0,
      modesDropped: [],
      stylesCreated: 2,
      stylesReused: 0,
    });
  });

  test("makes primitives before the theme variables that alias them", async () => {
    const f = fakeFigma();
    await settle(f);
    const created = [...f.tokens.variables.values()].map((v) => v.name);
    expect(created.indexOf("color/gray-200")).toBeLessThan(created.indexOf("border"));
  });

  test("an alias value points at the primitive in the other collection", async () => {
    const f = fakeFigma();
    await settle(f);
    const grayVar = variableNamed(f, "color/gray-200");
    const borderVar = variableNamed(f, "border");
    expect(borderVar.variableCollectionId).not.toBe(grayVar.variableCollectionId);
    for (const value of Object.values(borderVar.valuesByMode)) {
      expect(value).toEqual({ type: "VARIABLE_ALIAS", id: grayVar.id });
    }
  });

  test("binds effect and gradient styles to their variables", async () => {
    const f = fakeFigma();
    const set = await settle(f);
    const effect: any = [...f.tokens.effectStyles.values()][0];
    expect(effect.name).toBe("shadow/sm");
    expect(set.effectStyleId(shadow.key)).toBe(effect.id);
    expect(effect.effects[0].boundVariables.color.id).toBe(variableNamed(f, "card").id);
    expect(effect.effects[0].offset).toEqual({ x: 0, y: 1 });

    const paint: any = [...f.tokens.paintStyles.values()].find((s) => s.name === "gradient/hero");
    expect(set.gradientStyleId(gradient.key)).toBe(paint?.id);
    const [first, last] = paint?.paints[0].gradientStops ?? [];
    expect(first.boundVariables.color.id).toBe(variableNamed(f, "color/gray-200").id);
    expect(last.boundVariables).toBeUndefined();
    expect(paint?.paints[0].type).toBe("GRADIENT_LINEAR");
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
    expect(set.counts()).toEqual({
      variablesCreated: 0,
      variablesReused: 4,
      variablesRenamed: 0,
      modesDropped: [],
      stylesCreated: 0,
      stylesReused: 0,
    });
    expect(set.variable(card.key)).toBe(variableNamed(f, "card"));
    expect(set.effectStyleId(shadow.key)).toBeDefined();
    expect(set.gradientStyleId(gradient.key)).toBeDefined();
  });

  test("a changed value leaves the old variable and creates <name> (2)", async () => {
    const f = fakeFigma();
    await settle(f);
    const old = variableNamed(f, "card");
    const oldValues = structuredClone(old.valuesByMode);
    const changed = { ...card, values: [WHITE, GRAY] };
    const set = await settle(f, layers({ variables: [changed, border, gray, radius] }));
    expect(old.valuesByMode).toEqual(oldValues);
    const second = variableNamed(f, "card (2)");
    expect(set.variable(card.key)).toBe(second);
    expect(set.counts().variablesCreated).toBe(1);
    expect(set.counts().variablesRenamed).toBe(1);
    expect(set.counts().variablesReused).toBe(3);
    // A third import with the same change takes the second.
    const again = await settle(f, layers({ variables: [changed, border, gray, radius] }));
    expect(again.variable(card.key)).toBe(second);
    expect(again.counts().variablesCreated).toBe(0);
    expect(again.counts().variablesRenamed).toBe(0);
  });

  test("a user's collection of the same name is untouched", async () => {
    const f = fakeFigma();
    const users = f.tokens.seedCollection("example.com · Theme");
    const theirs = f.tokens.seedVariable("card", users, WHITE);
    const held = structuredClone(theirs.valuesByMode);
    await settle(f);
    expect(f.tokens.writes.filter((w) => w.startsWith("example.com · Theme:"))).toEqual([]);
    expect(theirs.valuesByMode).toEqual(held);
    expect(theirs.scopes).toEqual(["ALL_SCOPES"]);
    expect(theirs.getSharedPluginData("frottage", "valueKey")).toBe("");
    expect(users.modes.length).toBe(1);
    expect(users.name).toBe("example.com · Theme");
    expect(theirs.description).toBe("");
    const own = collectionNamed(f, "example.com · Theme (Frottage)");
    expect(own?.modes.length).toBe(2);
    // Found again by its tag, not by the user's name.
    const set = await settle(f);
    expect(set.themeMode("Light")?.collection).toBe(own);
    expect(set.counts().variablesCreated).toBe(0);
  });

  test("modes past the file's limit are dropped and their values not written", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const set = await settle(f);
    expect(set.counts().modesDropped).toEqual(["Dark"]);
    const theme = collectionNamed(f, "example.com · Theme");
    expect(theme?.modes.map((m: { name: string }) => m.name)).toEqual(["Light"]);
    const cardVar = variableNamed(f, "card");
    expect(Object.keys(cardVar.valuesByMode)).toEqual([theme?.defaultModeId]);
    near(cardVar.valuesByMode[theme?.defaultModeId], WHITE);
    expect(set.themeMode("Dark")).toBeNull();
    expect(set.variable(card.key)).toBe(cardVar);
  });

  test("with local styles, a primitive equal to a user's variable binds to it", async () => {
    const f = fakeFigma();
    const brand = f.tokens.seedCollection("Brand");
    const theirs = f.tokens.seedVariable("neutral/200", brand, GRAY);
    const set = await settle(f, layers({ variables: [gray, border] }));
    expect(set.variable(gray.key)?.id).toBe(theirs.id);
    expect(collectionNamed(f, "example.com · Primitives")).toBeUndefined();
    const borderVar = variableNamed(f, "border");
    expect(Object.values(borderVar.valuesByMode)[0]).toEqual({
      type: "VARIABLE_ALIAS",
      id: theirs.id,
    });
    expect(f.tokens.writes.filter((w) => w.startsWith("neutral/200"))).toEqual([]);
    expect(set.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 1 });

    const g = fakeFigma();
    const users = g.tokens.seedCollection("Brand");
    g.tokens.seedVariable("neutral/200", users, GRAY);
    const off = await settle(g, layers({ variables: [gray] }), options({ useLocalStyles: false }));
    expect(off.variable(gray.key)?.name).toBe("color/gray-200");
  });

  test("discard after a partial import removes what it made", async () => {
    const f = fakeFigma();
    const set = createLayerSet(f.figma);
    let breaths = 0;
    const runtime = runtimeFor({
      overBudget: () => true,
      breathe: async () => {
        // Partway through the theme variables.
        if (++breaths === 4) await set.discard();
      },
    });
    await set.resolve(layers(), options(), runtime);
    expect(f.tokens.variables.size).toBe(0);
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.effectStyles.size).toBe(0);
    expect(f.tokens.paintStyles.size).toBe(0);
    // Partway: some made, not all.
    expect(f.tokens.count("createVariable")).toBeGreaterThan(0);
    expect(f.tokens.count("createVariable")).toBeLessThan(4);
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
    const cardVar = variableNamed(f, "card");
    expect(tokens.color(card.key)).toEqual({ variable: cardVar });
    expect(tokens.radius(radius.key)).toBe(variableNamed(f, "radius/lg"));
    expect(tokens.spacing(radius.key)).toBe(variableNamed(f, "radius/lg"));
    expect(tokens.effectStyleId(shadow.key)).toBe([...f.tokens.effectStyles.keys()][0]);
    expect(tokens.gradientStyleId(gradient.key)).toBeDefined();
    expect(tokens.counts()).toMatchObject({
      variablesCreated: 4,
      stylesCreated: 2,
      stylesReused: 0,
      layers: {
        variablesCreated: 4,
        variablesReused: 0,
        variablesRenamed: 0,
        modesDropped: [],
        stylesCreated: 2,
        stylesReused: 0,
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
    expect(tokens.radius("primitives:radius/lg")).toBeUndefined();
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
      key: `primitives:color/c${i}`,
      name: `color/c${i}`,
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
