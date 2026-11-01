import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  type FontRef,
  type ImportOptions,
  type ModeValue,
  type PlanModeColor,
  type PlanModeType,
  type PlanOp,
  type PlanVersionTokens,
} from "@repo/figma-mapper";
import { createApplier } from "../applier";
import { createTokenSet, type TokenRuntime } from "../tokens";
import { fakeFigma } from "./fake-figma";

type Fake = ReturnType<typeof fakeFigma>;
type Rgba = { r: number; g: number; b: number; a: number };

const inter: FontRef = { family: "Inter", style: "Regular" };
const meta = { name: "Import", fonts: [inter], totalOps: 2 };
const INK: Rgba = { r: 0.25, g: 0.25, b: 0.25, a: 1 };
const PAPER: Rgba = { r: 0.75, g: 0.75, b: 0.75, a: 1 };
const SKY: Rgba = { r: 0.25, g: 0.5, b: 0.75, a: 1 };

const hex = (c: Rgba) => `${c.r}.${c.g}.${c.b}`;
const perMode = <T>(list: T[]): ModeValue<T>[] => list.map((value, mode) => ({ mode, value }));

/** As `mergeVersions` makes it: the key is the name and the values by mode. */
function color(name: string, list: Rgba[], over: Partial<PlanModeColor> = {}): PlanModeColor {
  return {
    key: [name, ...list.map(hex)].join("|"),
    name,
    values: perMode(list),
    from: list.map(hex),
    ...over,
  };
}
function role(
  name: string,
  sizes: number[],
  lines: (number | null)[],
  over: Partial<PlanModeType> = {}
): PlanModeType {
  return {
    key: [name, ...sizes.map((s, i) => `${s}/${lines[i]}`)].join("|"),
    name,
    fontName: inter,
    letterSpacing: 0,
    decoration: "NONE",
    textCase: "ORIGINAL",
    fontSize: perMode(sizes),
    lineHeight: perMode(lines),
    from: sizes.map((s, i) => `${name}:${s}/${lines[i]}`),
    ...over,
  };
}
const set = (over: Partial<PlanVersionTokens> = {}): PlanVersionTokens => ({
  collection: "example.com",
  modes: ["Light", "Dark"],
  colors: [color("color/primary", [INK, PAPER])],
  textStyles: [],
  ...over,
});
const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...over,
});

const runtimeFor = (f: Fake, over: Partial<TokenRuntime> = {}): TokenRuntime => ({
  overBudget: () => false,
  breathe: async () => true,
  ensureFont: async (font) => {
    await f.figma.loadFontAsync(font);
    return true;
  },
  ...over,
});

/** Settles a set on its own, so a test can ask for its modes. */
async function settle(
  f: Fake,
  plan: PlanVersionTokens = set(),
  opts: ImportOptions = options(),
  runtime: TokenRuntime = runtimeFor(f)
) {
  const tokens = createTokenSet(f.figma);
  await tokens.resolveModes(plan, opts, runtime);
  return tokens;
}

const collectionsIn = (f: Fake) => [...f.tokens.collections.values()] as any[];
const variablesIn = (f: Fake) => [...f.tokens.variables.values()] as any[];
const stylesIn = (f: Fake) => [...f.tokens.textStyles.values()] as any[];
const variableNamed = (f: Fake, name: string) => variablesIn(f).find((v) => v.name === name);
const modeNames = (c: any) => c.modes.map((m: any) => m.name);
const modeId = (c: any, name: string) => c.modes.find((m: any) => m.name === name).modeId;
/** The channel where the three test colours all differ. */
const channel = (v: { g: number }) => v.g;
/** Tags a variable as Frottage's, as Stages 1 and 2 left it. */
const tagged = (variable: any, key: string) => {
  variable.setSharedPluginData("frottage", "valueKey", key);
  return variable;
};

describe("modes", () => {
  test("a new collection names its default mode after the first version", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    expect(collection.modes[0].modeId).toBe(collection.defaultModeId);
    expect(collection.modes[0].name).toBe("Light");
  });

  test("each later version adds a mode", async () => {
    const f = fakeFigma();
    const tokens = await settle(f, set({ modes: ["Light", "Dark", "Dim"] }));
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["Light", "Dark", "Dim"]);
    expect(tokens.modeOf(0)).toEqual({ collection, modeId: modeId(collection, "Light") });
    expect(tokens.modeOf(2)).toEqual({ collection, modeId: modeId(collection, "Dim") });
    expect(tokens.modeOf(3)).toBeNull();
    expect(tokens.counts().modes).toBe(3);
    expect(tokens.counts().modesDropped).toBe(0);
  });

  test("a new collection is tagged, so that it stays Frottage's", async () => {
    const f = fakeFigma();
    await settle(f);
    expect(collectionsIn(f)[0].getSharedPluginData("frottage", "collection")).not.toBe("");
  });

  test("each value is set per mode, and a missing one reads the first", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER, SKY], {
      values: [
        { mode: 0, value: INK },
        { mode: 2, value: SKY },
      ],
    });
    await settle(f, set({ modes: ["A", "B", "C"], colors: [token] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "A")))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "B")))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "C")))).toBe(SKY.g);
    expect(variable.getSharedPluginData("frottage", "valueKey")).toBe(token.key);
  });

  test("a paint keyed by a merged token binds to its variable", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER]);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(set({ colors: [token] }), options());
    const op: PlanOp = {
      op: "frame",
      id: "a",
      parent: null,
      name: "a",
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      fills: [{ type: "SOLID", color: INK, opacity: 1, colorKey: token.key }],
      strokes: null,
      radius: [0, 0, 0, 0],
      opacity: 1,
      effects: [],
      clips: true,
      layout: { mode: "NONE" },
      childCount: 0,
    };
    await a.applyBatch([op]);
    const end = await a.end();
    expect(f.frame("Import").fills[0].boundVariables.color.id).toBe(variablesIn(f)[0].id);
    expect(end.modes).toBe(2);
    expect(end.modesDropped).toBe(0);
    expect(end.variablesCreated).toBe(1);
  });

  test("a single-file import reports no modes", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importTokens({ textStyles: [], colors: [], collection: "example.com" }, options());
    const end = await a.end();
    expect(end.modes).toBe(0);
    expect(end.modesDropped).toBe(0);
  });

  test("tokens off makes no modes", async () => {
    const f = fakeFigma();
    await settle(f, set(), options({ tokens: false }));
    expect(f.tokens.collections.size).toBe(0);
  });

  test("an existing mode with the same label is reused", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["Light", "Dark"] }));
    f.tokens.writes.length = 0;
    const tokens = await settle(
      f,
      set({ modes: ["Dark", "Dim"], colors: [color("color/other", [SKY, PAPER])] })
    );
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["Light", "Dark", "Dim"]);
    expect(f.tokens.count("renameMode")).toBe(1);
    expect(tokens.modeOf(0)?.modeId).toBe(modeId(collection, "Dark"));
    const variable = variableNamed(f, "color/other");
    // The first version's mode isn't the default, which still needs its value.
    expect(channel(f.tokens.valueIn(variable, collection.defaultModeId))).toBe(SKY.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Dark")))).toBe(SKY.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Dim")))).toBe(PAPER.g);
  });
});

describe("text styles", () => {
  test("size and line height bind to float variables on the style", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    const [collection] = collectionsIn(f);
    const [style] = stylesIn(f);
    const size = variableNamed(f, "type/body/1/size");
    const line = variableNamed(f, "type/body/1/line-height");
    expect(size.resolvedType).toBe("FLOAT");
    expect(line.variableCollectionId).toBe(collection.id);
    expect(style.boundVariables.fontSize.id).toBe(size.id);
    expect(style.boundVariables.lineHeight.id).toBe(line.id);
    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
    expect(f.tokens.valueIn(size, modeId(collection, "Dark"))).toBe(14);
    expect(f.tokens.valueIn(line, modeId(collection, "Dark"))).toBe(20);
    expect(tokens.textStyleId(body.key)).toBe(style.id);
    expect(tokens.counts()).toMatchObject({ stylesCreated: 1, variablesCreated: 2 });
  });

  test("only what varies gets a variable", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 24])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["type/body/1/size"]);
    expect(stylesIn(f)[0].boundVariables.lineHeight).toBeUndefined();
  });

  test("a version with no line height leaves the variable at the first mode's", async () => {
    const f = fakeFigma();
    await settle(
      f,
      set({
        modes: ["A", "B", "C"],
        colors: [],
        textStyles: [role("body/1", [16, 16, 16], [24, null, 20])],
      })
    );
    const [collection] = collectionsIn(f);
    const line = variableNamed(f, "type/body/1/line-height");
    expect(f.tokens.valueIn(line, modeId(collection, "B"))).toBe(24);
    expect(f.tokens.valueIn(line, modeId(collection, "C"))).toBe(20);
  });

  test("a first version with no line height stays AUTO, with no variable", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [null, 20])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["type/body/1/size"]);
    expect(stylesIn(f)[0].lineHeight).toEqual({ unit: "AUTO" });
  });

  test("a role with one value everywhere has no variables and reuses a user's style", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Body", {
      fontName: inter,
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
      letterSpacing: { unit: "PIXELS", value: 0 },
    });
    const body = role("body/1", [16, 16], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).toBe(mine.id);
    expect(f.tokens.variables.size).toBe(0);
    expect(tokens.counts().stylesReused).toBe(1);
  });

  test("a varying role never binds a user's style that matches its first value", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedTextStyle("Body", {
      fontName: inter,
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
      letterSpacing: { unit: "PIXELS", value: 0 },
    });
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).not.toBe(mine.id);
    expect(mine.boundVariables).toBeUndefined();
    expect(f.tokens.writes.filter((w) => w.startsWith("Body:"))).toEqual([]);
  });

  test("a style of Frottage's that varies isn't taken for a role with one value", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 20])] }));
    const flat = role("note/1", [16, 16], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [flat] }));
    expect(tokens.counts().stylesCreated).toBe(1);
    expect(stylesIn(f)).toHaveLength(2);
  });

  test("a refused binding counts and keeps the style at its first values", async () => {
    const f = fakeFigma({ failTokens: ["textStyle.setBoundVariable"] });
    const body = role("body/1", [16, 14], [24, 24]);
    const tokens = await settle(f, set({ colors: [], textStyles: [body] }));
    expect(tokens.textStyleId(body.key)).toBeDefined();
    expect(tokens.counts().tokenFailures).toBe(1);
    expect(f.tokens.variables.size).toBe(0);
  });

  test("a font that won't load counts and leaves the role plain", async () => {
    const f = fakeFigma();
    const body = role("body/1", [16, 14], [24, 20]);
    const tokens = await settle(
      f,
      set({ colors: [], textStyles: [body] }),
      options(),
      runtimeFor(f, { ensureFont: async () => false })
    );
    expect(tokens.textStyleId(body.key)).toBeUndefined();
    expect(tokens.counts().tokenFailures).toBe(1);
  });
});

describe("mode limits", () => {
  const three = (over: Partial<PlanVersionTokens> = {}) =>
    set({
      modes: ["A", "B", "C"],
      colors: [color("color/primary", [INK, PAPER, SKY])],
      ...over,
    });

  test("Limited to N modes keeps every frame, uses the first values and reports it", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    const tokens = await settle(f, three());
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(modeNames(collection)).toEqual(["A", "B"]);
    expect(tokens.modeOf(1)).not.toBeNull();
    expect(tokens.modeOf(2)).toBeNull();
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "B")))).toBe(PAPER.g);
    expect(tokens.counts()).toMatchObject({ modes: 2, modesDropped: 1, tokenFailures: 0 });
    expect(tokens.color(color("color/primary", [INK, PAPER, SKY]).key)).toBeDefined();
  });

  test("Starter's limit of one mode behaves the same", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(modeNames(collection)).toEqual(["Light"]);
    expect(channel(variable.valuesByMode[collection.defaultModeId])).toBe(INK.g);
    expect(tokens.modeOf(0)).not.toBeNull();
    expect(tokens.modeOf(1)).toBeNull();
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 1, tokenFailures: 0 });
  });

  test("with one mode left, a varying token reuses a user's variable like any other", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect((tokens.color(token.key) as any).variable).toBe(mine);
    // Nothing needed the collection, so it goes, and no version has a mode.
    expect(collectionsIn(f)).toEqual([library]);
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 2 });
  });

  test("with one mode left, a varying role keeps its first values and no variables", async () => {
    const f = fakeFigma({ modeLimit: 1 });
    await settle(f, set({ colors: [], textStyles: [role("body/1", [16, 14], [24, 20])] }));
    expect(f.tokens.variables.size).toBe(0);
    expect(stylesIn(f)[0].fontSize).toBe(16);
  });

  test("any other addMode failure counts and stops the rest", async () => {
    const f = fakeFigma({ failTokens: ["addMode"] });
    const tokens = await settle(f, three());
    expect(f.tokens.count("addMode")).toBe(1);
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 2, tokenFailures: 1 });
  });

  test("a collection that can't be made counts and reports every version", async () => {
    const f = fakeFigma({ failTokens: ["createVariableCollection"] });
    const tokens = await settle(f, set());
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 2, tokenFailures: 1 });
  });

  test("a full collection still reuses the labels it has", async () => {
    const f = fakeFigma({ modeLimit: 2 });
    await settle(f, set({ modes: ["A", "B"] }));
    const tokens = await settle(
      f,
      set({ modes: ["C", "B"], colors: [color("color/other", [SKY, PAPER])] })
    );
    const [collection] = collectionsIn(f);
    expect(modeNames(collection)).toEqual(["A", "B"]);
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.modeOf(1)?.modeId).toBe(modeId(collection, "B"));
    expect(tokens.counts()).toMatchObject({ modes: 1, modesDropped: 1 });
    // A single mode left: the first version's value goes in, as Stage 1 would.
    const variable = variableNamed(f, "color/other");
    expect(channel(variable.valuesByMode[collection.defaultModeId])).toBe(SKY.g);
  });

  test("a new variable's default mode takes the first value, unless a version holds it", async () => {
    const f = fakeFigma({ modeLimit: 3 });
    await settle(f, set({ modes: ["A", "B"] }));
    await settle(f, set({ modes: ["Y", "B", "Z"], colors: [color("color/y", [SKY, PAPER, INK])] }));
    const [collection] = collectionsIn(f);
    const y = variableNamed(f, "color/y");
    expect(channel(y.valuesByMode[collection.defaultModeId])).toBe(SKY.g);

    await settle(f, set({ modes: ["W", "A", "B"], colors: [color("color/w", [SKY, INK, PAPER])] }));
    const w = variableNamed(f, "color/w");
    expect(modeNames(collection)).toEqual(["A", "B", "Y"]);
    expect(channel(w.valuesByMode[collection.defaultModeId])).toBe(INK.g);
    expect(channel(f.tokens.valueIn(w, modeId(collection, "B")))).toBe(PAPER.g);
  });
});

describe("whose collection", () => {
  test("a user's collection of the same name is left alone", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    const theirs = f.tokens.seedVariable("ink", mine, SKY);
    const tokens = await settle(f);
    const made = collectionsIn(f).find((c) => c !== mine);
    expect(made.name).toBe("example.com (Frottage)");
    expect(modeNames(mine)).toEqual(["Value"]);
    expect(theirs.variableCollectionId).toBe(mine.id);
    expect(tokens.modeOf(1)?.collection.id).toBe(made.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("example.com:"))).toEqual([]);
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
  });

  test("a repeat import finds the collection named for Frottage first", async () => {
    const f = fakeFigma();
    f.tokens.seedCollection("example.com", ["Value"]);
    await settle(f);
    await settle(f, set({ colors: [color("color/other", [SKY, PAPER])] }));
    expect(collectionsIn(f)).toHaveLength(2);
    const made = collectionsIn(f).find((c) => c.name === "example.com (Frottage)");
    expect(variableNamed(f, "color/other").variableCollectionId).toBe(made.id);
  });

  test("the collection named for Frottage wins over an older one of the plain name", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    tagged(f.tokens.seedVariable("color/old", older, SKY), "old");
    const newer = f.tokens.seedCollection("example.com (Frottage)");
    tagged(f.tokens.seedVariable("color/new", newer, SKY), "new");
    const tokens = await settle(f);
    expect(tokens.modeOf(0)?.collection.id).toBe(newer.id);
    expect(modeNames(older)).toEqual(["Mode 1"]);
  });

  test("a single file's collection is tagged as well", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    const ink = { key: "#404040", name: "color/ink", rgba: INK };
    await a.importTokens({ textStyles: [], colors: [ink], collection: "example.com" }, options());
    await a.end();
    expect(collectionsIn(f)[0].getSharedPluginData("frottage", "collection")).not.toBe("");
  });

  test("an empty collection of the same name isn't Frottage's", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    await settle(f);
    expect(mine.variableIds).toEqual([]);
    expect(modeNames(mine)).toEqual(["Value"]);
  });

  test("a collection with one variable of the user's isn't Frottage's", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedCollection("example.com", ["Value"]);
    tagged(f.tokens.seedVariable("old", mine, SKY), "#404080");
    f.tokens.seedVariable("gap", mine, 8, "FLOAT");
    await settle(f);
    expect(modeNames(mine)).toEqual(["Value"]);
    expect(collectionsIn(f)).toHaveLength(2);
  });

  test("an older Frottage collection is recognised by its tagged variables", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    tagged(f.tokens.seedVariable("color/old", older, SKY), "#4080bf");
    const tokens = await settle(f);
    expect(collectionsIn(f)).toEqual([older]);
    // Its default mode exists, so it keeps its name.
    expect(modeNames(older)).toEqual(["Mode 1", "Light", "Dark"]);
    expect(older.getSharedPluginData("frottage", "collection")).not.toBe("");
    expect(tokens.modeOf(0)?.modeId).toBe(modeId(older, "Light"));
    const variable = variableNamed(f, "color/primary");
    expect(channel(f.tokens.valueIn(variable, older.defaultModeId))).toBe(INK.g);
    expect(channel(f.tokens.valueIn(variable, modeId(older, "Dark")))).toBe(PAPER.g);
  });

  test("a tagged collection stays Frottage's after the user adds a variable", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const theirs = f.tokens.seedVariable("mine", collection, SKY);
    await settle(f, set({ colors: [color("color/other", [SKY, PAPER])] }));
    expect(collectionsIn(f)).toEqual([collection]);
    expect(Object.keys(theirs.valuesByMode)).toEqual([collection.defaultModeId]);
  });
});

describe("whose variable", () => {
  test("a user's variable is never given a mode value", async () => {
    const f = fakeFigma();
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, PAPER]);
    const tokens = await settle(f, set({ colors: [token] }));
    const binding = tokens.color(token.key) as { variable: { id: string } };
    expect(binding.variable.id).not.toBe(mine.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
    expect(f.tokens.writes.filter((w) => w.startsWith("Brand:"))).toEqual([]);
  });

  test("a single-value token still reuses a user's variable", async () => {
    const f = fakeFigma();
    const library = f.tokens.seedCollection("Brand");
    const mine = f.tokens.seedVariable("ink", library, INK);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect((tokens.color(token.key) as any).variable).toBe(mine);
    expect(tokens.counts()).toMatchObject({ variablesReused: 1, variablesCreated: 0 });
    expect(f.tokens.writes.filter((w) => w.startsWith("ink:"))).toEqual([]);
    expect(f.tokens.collections.size).toBe(1);
    expect(tokens.modeOf(0)).toBeNull();
    expect(tokens.counts()).toMatchObject({ modes: 0, modesDropped: 0 });
  });

  test("a single-value token still reuses a user's paint style", async () => {
    const f = fakeFigma();
    const mine = f.tokens.seedPaintStyle("Ink", [
      { type: "SOLID", color: { r: INK.r, g: INK.g, b: INK.b } },
    ]);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect(tokens.color(token.key)).toEqual({ paintStyleId: mine.id });
  });

  test("a single-value token with local reuse off makes a variable", async () => {
    const f = fakeFigma();
    f.tokens.seedVariable("ink", f.tokens.seedCollection("Brand"), INK);
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }), options({ useLocalStyles: false }));
    expect(tokens.counts().variablesCreated).toBe(1);
    expect(modeNames(tokens.modeOf(1)?.collection)).toEqual(["Light", "Dark"]);
  });

  test("a single-value token reuses a single file's variable by its value's key", async () => {
    const f = fakeFigma();
    const older = f.tokens.seedCollection("example.com");
    const made = tagged(f.tokens.seedVariable("color/primary", older, INK), hex(INK));
    const token = color("color/primary", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }), options({ useLocalStyles: false }));
    expect(tokens.color(token.key)).toEqual({ variable: made });
  });

  test("a varying variable of Frottage's isn't taken for a single value", async () => {
    const f = fakeFigma();
    await settle(f);
    const token = color("color/flat", [INK, INK]);
    const tokens = await settle(f, set({ colors: [token] }));
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
  });

  test("a varying variable in another collection is left where it is", async () => {
    const f = fakeFigma();
    const token = color("color/primary", [INK, PAPER]);
    const elsewhere = f.tokens.seedCollection("Moved", ["Light", "Dark"]);
    const moved = tagged(f.tokens.seedVariable("moved", elsewhere, INK), token.key);
    f.tokens.writes.length = 0;
    const tokens = await settle(f, set({ colors: [token] }));
    const binding = tokens.color(token.key) as { variable: { id: string } };
    expect(binding.variable.id).not.toBe(moved.id);
    expect(f.tokens.writes.filter((w) => w.startsWith("moved:"))).toEqual([]);
  });

  test("a changed value makes a new variable beside the old one", async () => {
    const f = fakeFigma();
    await settle(f);
    await settle(f, set({ colors: [color("color/primary", [INK, SKY])] }));
    expect(variablesIn(f).map((v) => v.name)).toEqual(["color/primary", "color/primary-2"]);
  });

  test("a variable the user changed isn't reused, and stays as it is", async () => {
    const f = fakeFigma();
    await settle(f);
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    variable.setValueForMode(modeId(collection, "Dark"), SKY);
    f.tokens.writes.length = 0;
    const tokens = await settle(f);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 1, variablesReused: 0 });
    expect(channel(variable.valuesByMode[modeId(collection, "Dark")])).toBe(SKY.g);
  });
});

describe("repeat imports", () => {
  const full = () =>
    set({
      colors: [color("color/primary", [INK, PAPER], { cssVar: "--ink" })],
      textStyles: [role("body/1", [16, 14], [24, 20])],
    });

  test("a repeat import of the same set creates nothing", async () => {
    const f = fakeFigma();
    await settle(f, full());
    f.tokens.writes.length = 0;
    const tokens = await settle(f, full());
    expect(f.tokens.writes).toEqual([]);
    expect(tokens.counts()).toMatchObject({
      stylesCreated: 0,
      stylesReused: 1,
      variablesCreated: 0,
      variablesReused: 3,
      modes: 2,
      modesDropped: 0,
      tokenFailures: 0,
    });
    expect(tokens.modeOf(1)).not.toBeNull();
  });

  test("a repeat import of values that don't vary finds its modes", async () => {
    const f = fakeFigma();
    const flat = () => set({ colors: [color("color/primary", [INK, INK])] });
    await settle(f, flat());
    f.tokens.writes.length = 0;
    const tokens = await settle(f, flat());
    expect(f.tokens.writes).toEqual([]);
    expect(tokens.modeOf(1)).not.toBeNull();
  });

  test("the same values under new labels fill the modes they add", async () => {
    const f = fakeFigma();
    await settle(f);
    const tokens = await settle(f, set({ modes: ["Day", "Night"] }));
    const [collection] = collectionsIn(f);
    const [variable] = variablesIn(f);
    expect(tokens.counts()).toMatchObject({ variablesCreated: 0, variablesReused: 1 });
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Night")))).toBe(PAPER.g);
    expect(channel(f.tokens.valueIn(variable, modeId(collection, "Day")))).toBe(INK.g);
  });

  test("a reused role fills the modes it adds, and gains no new binding", async () => {
    const f = fakeFigma();
    await settle(f, full());
    const [collection] = collectionsIn(f);
    await settle(f, { ...full(), modes: ["Day", "Night"] });
    const size = variableNamed(f, "type/body/1/size");
    expect(f.tokens.valueIn(size, modeId(collection, "Night"))).toBe(14);
    expect(f.tokens.count("textStyle.setBoundVariable")).toBe(2);
  });

  test("a style made while modes were out of reach isn't taken for a varying role", async () => {
    const limits = { modeLimit: 1 };
    const f = fakeFigma(limits);
    const roles = [role("body/1", [16, 14], [24, 24]), role("note/1", [12, 12], [18, 16])];
    await settle(f, set({ colors: [], textStyles: roles }));
    const flat = stylesIn(f);
    limits.modeLimit = 10;
    await settle(f, set({ colors: [], textStyles: roles }));
    expect(stylesIn(f)).toHaveLength(4);
    expect(flat.map((s) => s.boundVariables)).toEqual([undefined, undefined]);
  });
});

describe("taking it back", () => {
  test("cancel removes created modes and variables", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["Mode 0"] }));
    const [collection] = collectionsIn(f);
    const before = variablesIn(f);
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(
      set({
        modes: ["Mode 0", "Dark"],
        colors: [color("color/other", [SKY, PAPER])],
        textStyles: [role("body/1", [16, 14], [24, 20])],
      }),
      options()
    );
    expect(modeNames(collection)).toEqual(["Mode 0", "Dark"]);
    await a.cancel();
    expect(modeNames(collection)).toEqual(["Mode 0"]);
    expect(variablesIn(f)).toEqual(before);
    expect(stylesIn(f)).toEqual([]);
    expect(collectionsIn(f)).toEqual([collection]);
  });

  test("cancel removes a collection it made whole", async () => {
    const f = fakeFigma();
    const a = createApplier(f.figma);
    await a.begin(meta);
    await a.importModes(set(), options());
    await a.cancel();
    expect(f.tokens.collections.size).toBe(0);
    expect(f.tokens.count("removeMode")).toBe(0);
  });

  test("cancel leaves modes a variable still in use needs", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["One"] }));
    const [collection] = collectionsIn(f);
    const token = color("color/other", [SKY, PAPER]);
    const tokens = createTokenSet(f.figma);
    await tokens.resolveModes(
      set({ modes: ["One", "Two"], colors: [token] }),
      options(),
      runtimeFor(f)
    );
    const { variable } = tokens.color(token.key) as { variable: any };
    const elsewhere = f.tokens.seedVariable("alias", collection, {
      type: "VARIABLE_ALIAS",
      id: variable.id,
    });
    await tokens.discard();
    expect(elsewhere.valuesByMode[collection.defaultModeId].id).toBe(variable.id);
    expect(variablesIn(f)).toContain(variable);
    expect(modeNames(collection)).toEqual(["One", "Two"]);
  });

  test("cancel keeps a float variable that a kept style is bound to", async () => {
    const f = fakeFigma();
    await settle(f, set({ colors: [color("color/a", [INK, PAPER])] }));
    const body = role("body/1", [16, 14], [24, 24]);
    const tokens = createTokenSet(f.figma);
    await tokens.resolveModes(set({ colors: [], textStyles: [body] }), options(), runtimeFor(f));
    const style = f.tokens.textStyleById(tokens.textStyleId(body.key) as string) as any;
    style.getStyleConsumersAsync = async () => [{ node: {}, fields: ["textStyleId"] }];
    await tokens.discard();
    expect(variableNamed(f, "type/body/1/size")).toBeDefined();
  });

  test("a cancel during mode writes leaves nothing behind", async () => {
    const f = fakeFigma();
    await settle(f, set({ modes: ["One"], colors: [color("color/a", [INK])] }));
    const [collection] = collectionsIn(f);
    const before = variablesIn(f);
    const tokens = createTokenSet(f.figma);
    let breaths = 0;
    let discarding: Promise<void> | undefined;
    await tokens.resolveModes(
      set({ modes: ["One", "Two", "Three"], colors: [color("color/b", [SKY, PAPER, INK])] }),
      options(),
      runtimeFor(f, {
        overBudget: () => true,
        breathe: async () => {
          // After the modes, while the new variable's values go in.
          if (++breaths === 3) discarding = tokens.discard();
          await new Promise((resolve) => setTimeout(resolve, 0));
          return true;
        },
      })
    );
    await discarding;
    expect(variablesIn(f)).toEqual(before);
    expect(modeNames(collection)).toEqual(["One"]);
  });
});

describe("the time budget", () => {
  test("mode writes yield to Figma", async () => {
    const f = fakeFigma();
    let breaths = 0;
    await settle(
      f,
      set({ modes: ["A", "B", "C", "D"], colors: [color("color/a", [INK, PAPER, SKY, INK])] }),
      options(),
      runtimeFor(f, {
        overBudget: () => true,
        breathe: async () => {
          breaths++;
          return true;
        },
      })
    );
    // One for each mode added, one for the token, and one for each value past the default.
    expect(breaths).toBeGreaterThanOrEqual(3 + 1 + 2);
  });
});
