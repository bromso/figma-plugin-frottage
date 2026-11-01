import type {
  FontRef,
  ImportOptions,
  ModeValue,
  PlanColor,
  PlanModeColor,
  PlanModeType,
  PlanTextStyle,
  PlanTokens,
  PlanVersionTokens,
} from "@repo/figma-mapper";

/**
 * Settles a plan's tokens against the file: Frottage's own from an earlier import, then the user's,
 * and otherwise new ones. A user's tokens are only ever read and bound. Any failure here counts and
 * leaves the runs and paints with plain values. Types only from @repo/figma-mapper, as in the
 * applier.
 */

const NAMESPACE = "frottage";
const VALUE_KEY = "valueKey";
/** On a collection Frottage made. Older ones have none, and go by their variables' value keys. */
const COLLECTION_KEY = "collection";
/** Half an 8-bit step: two colours this close are the same colour. */
const CHANNEL_TOLERANCE = 1 / 512;
/** Figma stores 32-bit numbers, so a size read back isn't quite the one that was set. */
const NUMBER_TOLERANCE = 1e-4;

export type TokenCounts = {
  stylesCreated: number;
  stylesReused: number;
  variablesCreated: number;
  variablesReused: number;
  /** Tokens that couldn't be made or applied; what they were for has plain values. */
  tokenFailures: number;
  /** Versions with a mode of their own. */
  modes: number;
  /** Versions without one, which read the collection's default mode. */
  modesDropped: number;
};

export const NO_TOKENS: TokenCounts = {
  stylesCreated: 0,
  stylesReused: 0,
  variablesCreated: 0,
  variablesReused: 0,
  tokenFailures: 0,
  modes: 0,
  modesDropped: 0,
};

/** What the applier lends for one run: its time budget and its fonts. */
export type TokenRuntime = {
  overBudget(): boolean;
  /** Yields to Figma. */
  breathe(): Promise<unknown>;
  /** True once the font is loaded. */
  ensureFont(font: FontRef): Promise<boolean>;
};

type ColorBinding = { variable: Variable } | { paintStyleId: string };

/** How to compare what a variable holds with a value it should hold. */
type Kind<T> = {
  type: "COLOR" | "FLOAT";
  same(held: VariableValue | undefined, want: T): boolean;
};

/** The collection a set of versions lives in, with this import's additions to it. */
type Home = {
  collection: VariableCollection;
  taken: Set<string>;
  /** Modes added just now, which hold no value of their own yet. */
  added: Set<string>;
};

/** A variable to make, and what each of the versions' modes should read. */
type VariableSpec<T> = {
  name: string;
  key: string;
  kind: Kind<T>;
  first: T;
  wants: Map<string, T>;
  cssVar?: string;
};

const near = (a: number, b: number, tolerance = NUMBER_TOLERANCE) => Math.abs(a - b) <= tolerance;

function sameColor(a: RGB | RGBA, rgba: PlanColor["rgba"]): boolean {
  return (
    near(a.r, rgba.r, CHANNEL_TOLERANCE) &&
    near(a.g, rgba.g, CHANNEL_TOLERANCE) &&
    near(a.b, rgba.b, CHANNEL_TOLERANCE) &&
    near("a" in a ? a.a : 1, rgba.a, CHANNEL_TOLERANCE)
  );
}

function sameLineHeight(style: TextStyle, px: number | null): boolean {
  const { lineHeight } = style;
  if (px === null) return lineHeight.unit === "AUTO";
  return lineHeight.unit === "PIXELS" && near(lineHeight.value, px);
}

const COLOR: Kind<RGBA> = {
  type: "COLOR",
  same: (held, want) =>
    typeof held === "object" && held !== null && "r" in held && sameColor(held, want),
};
const FLOAT: Kind<number> = {
  type: "FLOAT",
  same: (held, want) => typeof held === "number" && near(held, want),
};

/** What each mode should read: its version's value, or the first's if it has none. */
function valuesFor<T>(
  values: ModeValue<T | null>[],
  first: T,
  modeIds: Map<number, string>
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [version, modeId] of modeIds) {
    out.set(modeId, values.find((v) => v.mode === version)?.value ?? first);
  }
  return out;
}

/** Whether modes would differ. One mode, or none, has nothing to differ from. */
function varies<T extends VariableValue>(wants: Map<string, T>, first: T, kind: Kind<T>): boolean {
  return wants.size > 1 && [...wants.values()].some((v) => !kind.same(v, first));
}

/** Whether versions differ, before knowing how many of them get a mode. */
function differs<T extends VariableValue>(values: ModeValue<T | null>[], kind: Kind<T>): boolean {
  const first = values[0]?.value ?? null;
  if (first === null) return false;
  return values.some(({ value }) => value !== null && !kind.same(value, first));
}

/** A style's letter spacing is often in percent of its size, which 0 px is the same as at 0%. */
function sameLetterSpacing(style: TextStyle, px: number): boolean {
  const { unit, value } = style.letterSpacing;
  return near(unit === "PIXELS" ? value : (value * style.fontSize) / 100, px);
}

/**
 * Imported text sets none of these, so a style that does would change the text once linked.
 * `textWrapStyle` stays out: imported text doesn't set it either way.
 */
function hasNeutralParagraph(style: TextStyle): boolean {
  return (
    style.paragraphSpacing === 0 &&
    style.paragraphIndent === 0 &&
    style.leadingTrim === "NONE" &&
    style.listSpacing === 0 &&
    !style.hangingPunctuation &&
    !style.hangingList
  );
}

function sameTextStyle(style: TextStyle, token: PlanTextStyle): boolean {
  return (
    style.fontName.family === token.fontName.family &&
    style.fontName.style === token.fontName.style &&
    near(style.fontSize, token.fontSize) &&
    sameLineHeight(style, token.lineHeight) &&
    sameLetterSpacing(style, token.letterSpacing) &&
    style.textDecoration === token.decoration &&
    style.textCase === token.textCase &&
    hasNeutralParagraph(style)
  );
}

/** The colour of a paint style that paints the same as a plain opaque colour would, else null. */
function solidColorOf(style: PaintStyle): RGB | null {
  const [paint, ...rest] = style.paints;
  const plain =
    paint?.type === "SOLID" &&
    rest.length === 0 &&
    paint.visible !== false &&
    (paint.opacity ?? 1) === 1 &&
    (paint.blendMode ?? "NORMAL") === "NORMAL";
  return plain ? paint.color : null;
}

/** The default mode's colour, or null for an alias: what it points at is matched on its own. */
function colorOf(variable: Variable, modes: Map<string, string>): RGBA | null {
  const mode = modes.get(variable.variableCollectionId);
  const value = mode === undefined ? undefined : variable.valuesByMode[mode];
  return typeof value === "object" && value !== null && "r" in value ? (value as RGBA) : null;
}

/**
 * A free name, recording it as taken. Numbered names continue after the highest in the file, so
 * `keepIfFree` is for names that only look numbered, such as `color/500` from a custom property.
 */
function takeName(name: string, taken: Set<string>, keepIfFree: boolean): string {
  let out = name;
  const numbered = /^(.*\/)\d+$/.exec(name)?.[1];
  if (numbered !== undefined && !(keepIfFree && !taken.has(name))) {
    let highest = 0;
    for (const t of taken) {
      const rest = t.startsWith(numbered) ? t.slice(numbered.length) : "";
      if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
    }
    out = `${numbered}${highest + 1}`;
  } else {
    for (let n = 2; taken.has(out); n++) out = `${name}-${n}`;
  }
  taken.add(out);
  return out;
}

/** Tokens Frottage made, by the value each was made for. The value may have changed since. */
function byOwnKey<T extends TextStyle | Variable>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const token of list) {
    const key = token.getSharedPluginData(NAMESPACE, VALUE_KEY);
    if (!key) continue;
    const same = out.get(key);
    if (same) same.push(token);
    else out.set(key, [token]);
  }
  return out;
}

/** Layers bound to these variables. Mixed text fills aren't read: Figma has no quick way to. */
function boundOnPage(page: PageNode, ids: Set<string>): Set<string> {
  const used = new Set<string>();
  const note = (paints: unknown) => {
    if (!Array.isArray(paints)) return;
    for (const paint of paints as Paint[]) {
      const id = paint.type === "SOLID" ? paint.boundVariables?.color?.id : undefined;
      if (id !== undefined && ids.has(id)) used.add(id);
    }
  };
  page.findAll((node) => {
    if ("fills" in node) note(node.fills);
    if ("strokes" in node) note(node.strokes);
    return false;
  });
  return used;
}

/** The same value in every mode. */
const flatten = <T>(wants: Map<string, T>, first: T) =>
  new Map([...wants.keys()].map((modeId) => [modeId, first]));

/** A role's size and line height, which is the first version's: a style has only one of each. */
function firstLook(role: PlanModeType, fontSize: number, lineHeight: number | null): PlanTextStyle {
  const { key, name, fontName, letterSpacing, decoration, textCase } = role;
  return { key, name, fontName, fontSize, lineHeight, letterSpacing, decoration, textCase };
}

function boundFields(style: TextStyle): boolean {
  return Boolean(style.boundVariables?.fontSize ?? style.boundVariables?.lineHeight);
}

/** Marks a collection as Frottage's. Failing costs little: its variables' keys still say so. */
function tagCollection(collection: VariableCollection): void {
  try {
    collection.setSharedPluginData(NAMESPACE, COLLECTION_KEY, "1");
  } catch {
    // its variables still carry theirs
  }
}

export function createTokenSet(api: PluginAPI) {
  const styleIds = new Map<string, string>();
  const colors = new Map<string, ColorBinding>();
  const counts = { ...NO_TOKENS };
  let createdStyles: TextStyle[] = [];
  let createdVariables: Variable[] = [];
  let createdCollection: VariableCollection | null = null;
  /** Modes added to a collection that was already there. A created one goes whole. */
  let createdModes: { collection: VariableCollection; modeId: string }[] = [];
  /** Each version's mode, in `modesCollection`. A version that has none is missing. */
  let modeIds = new Map<number, string>();
  let modesCollection: VariableCollection | null = null;
  /** Set once the import is abandoned: nothing may be created after that. */
  let closed = false;

  function failed(n = 1) {
    counts.tokenFailures += n;
  }

  function createStyle(token: PlanTextStyle, taken: Set<string>): TextStyle {
    const style = api.createTextStyle();
    try {
      // First: every other type field needs the style's font loaded.
      style.fontName = token.fontName;
      style.name = takeName(token.name, taken, false);
      style.fontSize = token.fontSize;
      style.lineHeight =
        token.lineHeight === null ? { unit: "AUTO" } : { unit: "PIXELS", value: token.lineHeight };
      style.letterSpacing = { unit: "PIXELS", value: token.letterSpacing };
      style.textDecoration = token.decoration;
      style.textCase = token.textCase;
      style.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
    } catch (e) {
      style.remove();
      throw e;
    }
    return style;
  }

  async function resolveTextStyles(
    tokens: PlanTextStyle[],
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    if (tokens.length === 0) return;
    const existing = await api.getLocalTextStylesAsync();
    const taken = new Set(existing.map((s) => s.name));
    const own = byOwnKey(existing);
    for (const token of tokens) {
      if (runtime.overBudget()) await runtime.breathe();
      // Linking a style needs its font, so a font that won't load rules out even an exact match.
      const ready = await runtime.ensureFont(token.fontName);
      if (closed) return;
      try {
        if (!ready) throw new Error("font unavailable");
        const found =
          own.get(token.key)?.find((s) => sameTextStyle(s, token)) ??
          (useLocal ? existing.find((s) => sameTextStyle(s, token)) : undefined);
        if (found) {
          styleIds.set(token.key, found.id);
          counts.stylesReused++;
          continue;
        }
        const style = createStyle(token, taken);
        createdStyles.push(style);
        styleIds.set(token.key, style.id);
        counts.stylesCreated++;
      } catch {
        failed();
      }
    }
  }

  function createVariable(
    token: PlanColor,
    collection: VariableCollection,
    taken: Set<string>
  ): Variable {
    const name = takeName(token.name, taken, token.cssVar !== undefined);
    const variable = api.variables.createVariable(name, collection, "COLOR");
    try {
      variable.setValueForMode(collection.defaultModeId, token.rgba);
      if (token.cssVar) variable.setVariableCodeSyntax("WEB", `var(${token.cssVar})`);
      variable.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
    } catch (e) {
      variable.remove();
      throw e;
    }
    return variable;
  }

  async function resolveColors(
    plan: PlanTokens,
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    if (plan.colors.length === 0) return;
    const variables = await api.variables.getLocalVariablesAsync("COLOR");
    const collections = await api.variables.getLocalVariableCollectionsAsync();
    const paintStyles = useLocal ? await api.getLocalPaintStylesAsync() : [];
    if (closed) return;

    const modes = new Map(collections.map((c) => [c.id, c.defaultModeId]));
    // Read once: a file can hold hundreds, and each read crosses into Figma.
    const values = new Map(variables.map((v) => [v.id, colorOf(v, modes)]));
    const matches = (v: Variable, token: PlanColor) => {
      const value = values.get(v.id);
      return value != null && sameColor(value, token.rgba);
    };
    const solids = paintStyles.flatMap((s) => {
      const color = solidColorOf(s);
      return color ? [{ id: s.id, color }] : [];
    });
    const own = byOwnKey(variables);
    const local = useLocal ? variables : [];

    let target: { collection: VariableCollection; taken: Set<string> } | null = null;
    /** Made only when a variable needs it, so that an import that reuses all adds nothing. */
    const home = () => {
      if (target) return target;
      let collection = collections.find((c) => c.name === plan.collection);
      if (!collection) {
        collection = api.variables.createVariableCollection(plan.collection);
        createdCollection = collection;
        tagCollection(collection);
      }
      const { id } = collection;
      const names = variables.filter((v) => v.variableCollectionId === id).map((v) => v.name);
      target = { collection, taken: new Set(names) };
      return target;
    };

    for (const token of plan.colors) {
      if (runtime.overBudget()) {
        await runtime.breathe();
        if (closed) return;
      }
      try {
        const reused =
          own.get(token.key)?.find((v) => matches(v, token)) ??
          local.find((v) => matches(v, token));
        if (reused) {
          colors.set(token.key, { variable: reused });
          counts.variablesReused++;
          continue;
        }
        const style = solids.find((s) => sameColor(s.color, token.rgba));
        if (style) {
          colors.set(token.key, { paintStyleId: style.id });
          counts.stylesReused++;
          continue;
        }
        const { collection, taken } = home();
        const variable = createVariable(token, collection, taken);
        createdVariables.push(variable);
        colors.set(token.key, { variable });
        counts.variablesCreated++;
      } catch {
        failed();
      }
    }
    if (createdCollection && createdVariables.length === 0) {
      createdCollection.remove();
      createdCollection = null;
    }
  }

  /** Puts each version in a mode, up to the plan's limit. `fresh` is a collection made just now. */
  async function settleModes(
    collection: VariableCollection,
    labels: string[],
    fresh: boolean,
    pause: () => Promise<boolean>
  ): Promise<Set<string>> {
    const added = new Set<string>();
    // Only the default mode of a collection made just now is free to take a label.
    const named = new Map(fresh ? [] : collection.modes.map((m) => [m.name, m.modeId]));
    modesCollection = collection;
    const [firstLabel] = labels;
    if (fresh && firstLabel !== undefined) {
      try {
        collection.renameMode(collection.defaultModeId, firstLabel);
      } catch {
        failed();
      }
      modeIds.set(0, collection.defaultModeId);
    }
    labels.forEach((label, version) => {
      const modeId = named.get(label);
      if (modeId !== undefined) modeIds.set(version, modeId);
    });
    let tagged = fresh || collection.getSharedPluginData(NAMESPACE, COLLECTION_KEY) !== "";
    for (const [version, label] of labels.entries()) {
      if (modeIds.has(version)) continue;
      if (!(await pause())) break;
      try {
        const modeId = collection.addMode(label);
        modeIds.set(version, modeId);
        added.add(modeId);
        if (!fresh) createdModes.push({ collection, modeId });
        if (!tagged) tagCollection(collection);
        tagged = true;
      } catch (e) {
        // A plan's limit is a limit, not a failure, and the plugin says so through `modesDropped`.
        if (!String(e).includes("Limited to")) failed();
        break;
      }
    }
    return added;
  }

  async function resolveVersions(
    plan: PlanVersionTokens,
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    if (plan.colors.length + plan.textStyles.length === 0) return;
    const variables = await api.variables.getLocalVariablesAsync();
    const collections = await api.variables.getLocalVariableCollectionsAsync();
    const textStyles = plan.textStyles.length > 0 ? await api.getLocalTextStylesAsync() : [];
    const paintStyles =
      useLocal && plan.colors.length > 0 ? await api.getLocalPaintStylesAsync() : [];
    if (closed) return;

    const pause = async () => {
      if (runtime.overBudget()) await runtime.breathe();
      return !closed;
    };

    const defaults = new Map(collections.map((c) => [c.id, c.defaultModeId]));
    // Read once, as in `resolveColors`.
    const held = new Map(variables.map((v) => [v.id, v.valuesByMode]));
    const ownVariables = byOwnKey(variables);
    const ownStyles = byOwnKey(textStyles);
    const tagged = new Set([...ownVariables.values()].flat().map((v) => v.id));
    const local = useLocal ? variables.filter((v) => v.resolvedType === "COLOR") : [];
    const solids = paintStyles.flatMap((s) => {
      const color = solidColorOf(s);
      return color ? [{ id: s.id, color }] : [];
    });
    const takenStyles = new Set(textStyles.map((s) => s.name));

    const isOwn = (c: VariableCollection) =>
      c.getSharedPluginData(NAMESPACE, COLLECTION_KEY) !== "" ||
      (c.variableIds.length > 0 && c.variableIds.every((id) => tagged.has(id)));
    const ownNamed = (name: string) => collections.find((c) => c.name === name && isOwn(c));
    const ownName = `${plan.collection} (Frottage)`;
    const existing = ownNamed(ownName) ?? ownNamed(plan.collection);

    let home: Home | null = null;
    /** Whether anything asked for modes, so that their absence means something. */
    let wanted = false;

    const homeOf = async (): Promise<Home> => {
      if (home) return home;
      wanted = true;
      let collection = existing;
      if (!collection) {
        const free = !collections.some((c) => c.name === plan.collection);
        collection = api.variables.createVariableCollection(free ? plan.collection : ownName);
        createdCollection = collection;
        tagCollection(collection);
      }
      const { id } = collection;
      const names = variables.filter((v) => v.variableCollectionId === id).map((v) => v.name);
      const added = await settleModes(collection, plan.modes, !existing, pause);
      home = { collection, taken: new Set(names), added };
      return home;
    };

    /**
     * The modes of `wants` that this variable doesn't read as asked yet, or null if it can't be made
     * to: only a mode added just now is still empty, and any other value is the file's.
     */
    const staleModes = <T>(variable: Variable, wants: Map<string, T>, kind: Kind<T>) => {
      const values = held.get(variable.id);
      const base = values?.[defaults.get(variable.variableCollectionId) ?? ""];
      const stale: [string, T][] = [];
      for (const [modeId, want] of wants) {
        if (kind.same(values?.[modeId] ?? base, want)) continue;
        if (!home?.added.has(modeId)) return null;
        stale.push([modeId, want]);
      }
      return stale;
    };

    /** Frottage's own variable with this key in the home collection, filling in any new modes. */
    const reuseOwn = async <T extends VariableValue>(
      key: string,
      wants: Map<string, T>,
      kind: Kind<T>,
      { collection }: Home
    ): Promise<Variable | null> => {
      for (const variable of ownVariables.get(key) ?? []) {
        if (variable.variableCollectionId !== collection.id) continue;
        const stale = staleModes(variable, wants, kind);
        if (!stale) continue;
        for (const [modeId, value] of stale) {
          if (!(await pause())) return null;
          variable.setValueForMode(modeId, value);
        }
        return variable;
      }
      return null;
    };

    /** Null if the import ended meanwhile, which also took the variable back. */
    const makeVariable = async <T extends VariableValue>(
      spec: VariableSpec<T>,
      { collection, taken }: Home
    ): Promise<Variable | null> => {
      const { kind, wants } = spec;
      const name = takeName(spec.name, taken, spec.cssVar !== undefined);
      const variable = api.variables.createVariable(name, collection, kind.type);
      // Now, not at the end: writing the modes yields, and `discard` may run during it.
      createdVariables.push(variable);
      try {
        // A version without a mode reads this. If a version holds the default, its value decides.
        const { defaultModeId } = collection;
        const base = wants.get(defaultModeId) ?? spec.first;
        variable.setValueForMode(defaultModeId, base);
        for (const [modeId, value] of wants) {
          if (modeId === defaultModeId || kind.same(value, base)) continue;
          if (!(await pause())) return null;
          variable.setValueForMode(modeId, value);
        }
        if (spec.cssVar) variable.setVariableCodeSyntax("WEB", `var(${spec.cssVar})`);
        variable.setSharedPluginData(NAMESPACE, VALUE_KEY, spec.key);
      } catch (e) {
        dropVariable(variable);
        throw e;
      }
      return variable;
    };

    /** Follows `resolveColors`: Frottage's own, then the user's, then a new variable. */
    const settleFlatColor = async (
      token: PlanModeColor,
      first: RGBA,
      wants: Map<string, RGBA>
    ): Promise<void> => {
      const flat = flatten(wants, first);
      const mode = (v: Variable) => defaults.get(v.variableCollectionId) ?? "";
      // In the home collection the variable is read in the versions' modes too, not only by default.
      const fits = (v: Variable) =>
        COLOR.same(held.get(v.id)?.[mode(v)], first) &&
        (v.variableCollectionId !== existing?.id || staleModes(v, flat, COLOR) !== null);
      const reused =
        ownVariables.get(token.key)?.find(fits) ??
        ownVariables.get(token.from[0] ?? "")?.find(fits) ??
        local.find(fits);
      if (reused) {
        colors.set(token.key, { variable: reused });
        counts.variablesReused++;
        return;
      }
      const style = solids.find((s) => sameColor(s.color, first));
      if (style) {
        colors.set(token.key, { paintStyleId: style.id });
        counts.stylesReused++;
        return;
      }
      const target = await homeOf();
      if (closed) return;
      // With no modes asked for, every mode reads the default.
      const variable = await makeVariable(
        { ...token, kind: COLOR, first, wants: new Map() },
        target
      );
      if (!variable) return;
      colors.set(token.key, { variable });
      counts.variablesCreated++;
    };

    const settleColor = async (token: PlanModeColor): Promise<void> => {
      const first = token.values[0]?.value;
      if (!first) throw new Error("no value");
      const wants = valuesFor(token.values, first, modeIds);
      if (!varies(wants, first, COLOR)) return settleFlatColor(token, first, wants);
      const target = await homeOf();
      if (closed) return;
      const reused = await reuseOwn(token.key, wants, COLOR, target);
      if (closed) return;
      if (reused) {
        colors.set(token.key, { variable: reused });
        counts.variablesReused++;
        return;
      }
      const variable = await makeVariable({ ...token, kind: COLOR, first, wants }, target);
      if (!variable) return;
      colors.set(token.key, { variable });
      counts.variablesCreated++;
    };

    /** Binds a float variable to a style just made. A refused binding leaves the first value. */
    const bindType = async (
      style: TextStyle,
      field: "fontSize" | "lineHeight",
      name: string,
      key: string,
      first: number,
      wants: Map<string, number>,
      target: Home
    ): Promise<void> => {
      try {
        const reused = await reuseOwn(key, wants, FLOAT, target);
        if (closed) return;
        const variable =
          reused ?? (await makeVariable({ name, key, kind: FLOAT, first, wants }, target));
        if (!variable) return;
        try {
          style.setBoundVariable(field, variable);
        } catch (e) {
          if (!reused) dropVariable(variable);
          throw e;
        }
        if (reused) counts.variablesReused++;
        else counts.variablesCreated++;
      } catch {
        failed();
      }
    };

    const settleRole = async (role: PlanModeType): Promise<void> => {
      const firstSize = role.fontSize[0]?.value;
      if (firstSize === undefined) throw new Error("no value");
      const firstLine = role.lineHeight[0]?.value ?? null;
      const look = firstLook(role, firstSize, firstLine);
      const sizes = valuesFor(role.fontSize, firstSize, modeIds);
      // AUTO has no number, so a role that starts on it stays on it in every mode.
      const lines =
        firstLine === null
          ? new Map<string, number>()
          : valuesFor(role.lineHeight, firstLine, modeIds);
      const sizeVaries = varies(sizes, firstSize, FLOAT);
      const lineVaries = firstLine !== null && varies(lines, firstLine, FLOAT);

      if (!sizeVaries && !lineVaries) {
        // A style of Frottage's bound to modes reads differently in them, whatever it says here.
        const fits = (s: TextStyle) =>
          sameTextStyle(s, look) &&
          !(s.getSharedPluginData(NAMESPACE, VALUE_KEY) && boundFields(s));
        const found =
          ownStyles.get(role.key)?.find(fits) ??
          ownStyles.get(role.from[0] ?? "")?.find(fits) ??
          (useLocal ? textStyles.find(fits) : undefined);
        if (found) {
          styleIds.set(role.key, found.id);
          counts.stylesReused++;
          return;
        }
        const style = createStyle(look, takenStyles);
        createdStyles.push(style);
        styleIds.set(role.key, style.id);
        counts.stylesCreated++;
        return;
      }

      const target = await homeOf();
      if (closed) return;
      const sizeKey = `${role.key}/size`;
      const lineKey = `${role.key}/line-height`;
      const found = ownStyles
        .get(role.key)
        ?.find(
          (s) =>
            sameTextStyle(s, look) &&
            (!sizeVaries || s.boundVariables?.fontSize) &&
            (!lineVaries || s.boundVariables?.lineHeight)
        );
      if (found) {
        styleIds.set(role.key, found.id);
        counts.stylesReused++;
        for (const [isVaried, key, wants] of [
          [sizeVaries, sizeKey, sizes],
          [lineVaries, lineKey, lines],
        ] as const) {
          if (!isVaried) continue;
          const reused = await reuseOwn(key, wants, FLOAT, target);
          if (closed) return;
          if (reused) counts.variablesReused++;
        }
        return;
      }
      const style = createStyle(look, takenStyles);
      createdStyles.push(style);
      styleIds.set(role.key, style.id);
      counts.stylesCreated++;
      const prefix = `type/${role.name}`;
      if (sizeVaries) {
        await bindType(style, "fontSize", `${prefix}/size`, sizeKey, firstSize, sizes, target);
      }
      if (lineVaries && !closed) {
        const name = `${prefix}/line-height`;
        await bindType(style, "lineHeight", name, lineKey, firstLine, lines, target);
      }
    };

    try {
      const different =
        plan.colors.some((t) => differs(t.values, COLOR)) ||
        plan.textStyles.some((t) => differs(t.fontSize, FLOAT) || differs(t.lineHeight, FLOAT));
      if (existing || different) {
        try {
          await homeOf();
        } catch {
          // Each token that needed it counts, below.
        }
      }
      for (const role of plan.textStyles) {
        if (!(await pause())) return;
        // Linking a style needs its font, so a font that won't load rules out even an exact match.
        const ready = await runtime.ensureFont(role.fontName);
        if (closed) return;
        try {
          if (!ready) throw new Error("font unavailable");
          await settleRole(role);
        } catch {
          failed();
        }
        if (closed) return;
      }
      for (const token of plan.colors) {
        if (!(await pause())) return;
        try {
          await settleColor(token);
        } catch {
          failed();
        }
        if (closed) return;
      }
    } finally {
      if (!closed) {
        if (createdCollection && createdVariables.length === 0) {
          createdCollection.remove();
          createdCollection = null;
          modesCollection = null;
          modeIds = new Map();
        }
        counts.modes = modeIds.size;
        counts.modesDropped = wanted ? plan.modes.length - modeIds.size : 0;
      }
    }
  }

  /** Takes back a variable made just now. */
  function dropVariable(variable: Variable): void {
    createdVariables = createdVariables.filter((v) => v !== variable);
    variable.remove();
  }

  /** Whether each variable is held by something outside the import, which is already removed. */
  async function usedVariables(variables: Variable[]): Promise<Set<string>> {
    const ids = new Set(variables.map((v) => v.id));
    const used = boundOnPage(api.currentPage, ids);
    for (const v of await api.variables.getLocalVariablesAsync()) {
      if (ids.has(v.id)) continue;
      for (const value of Object.values(v.valuesByMode)) {
        if (typeof value !== "object" || !("type" in value)) continue;
        if (value.type === "VARIABLE_ALIAS" && ids.has(value.id)) used.add(value.id);
      }
    }
    for (const style of await api.getLocalPaintStylesAsync()) {
      for (const paint of style.paints) {
        const id = paint.type === "SOLID" ? paint.boundVariables?.color?.id : undefined;
        if (id !== undefined && ids.has(id)) used.add(id);
      }
    }
    if (variables.some((v) => v.resolvedType === "FLOAT")) {
      for (const style of await api.getLocalTextStylesAsync()) {
        for (const alias of Object.values(style.boundVariables ?? {})) {
          if (ids.has(alias.id)) used.add(alias.id);
        }
      }
    }
    return used;
  }

  return {
    /** Works out every token in the plan. Never throws: what fails stays plain. */
    async resolve(plan: PlanTokens, options: ImportOptions, runtime: TokenRuntime): Promise<void> {
      if (!options.tokens) return;
      try {
        await resolveTextStyles(plan.textStyles, options.useLocalStyles, runtime);
      } catch {
        failed(Math.max(plan.textStyles.length - styleIds.size, 1));
      }
      if (closed) return;
      try {
        await resolveColors(plan, options.useLocalStyles, runtime);
      } catch {
        failed(Math.max(plan.colors.length - colors.size, 1));
      }
    },

    /** As `resolve`, for a set of versions: one mode for each, as far as the file allows. */
    async resolveModes(
      plan: PlanVersionTokens,
      options: ImportOptions,
      runtime: TokenRuntime
    ): Promise<void> {
      if (!options.tokens) return;
      try {
        await resolveVersions(plan, options.useLocalStyles, runtime);
      } catch {
        const total = plan.textStyles.length + plan.colors.length;
        failed(Math.max(total - styleIds.size - colors.size, 1));
      }
    },

    /** The mode a version's frame sits on, or null for one without a mode of its own. */
    modeOf(index: number): { collection: VariableCollection; modeId: string } | null {
      const modeId = modeIds.get(index);
      return modeId !== undefined && modesCollection
        ? { collection: modesCollection, modeId }
        : null;
    },

    textStyleId: (key: string | undefined) => (key ? styleIds.get(key) : undefined),
    color: (key: string | undefined) => (key ? colors.get(key) : undefined),
    failed,
    counts: () => ({ ...counts }),

    /**
     * Takes back what this import made, where nothing else uses it. When usage can't be read, the
     * token stays: a leftover is reused by the next import, and a removal can't be taken back.
     */
    async discard(): Promise<void> {
      closed = true;
      const styles = createdStyles;
      const variables = createdVariables;
      const collection = createdCollection;
      const modes = createdModes;
      createdStyles = [];
      createdVariables = [];
      createdCollection = null;
      createdModes = [];
      for (const style of styles) {
        try {
          if ((await style.getStyleConsumersAsync()).length === 0) style.remove();
        } catch {
          // keep it
        }
      }
      if (variables.length === 0 && !collection && modes.length === 0) return;
      try {
        const used = await usedVariables(variables);
        for (const variable of variables) if (!used.has(variable.id)) variable.remove();
        if (collection?.variableIds.length === 0) collection.remove();
        // A variable that stays keeps the values it holds in these modes.
        if (used.size > 0) return;
        for (const { collection: owner, modeId } of modes) owner.removeMode(modeId);
      } catch {
        // keep them
      }
    },
  };
}

export type TokenSet = ReturnType<typeof createTokenSet>;
