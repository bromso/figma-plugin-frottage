import type { FakeNode } from "./fake-figma";

/**
 * Text styles, paint styles, variables and collections for the fake Figma, throwing where the real
 * API does. Numbers come back as Figma stores them, in 32 bits. Getters and style links really
 * suspend, so tests can reach what happens while they are pending.
 */

export type TokenOptions = {
  /** Names of token API calls that throw. */
  failTokens?: string[];
  /** A name that createVariable refuses. */
  failVariableName?: string;
  /** A text style field that refuses its variable, as `setBoundVariable` can. */
  failStyleBinding?: string;
  /** A corner radius field that refuses its variable. */
  failRadiusBinding?: string;
  /** Modes a collection can hold: 10 on this owner's plan, 1 on Starter. */
  modeLimit?: number;
};

type Font = { family: string; style: string };
type Rgba = { r: number; g: number; b: number; a?: number };
type Fake = Record<string, any>;

const BINDABLE_LENGTHS = [
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gridRowGap",
  "gridColumnGap",
];
const CORNERS = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"];
/** Text style fields Figma binds, with the variable type each takes. */
const STYLE_FIELDS: Record<string, string> = {
  fontSize: "FLOAT",
  lineHeight: "FLOAT",
  letterSpacing: "FLOAT",
  fontWeight: "FLOAT",
  fontFamily: "STRING",
};

const fontId = (f: Font) => `${f.family}|${f.style}`;
const hop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stored = (c: Rgba) => ({
  r: Math.fround(c.r),
  g: Math.fround(c.g),
  b: Math.fround(c.b),
  a: Math.fround(c.a ?? 1),
});

/** What Figma keeps of a line height or letter spacing. */
function storedUnit<T extends { value?: number }>(v: T): T {
  return v.value === undefined ? v : { ...v, value: Math.fround(v.value) };
}

export function tokenModel(
  opts: TokenOptions,
  loaded: Set<string>,
  findAll: (test: (n: FakeNode) => boolean) => FakeNode[]
) {
  const textStyles = new Map<string, Fake>();
  const paintStyles = new Map<string, Fake>();
  const effectStyles = new Map<string, Fake>();
  const variables = new Map<string, Fake>();
  const collections = new Map<string, Fake>();
  /** Every write to a token, so a test can show that a user's were left alone. */
  const writes: string[] = [];
  /** Token API calls in order. */
  const log: string[] = [];
  let seq = 0;

  const called = (name: string) => {
    log.push(name);
    if (opts.failTokens?.includes(name)) throw new Error(`${name} failed`);
  };

  const pluginData = (target: Fake, label: () => string) => {
    const data = new Map<string, string>();
    target.getSharedPluginData = (ns: string, key: string) => data.get(`${ns}/${key}`) ?? "";
    target.setSharedPluginData = (ns: string, key: string, value: string) => {
      called("setSharedPluginData");
      writes.push(`${label()}: plugin data`);
      data.set(`${ns}/${key}`, value);
    };
  };

  function makeTextStyle(): Fake {
    const id = `S:text${++seq}`;
    const state: Fake = {
      fontName: { family: "Roboto", style: "Regular" },
      fontSize: 12,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PERCENT", value: 0 },
      textDecoration: "NONE",
      textCase: "ORIGINAL",
      paragraphSpacing: 0,
      paragraphIndent: 0,
      leadingTrim: "NONE",
      listSpacing: 0,
      hangingPunctuation: false,
      hangingList: false,
      name: "",
    };
    const style: Fake = {
      id,
      type: "TEXT",
      removed: false,
      remove() {
        called("textStyle.remove");
        style.removed = true;
        textStyles.delete(id);
      },
      async getStyleConsumersAsync() {
        called("getStyleConsumersAsync");
        await hop();
        return findAll((n) => (n.textStyleIds ?? new Set()).has(id)).map((node) => ({
          node,
          fields: ["textStyleId"],
        }));
      },
    };
    pluginData(style, () => state.name);
    for (const field of Object.keys(state)) {
      Object.defineProperty(style, field, {
        get: () => state[field],
        set: (v: any) => {
          writes.push(`${state.name}: ${field}`);
          // Figma refuses every type field while the style's font isn't loaded.
          const font = field === "fontName" ? v : state.fontName;
          if (field !== "name" && !loaded.has(fontId(font))) {
            throw new Error(`font not loaded: ${fontId(font)}`);
          }
          if (field === "fontSize") state[field] = Math.fround(v);
          else if (field === "lineHeight" || field === "letterSpacing")
            state[field] = storedUnit(v);
          else state[field] = v;
        },
      });
    }
    style.setBoundVariable = (field: string, variable: Fake) => {
      called("textStyle.setBoundVariable");
      if (opts.failStyleBinding === field) throw new Error(`${field} refused`);
      writes.push(`${state.name}: bound ${field}`);
      if (variable === null) {
        const { [field]: _, ...rest } = style.boundVariables ?? {};
        style.boundVariables = rest;
        return;
      }
      if (typeof variable === "string") throw new Error("dynamic-page needs the variable");
      const type = STYLE_FIELDS[field];
      if (!type) throw new Error(`can't bind ${field}`);
      if (!variables.has(variable?.id)) throw new Error("unknown variable");
      if (variable.resolvedType !== type) throw new Error(`needs a ${type} variable`);
      if (!loaded.has(fontId(state.fontName))) throw new Error("font not loaded");
      style.boundVariables = {
        ...style.boundVariables,
        [field]: { type: "VARIABLE_ALIAS", id: variable.id },
      };
    };
    textStyles.set(id, style);
    return style;
  }

  /** Nodes that link a style through one of these fields. */
  const consumersOf = (id: string, fields: string[]) => async () => {
    called("getStyleConsumersAsync");
    await hop();
    return findAll((n) => fields.some((f) => n[f] === id)).map((node) => ({
      node,
      fields: fields.filter((f) => node[f] === id),
    }));
  };

  function makePaintStyle(name: string, paints: any[]): Fake {
    const id = `S:paint${++seq}`;
    const style: Fake = {
      id,
      type: "PAINT",
      description: "",
      removed: false,
      remove() {
        called("paintStyle.remove");
        style.removed = true;
        paintStyles.delete(id);
      },
      getStyleConsumersAsync: consumersOf(id, ["fillStyleId", "strokeStyleId"]),
      get name() {
        return name;
      },
      set name(v: string) {
        writes.push(`${name}: name`);
        name = v;
      },
      get paints() {
        log.push("paints");
        return paints;
      },
      set paints(v: any[]) {
        writes.push(`${name}: paints`);
        paints = v;
      },
    };
    pluginData(style, () => name);
    paintStyles.set(id, style);
    return style;
  }

  function makeEffectStyle(): Fake {
    const id = `S:effect${++seq}`;
    let effects: any[] = [];
    const style: Fake = {
      id,
      type: "EFFECT",
      name: "",
      description: "",
      removed: false,
      get effects() {
        return effects;
      },
      set effects(v: any[]) {
        writes.push(`${style.name}: effects`);
        // As on a node.
        for (const e of v) {
          const blur = e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR";
          if (typeof e.visible !== "boolean" || (!blur && typeof e.blendMode !== "string")) {
            throw new Error("effect needs visible and blendMode");
          }
          if (blur && e.blurType !== "NORMAL") throw new Error("a blur needs blurType NORMAL");
        }
        effects = v;
      },
      remove() {
        called("effectStyle.remove");
        style.removed = true;
        effectStyles.delete(id);
      },
      getStyleConsumersAsync: consumersOf(id, ["effectStyleId"]),
    };
    pluginData(style, () => style.name);
    effectStyles.set(id, style);
    return style;
  }

  /** As Figma's: an alias to a variable it knows, of the variable's own type. */
  function checkAlias(value: any, type: string) {
    const target = variables.get(value.id);
    if (!target) throw new Error("alias to an unknown variable");
    if (target.resolvedType !== type) throw new Error("alias to a variable of another type");
  }

  function makeCollection(name: string, modes = ["Mode 1"]): Fake {
    const id = `VC:${++seq}`;
    let nextMode = modes.length;
    const known = (modeId: string) => {
      const mode = collection.modes.find((m: { modeId: string }) => m.modeId === modeId);
      if (!mode) throw new Error("unknown mode");
      return mode;
    };
    const collection: Fake = {
      id,
      name,
      modes: modes.map((m, i) => ({ modeId: `${id}/${i}`, name: m })),
      defaultModeId: `${id}/0`,
      addMode(modeName: string) {
        called("addMode");
        const limit = opts.modeLimit ?? 10;
        if (collection.modes.length >= limit) {
          throw new Error(`in addMode: Limited to ${limit} modes only`);
        }
        writes.push(`${collection.name}: add mode ${modeName}`);
        const modeId = `${id}/${nextMode++}`;
        // Measured: variables already here take the previous mode's values.
        const previous = collection.modes.at(-1)?.modeId;
        for (const v of variables.values()) {
          const value = v.valuesByMode[previous];
          if (v.variableCollectionId === id && value !== undefined) v.valuesByMode[modeId] = value;
        }
        collection.modes = [...collection.modes, { modeId, name: modeName }];
        return modeId;
      },
      renameMode(modeId: string, modeName: string) {
        called("renameMode");
        writes.push(`${collection.name}: rename mode`);
        known(modeId).name = modeName;
      },
      removeMode(modeId: string) {
        called("removeMode");
        writes.push(`${collection.name}: remove mode`);
        known(modeId);
        if (modeId === collection.defaultModeId) throw new Error("can't remove the default mode");
        collection.modes = collection.modes.filter((m: { modeId: string }) => m.modeId !== modeId);
        for (const v of variables.values()) {
          if (v.variableCollectionId === id) delete v.valuesByMode[modeId];
        }
      },
      get variableIds() {
        return [...variables.values()]
          .filter((v) => v.variableCollectionId === id)
          .map((v) => v.id);
      },
      remove() {
        called("collection.remove");
        writes.push(`remove collection ${collection.name}`);
        collection.removed = true;
        collections.delete(id);
        for (const v of [...variables.values()]) {
          if (v.variableCollectionId === id) variables.delete(v.id);
        }
      },
    };
    pluginData(collection, () => collection.name);
    collections.set(id, collection);
    return collection;
  }

  function makeVariable(name: string, collection: Fake, type = "COLOR"): Fake {
    if (!collections.has(collection?.id)) throw new Error("unknown collection");
    if (opts.failVariableName === name || /[.{}]/.test(name)) throw new Error(`bad name ${name}`);
    for (const v of variables.values()) {
      if (v.variableCollectionId === collection.id && v.name === name) {
        throw new Error(`a variable called ${name} already exists`);
      }
    }
    const id = `V:${++seq}`;
    const valuesByMode: Record<string, unknown> = {};
    const variable: Fake = {
      id,
      name,
      resolvedType: type,
      variableCollectionId: collection.id,
      valuesByMode,
      codeSyntax: {},
      removed: false,
      setValueForMode(modeId: string, value: any) {
        called("setValueForMode");
        writes.push(`${variable.name}: value`);
        if (!collection.modes.some((m: { modeId: string }) => m.modeId === modeId)) {
          throw new Error("unknown mode");
        }
        if (value?.type === "VARIABLE_ALIAS") {
          checkAlias(value, type);
          valuesByMode[modeId] = { type: value.type, id: value.id };
        } else if (type === "STRING") {
          if (typeof value !== "string") throw new Error("needs a string");
          valuesByMode[modeId] = value;
        } else if (type === "FLOAT") {
          if (typeof value !== "number") throw new Error("needs a number");
          valuesByMode[modeId] = Math.fround(value);
        } else {
          if (typeof value !== "object") throw new Error("needs a colour");
          valuesByMode[modeId] = stored(value);
        }
      },
      setVariableCodeSyntax(platform: string, value: string) {
        called("setVariableCodeSyntax");
        writes.push(`${variable.name}: code syntax`);
        variable.codeSyntax[platform] = value;
      },
      remove() {
        called("variable.remove");
        variable.removed = true;
        variables.delete(id);
      },
    };
    // Written like the rest, so a test can show a user's were left alone.
    let description = "";
    let scopes = ["ALL_SCOPES"];
    Object.defineProperties(variable, {
      description: {
        get: () => description,
        set: (v: string) => {
          writes.push(`${variable.name}: description`);
          description = v;
        },
      },
      scopes: {
        get: () => scopes,
        set: (v: string[]) => {
          writes.push(`${variable.name}: scopes`);
          if (!Array.isArray(v) || v.length === 0) throw new Error("needs scopes");
          scopes = [...v];
        },
      },
    });
    pluginData(variable, () => variable.name);
    variables.set(id, variable);
    return variable;
  }

  const api = {
    async getLocalTextStylesAsync() {
      called("getLocalTextStylesAsync");
      await hop();
      return [...textStyles.values()];
    },
    async getLocalPaintStylesAsync() {
      called("getLocalPaintStylesAsync");
      await hop();
      return [...paintStyles.values()];
    },
    createTextStyle() {
      called("createTextStyle");
      return makeTextStyle();
    },
    async getLocalEffectStylesAsync() {
      called("getLocalEffectStylesAsync");
      await hop();
      return [...effectStyles.values()];
    },
    createEffectStyle() {
      called("createEffectStyle");
      return makeEffectStyle();
    },
    createPaintStyle() {
      called("createPaintStyle");
      return makePaintStyle("", []);
    },
    variables: {
      async getLocalVariablesAsync(type?: string) {
        called("getLocalVariablesAsync");
        await hop();
        return [...variables.values()].filter((v) => !type || v.resolvedType === type);
      },
      async getLocalVariableCollectionsAsync() {
        called("getLocalVariableCollectionsAsync");
        await hop();
        return [...collections.values()];
      },
      createVariableCollection(name: string) {
        called("createVariableCollection");
        return makeCollection(name);
      },
      createVariable(name: string, collection: Fake, type: string) {
        called("createVariable");
        if (typeof collection === "string") throw new Error("dynamic-page needs the collection");
        if (!["COLOR", "FLOAT", "STRING"].includes(type)) throw new Error("unexpected type");
        return makeVariable(name, collection, type);
      },
      createVariableAlias(variable: Fake) {
        called("createVariableAlias");
        if (!variables.has(variable?.id)) throw new Error("unknown variable");
        return { type: "VARIABLE_ALIAS", id: variable.id };
      },
      setBoundVariableForEffect(effect: Fake, field: string, variable: Fake) {
        called("setBoundVariableForEffect");
        const shadow = effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW";
        if (!shadow || field !== "color") throw new Error("not a bindable effect field");
        if (!variables.has(variable?.id)) throw new Error("unknown variable");
        if (variable.resolvedType !== "COLOR") throw new Error("needs a colour variable");
        return {
          ...effect,
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
        };
      },
      setBoundVariableForPaint(paint: Fake, field: string, variable: Fake) {
        called("setBoundVariableForPaint");
        if (paint.type !== "SOLID" || field !== "color") throw new Error("not a bindable paint");
        if (!variables.has(variable?.id)) throw new Error("unknown variable");
        return {
          ...paint,
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: variable.id } },
        };
      },
    },
  };

  const knownStyle = (map: Map<string, Fake>, id: string) => {
    const style = map.get(id);
    if (!style) throw new Error(`unknown style ${id}`);
    return style;
  };

  return {
    api,
    log,
    writes,
    textStyles,
    paintStyles,
    effectStyles,
    variables,
    collections,
    count: (name: string) => log.filter((x) => x === name).length,
    textStyleById: (id: string) => textStyles.get(id),
    /** What a variable reads in a mode. Unset, that is a blank value, not the default mode's. */
    valueIn(variable: Fake, modeId: string) {
      const blank = variable.resolvedType === "COLOR" ? { r: 1, g: 1, b: 1, a: 1 } : 0;
      return variable.valuesByMode[modeId] ?? blank;
    },

    /** A style someone else made. */
    seedTextStyle(name: string, fields: Fake) {
      const style = makeTextStyle();
      style.name = name;
      loaded.add(fontId(fields.fontName ?? style.fontName));
      for (const [key, value] of Object.entries(fields)) style[key] = value;
      writes.length = 0;
      return style;
    },
    seedPaintStyle: (name: string, paints: any[]) => makePaintStyle(name, paints),
    seedCollection: (name: string, modes?: string[]) => makeCollection(name, modes),
    /** A variable someone else made. */
    seedVariable(name: string, collection: Fake, value: any, type = "COLOR") {
      const variable = makeVariable(name, collection, type);
      variable.setValueForMode(collection.defaultModeId, value);
      writes.length = 0;
      return variable;
    },

    installNode(node: FakeNode) {
      // Frames bind lengths and radii to number variables; a refused one throws as in Figma.
      node.setBoundVariable = (field: string, variable: Fake) => {
        called("node.setBoundVariable");
        if (typeof variable === "string") throw new Error("dynamic-page needs the variable");
        if (![...BINDABLE_LENGTHS, ...CORNERS].includes(field))
          throw new Error(`can't bind ${field}`);
        if (opts.failRadiusBinding === field) throw new Error(`${field} refused`);
        if (variable === null) {
          const { [field]: _gone, ...rest } = node.boundVariables ?? {};
          node.boundVariables = rest;
          return;
        }
        if (!variables.has(variable?.id)) throw new Error("unknown variable");
        if (variable.resolvedType !== "FLOAT") throw new Error("needs a number variable");
        node.boundVariables = {
          ...node.boundVariables,
          [field]: { type: "VARIABLE_ALIAS", id: variable.id },
        };
      };
      const link = (method: "setFillStyleIdAsync" | "setStrokeStyleIdAsync", field: string) => {
        node[method] = async (id: string) => {
          called(method);
          await hop();
          knownStyle(paintStyles, id);
          node[field] = id;
        };
      };
      link("setFillStyleIdAsync", "fillStyleId");
      link("setStrokeStyleIdAsync", "strokeStyleId");
      // Linking an effect style replaces the node's effects with the style's.
      node.setEffectStyleIdAsync = async (id: string) => {
        called("setEffectStyleIdAsync");
        await hop();
        const style = knownStyle(effectStyles, id);
        node.effects = style.effects;
        node.effectStyleId = id;
      };
    },

    installText(t: FakeNode, chars: () => string, layout: () => void) {
      t.decorations = [] as { s: number; e: number; v: string }[];
      t.textStyleIds = new Set<string>();
      const range = (s: number, e: number) => {
        if (s >= e || s < 0 || e > chars().length) throw new Error(`bad range ${s}-${e}`);
      };
      t.setRangeTextStyleIdAsync = async (s: number, e: number, id: string) => {
        called("setRangeTextStyleIdAsync");
        await hop();
        if (t.removed || t.parent?.removed) throw new Error("the node was removed");
        range(s, e);
        const style = knownStyle(textStyles, id);
        if (!loaded.has(fontId(style.fontName))) throw new Error("the style's font isn't loaded");
        t.textStyleIds.add(id);
        if (!t.ranges) t.ranges = [];
        t.ranges.push({ m: "setRangeTextStyleIdAsync", s, e, v: id });
        // A style sets its own decoration over whatever the range had.
        t.decorations.push({ s, e, v: style.textDecoration });
        layout();
      };
      t.setRangeFillStyleIdAsync = async (s: number, e: number, id: string) => {
        called("setRangeFillStyleIdAsync");
        await hop();
        range(s, e);
        knownStyle(paintStyles, id);
        if (!t.ranges) t.ranges = [];
        t.ranges.push({ m: "setRangeFillStyleIdAsync", s, e, v: id });
      };
      t.getRangeTextDecoration = (s: number, e: number) => {
        const last = [...t.decorations].reverse().find((d) => d.s <= s && d.e >= e);
        return last?.v ?? "NONE";
      };
    },
  };
}
