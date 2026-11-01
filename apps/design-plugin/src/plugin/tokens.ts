import type {
  FontRef,
  ImportOptions,
  ModeValue,
  PlanColor,
  PlanModeColor,
  PlanModeSpacing,
  PlanModeType,
  PlanSpacing,
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
/**
 * On a collection Frottage made, holding its hostname, so that it's found under any name. Older
 * ones have none, and go by their variables' value keys.
 */
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
  /** How many versions asked for a mode and got none. */
  modesDropped: number;
  /**
   * Those versions. Their frames lose their tokens: a null `modeOf` alone doesn't say that, as one
   * can also mean nothing needed a mode.
   */
  droppedVersions: number[];
};

export const NO_TOKENS: TokenCounts = {
  stylesCreated: 0,
  stylesReused: 0,
  variablesCreated: 0,
  variablesReused: 0,
  tokenFailures: 0,
  modes: 0,
  modesDropped: 0,
  droppedVersions: [],
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

/** What a text style holds: a token with no count of its uses, which the sandbox has no use for. */
type TextLook = Omit<PlanTextStyle, "uses">;

/** How to compare what a variable holds with a value it should hold. */
type Kind<T> = {
  type: "COLOR" | "FLOAT";
  same(held: VariableValue | undefined, want: T): boolean;
};

/** The collection a set of versions lives in, with this import's additions to it. */
type Home = {
  collection: VariableCollection;
  taken: Set<string>;
  /** Modes added just now. Figma copies the previous mode's values in, so those mean nothing. */
  added: Set<string>;
};

/** One of a text style's fields that can vary by mode, as a float variable. */
type TypeField = {
  field: "fontSize" | "lineHeight" | "letterSpacing";
  name: string;
  key: string;
  first: number;
  wants: Map<string, number>;
};

/**
 * A variable to make, and what the versions' modes should read. Every other mode of the collection
 * reads `first`: left unset, it wouldn't fall back on the default mode.
 */
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

/** The earliest version's value among those with a mode, else `first`. */
function leadOf<T>(wants: Map<string, T>, first: T): T {
  for (const value of wants.values()) return value;
  return first;
}

/** Whether modes differ from each other. One mode, or none, has nothing to differ from. */
function varies<T extends VariableValue>(wants: Map<string, T>, kind: Kind<T>): boolean {
  const values = [...wants.values()];
  const [lead] = values;
  return lead !== undefined && values.some((v) => !kind.same(v, lead));
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

function sameTextStyle(style: TextStyle, token: TextLook): boolean {
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

/** Tokens by their name, which several in different collections can share. */
function namedIn<T extends { name: string }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const token of list) {
    const same = out.get(token.name);
    if (same) same.push(token);
    else out.set(token.name, [token]);
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
  /** A node's own fields, each an alias or a list of them, such as a gap or a size. */
  const noteFields = (bound: object | undefined) => {
    for (const value of Object.values(bound ?? {})) {
      for (const alias of [value].flat() as VariableAlias[]) {
        if (alias?.id !== undefined && ids.has(alias.id)) used.add(alias.id);
      }
    }
  };
  page.findAll((node) => {
    if ("fills" in node) note(node.fills);
    if ("strokes" in node) note(node.strokes);
    noteFields(node.boundVariables);
    return false;
  });
  return used;
}

/** A role's look as a style holds it: only one of each value, whatever the modes do. */
function styleLook(
  role: PlanModeType,
  fontSize: number,
  lineHeight: number | null,
  letterSpacing: number
): TextLook {
  const { key, name, fontName, decoration, textCase } = role;
  return { key, name, fontName, fontSize, lineHeight, letterSpacing, decoration, textCase };
}

function boundFields(style: TextStyle): boolean {
  const bound = style.boundVariables;
  return Boolean(bound?.fontSize ?? bound?.lineHeight ?? bound?.letterSpacing);
}

/** Marks a collection as Frottage's. Failing costs little: its variables' keys still say so. */
function tagCollection(collection: VariableCollection, hostname: string): void {
  try {
    collection.setSharedPluginData(NAMESPACE, COLLECTION_KEY, hostname);
  } catch {
    // its variables still carry theirs
  }
}

/** The name for a new collection: a user's of the host's name stays as it is, beside this one. */
const ownCollectionName = (hostname: string) => `${hostname} (Frottage)`;

function newCollectionName(collections: VariableCollection[], hostname: string): string {
  const free = !collections.some((c) => c.name === hostname);
  return free ? hostname : ownCollectionName(hostname);
}

/**
 * Frottage's collection for this host: by its tag, then by name. One counts as Frottage's when it's
 * tagged, or when all its variables carry a value key, which is how older ones are told apart.
 * Figma doesn't let a plugin add to a remote or extended one, so those are never it.
 */
function findOwnCollection(
  collections: VariableCollection[],
  ownVariables: Map<string, Variable[]>,
  hostname: string
): VariableCollection | undefined {
  const tagged = new Set([...ownVariables.values()].flat().map((v) => v.id));
  const hostOf = (c: VariableCollection) => c.getSharedPluginData(NAMESPACE, COLLECTION_KEY);
  const own = collections.filter((c) => {
    if (c.isExtension || c.remote) return false;
    const host = hostOf(c);
    // "1" is an early tag with no host: tagged, so it's left to the name to say whose it is.
    if (host === "1") return true;
    if (host !== "") return host === hostname;
    return c.variableIds.length > 0 && c.variableIds.every((id) => tagged.has(id));
  });
  return (
    own.find((c) => hostOf(c) === hostname) ??
    own.find((c) => c.name === ownCollectionName(hostname)) ??
    own.find((c) => c.name === hostname)
  );
}

export function createTokenSet(api: PluginAPI) {
  const styleIds = new Map<string, string>();
  const colors = new Map<string, ColorBinding>();
  const spacing = new Map<string, Variable>();
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

  function createStyle(token: TextLook, taken: Set<string>): TextStyle {
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
      // Every mode: an unset one doesn't fall back on the default.
      for (const { modeId } of collection.modes) variable.setValueForMode(modeId, token.rgba);
      if (token.cssVar) variable.setVariableCodeSyntax("WEB", `var(${token.cssVar})`);
      variable.setSharedPluginData(NAMESPACE, VALUE_KEY, token.key);
    } catch (e) {
      variable.remove();
      throw e;
    }
    return variable;
  }

  /** A number variable for a length, in every mode of its collection. */
  function createSpacingVariable(
    token: PlanSpacing,
    collection: VariableCollection,
    taken: Set<string>
  ): Variable {
    const name = takeName(token.name, taken, true);
    const variable = api.variables.createVariable(name, collection, "FLOAT");
    try {
      for (const { modeId } of collection.modes) variable.setValueForMode(modeId, token.px);
      variable.setVariableCodeSyntax("WEB", `var(${token.cssVar})`);
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
    const lengths = plan.spacing ?? [];
    if (plan.colors.length + lengths.length === 0) return;
    // Of every type: whether a collection is Frottage's goes by all its variables.
    const variables = await api.variables.getLocalVariablesAsync();
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
      let collection = findOwnCollection(collections, own, plan.collection);
      if (!collection) {
        const name = newCollectionName(collections, plan.collection);
        collection = api.variables.createVariableCollection(name);
        createdCollection = collection;
        tagCollection(collection, plan.collection);
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
    // Frottage's own only: spacing has no matching rule that would take a user's by value.
    const heldPx = (v: Variable) => v.valuesByMode[modes.get(v.variableCollectionId) ?? ""];
    for (const token of lengths) {
      if (runtime.overBudget()) {
        await runtime.breathe();
        if (closed) return;
      }
      try {
        const reused = own
          .get(token.key)
          ?.find((v) => v.resolvedType === "FLOAT" && FLOAT.same(heldPx(v), token.px));
        if (reused) {
          spacing.set(token.key, reused);
          counts.variablesReused++;
          continue;
        }
        const { collection, taken } = home();
        const variable = createSpacingVariable(token, collection, taken);
        createdVariables.push(variable);
        spacing.set(token.key, variable);
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
    { modes: labels, collection: hostname }: PlanVersionTokens,
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
        if (!tagged) tagCollection(collection, hostname);
        tagged = true;
      } catch (e) {
        // A plan's limit is a limit, not a failure, and the plugin says so through `modesDropped`.
        if (!String(e).includes("Limited to")) failed();
        break;
      }
    }
    // With no room for its label, the first version still needs a mode for its tokens to bind in.
    const claimed = new Set(modeIds.values()).has(collection.defaultModeId);
    if (!closed && !modeIds.has(0) && !claimed) modeIds.set(0, collection.defaultModeId);
    // In version order, which `leadOf` depends on.
    modeIds = new Map([...modeIds].sort(([a], [b]) => a - b));
    return added;
  }

  /** Records which versions went without a mode. */
  function recordModes(dropped: number[]): void {
    counts.modes = modeIds.size;
    counts.modesDropped = dropped.length;
    counts.droppedVersions = dropped;
  }

  const withoutMode = (plan: PlanVersionTokens) =>
    plan.modes.flatMap((_, version) => (modeIds.has(version) ? [] : [version]));

  async function resolveVersions(
    plan: PlanVersionTokens,
    useLocal: boolean,
    runtime: TokenRuntime
  ): Promise<void> {
    const lengths = plan.spacing ?? [];
    if (plan.colors.length + plan.textStyles.length + lengths.length === 0) return;
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
    const existing = findOwnCollection(collections, ownVariables, plan.collection);
    const byId = new Map(variables.map((v) => [v.id, v]));
    const ownNamed = namedIn(
      variables.filter((v) => tagged.has(v.id) && v.variableCollectionId === existing?.id)
    );
    const ownStylesNamed = namedIn([...ownStyles.values()].flat());
    const local = useLocal ? variables.filter((v) => v.resolvedType === "COLOR") : [];
    const solids = paintStyles.flatMap((s) => {
      const color = solidColorOf(s);
      return color ? [{ id: s.id, color }] : [];
    });
    const takenStyles = new Set(textStyles.map((s) => s.name));

    let home: Home | null = null;
    /** Whether anything asked for modes, so that their absence means something. */
    let wanted = false;

    const homeOf = async (): Promise<Home> => {
      if (home) return home;
      wanted = true;
      let collection = existing;
      if (!collection) {
        const name = newCollectionName(collections, plan.collection);
        collection = api.variables.createVariableCollection(name);
        createdCollection = collection;
        tagCollection(collection, plan.collection);
      }
      const { id } = collection;
      const names = variables.filter((v) => v.variableCollectionId === id).map((v) => v.name);
      const added = await settleModes(collection, plan, !existing, pause);
      home = { collection, taken: new Set(names), added };
      return home;
    };

    /**
     * What a variable in the home collection lacks: the modes added just now or with no value yet,
     * each with what it should read. Null if it can't be used, because a value it holds says
     * otherwise, or because it's the user's and would need a write, or because there's no home to
     * read it in. A mode outside the set may hold anything, but the default reads `first`, or an
     * edited variable would pass when every label is new. `byShared` is for a variable found by
     * name: a label it shares is the evidence for it, so the default needn't be in the set.
     */
    const staleModes = <T>(
      variable: Variable,
      wants: Map<string, T>,
      first: T,
      kind: Kind<T>,
      byShared = false
    ) => {
      if (!home) return null;
      const values = held.get(variable.id);
      const defaultId = defaults.get(variable.variableCollectionId) ?? "";
      if (!byShared && !wants.has(defaultId) && !kind.same(values?.[defaultId], first)) return null;
      const own = tagged.has(variable.id);
      const stale: [string, T][] = [];
      for (const { modeId } of home.collection.modes) {
        const want = wants.get(modeId);
        const have = home.added.has(modeId) ? undefined : values?.[modeId];
        if (have !== undefined) {
          if (want !== undefined && !kind.same(have, want)) return null;
        } else if (own) {
          stale.push([modeId, want ?? first]);
        } else if (want !== undefined) {
          return null;
        }
      }
      return stale;
    };

    const fillIn = async <T extends VariableValue>(variable: Variable, stale: [string, T][]) => {
      for (const [modeId, value] of stale) {
        if (!(await pause())) return;
        variable.setValueForMode(modeId, value);
      }
    };

    /** Modes that were here before this import, which is what a name has to be checked against. */
    const sharedModes = (wants: Map<string, unknown>) =>
      home?.collection === createdCollection
        ? []
        : [...wants.keys()].filter((modeId) => !home?.added.has(modeId));

    /**
     * Keys hold every label, so a set with another width finds nothing by key. Frottage's variable
     * of this name stands in if it reads the same at each label they share, and they share one.
     */
    const byName = <T>(name: string, wants: Map<string, T>, first: T, kind: Kind<T>) => {
      const shared = sharedModes(wants);
      for (const variable of ownNamed.get(name) ?? []) {
        const values = held.get(variable.id);
        if (variable.resolvedType !== kind.type) continue;
        if (!shared.some((modeId) => values?.[modeId] !== undefined)) continue;
        const stale = staleModes(variable, wants, first, kind, true);
        if (stale) return { variable, stale };
      }
      return null;
    };

    /**
     * Frottage's own variable with this key in the home collection, or else this name, filling in
     * any new modes.
     */
    const reuseOwn = async <T extends VariableValue>(
      key: string,
      name: string,
      wants: Map<string, T>,
      first: T,
      kind: Kind<T>,
      { collection }: Home
    ): Promise<Variable | null> => {
      for (const variable of ownVariables.get(key) ?? []) {
        if (variable.variableCollectionId !== collection.id) continue;
        const stale = staleModes(variable, wants, first, kind);
        if (!stale) continue;
        await fillIn(variable, stale);
        return closed ? null : variable;
      }
      const named = byName(name, wants, first, kind);
      if (!named) return null;
      await fillIn(named.variable, named.stale);
      return closed ? null : named.variable;
    };

    /** Null if the import ended meanwhile, which also took the variable back. */
    const makeVariable = async <T extends VariableValue>(
      spec: VariableSpec<T>,
      { collection, taken }: Home
    ): Promise<Variable | null> => {
      const { wants, first, kind } = spec;
      const name = takeName(spec.name, taken, spec.cssVar !== undefined);
      const variable = api.variables.createVariable(name, collection, kind.type);
      // Now, not at the end: writing the modes yields, and `discard` may run during it.
      createdVariables.push(variable);
      try {
        for (const { modeId } of collection.modes) {
          if (!(await pause())) return null;
          variable.setValueForMode(modeId, wants.get(modeId) ?? first);
        }
        if (spec.cssVar) variable.setVariableCodeSyntax("WEB", `var(${spec.cssVar})`);
        variable.setSharedPluginData(NAMESPACE, VALUE_KEY, spec.key);
      } catch (e) {
        dropVariable(variable);
        throw e;
      }
      return variable;
    };

    /** The single-version key of the version `leadOf` takes its value from. */
    const leadKey = (from: (string | null)[]) => from[[...modeIds.keys()][0] ?? 0] ?? "";

    /** Follows `resolveColors`: Frottage's own, then the user's, then a new variable. */
    const settleFlatColor = async (
      token: PlanModeColor,
      value: RGBA,
      wants: Map<string, RGBA>
    ): Promise<void> => {
      const inHome = (v: Variable) => v.variableCollectionId === existing?.id;
      const defaultOf = (v: Variable) => defaults.get(v.variableCollectionId) ?? "";
      // In the home collection the variable is read in the versions' modes too, not only by default.
      const fits = (v: Variable) =>
        COLOR.same(held.get(v.id)?.[defaultOf(v)], value) &&
        (!inHome(v) || staleModes(v, wants, value, COLOR) !== null);
      const keyed =
        ownVariables.get(token.key)?.find(fits) ??
        ownVariables.get(leadKey(token.from))?.find(fits);
      const named = keyed ? null : byName(token.name, wants, value, COLOR);
      if (named) {
        await fillIn(named.variable, named.stale);
        if (closed) return;
        colors.set(token.key, { variable: named.variable });
        counts.variablesReused++;
        return;
      }
      const reused = keyed ?? local.find(fits);
      if (reused) {
        if (inHome(reused)) await fillIn(reused, staleModes(reused, wants, value, COLOR) ?? []);
        if (closed) return;
        colors.set(token.key, { variable: reused });
        counts.variablesReused++;
        return;
      }
      const style = solids.find((s) => sameColor(s.color, value));
      if (style) {
        colors.set(token.key, { paintStyleId: style.id });
        counts.stylesReused++;
        return;
      }
      const target = await homeOf();
      if (closed) return;
      const spec = { ...token, kind: COLOR, first: value, wants: new Map<string, RGBA>() };
      const variable = await makeVariable(spec, target);
      if (!variable) return;
      colors.set(token.key, { variable });
      counts.variablesCreated++;
    };

    const settleColor = async (token: PlanModeColor): Promise<void> => {
      const first = token.values[0]?.value;
      if (!first) throw new Error("no value");
      const wants = valuesFor(token.values, first, modeIds);
      if (!varies(wants, COLOR)) return settleFlatColor(token, leadOf(wants, first), wants);
      const target = await homeOf();
      if (closed) return;
      const reused = await reuseOwn(token.key, token.name, wants, first, COLOR, target);
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

    /** Frottage's own, as a flat colour can't be: a length has no user's variable to take. */
    const settleSpacing = async (token: PlanModeSpacing): Promise<void> => {
      const first = token.values[0]?.value;
      if (first === undefined) throw new Error("no value");
      const wants = valuesFor(token.values, first, modeIds);
      const target = await homeOf();
      if (closed) return;
      const reused = await reuseOwn(token.key, token.name, wants, first, FLOAT, target);
      if (closed) return;
      if (reused) {
        spacing.set(token.key, reused);
        counts.variablesReused++;
        return;
      }
      const variable = await makeVariable({ ...token, kind: FLOAT, first, wants }, target);
      if (!variable) return;
      spacing.set(token.key, variable);
      counts.variablesCreated++;
    };

    /** Binds a float variable to a style, noting a new one in `made`. False if it can't be bound. */
    const bindType = async (
      style: TextStyle,
      { field, name, key, first, wants }: TypeField,
      target: Home,
      made: Variable[]
    ): Promise<boolean> => {
      try {
        const reused = await reuseOwn(key, name, wants, first, FLOAT, target);
        if (closed) return true;
        const variable =
          reused ?? (await makeVariable({ name, key, kind: FLOAT, first, wants }, target));
        if (!variable) return true;
        if (!reused) made.push(variable);
        style.setBoundVariable(field, variable);
        if (reused) counts.variablesReused++;
        return true;
      } catch {
        failed();
        return false;
      }
    };

    /**
     * A style that can't vary would show its first value in every frame, so it goes, with the
     * variables made for it, and its runs keep their plain fields.
     */
    const dropRole = (key: string, style: TextStyle, made: Variable[]) => {
      styleIds.delete(key);
      createdStyles = createdStyles.filter((s) => s !== style);
      counts.stylesCreated--;
      style.remove();
      for (const variable of made) dropVariable(variable);
    };

    /** The variable a style is bound to for a field, if it's in the home collection and fits. */
    const boundFits = (
      style: TextStyle,
      { field, first, wants }: TypeField,
      { collection }: Home,
      byShared = false
    ) => {
      const alias = style.boundVariables?.[field];
      const variable = alias && byId.get(alias.id);
      if (variable?.variableCollectionId !== collection.id) return null;
      const stale = staleModes(variable, wants, first, FLOAT, byShared);
      return stale ? { variable, stale } : null;
    };

    const settleFlatRole = (role: PlanModeType, look: TextLook) => {
      // A style of Frottage's bound to modes reads differently in them, whatever it says here.
      const fits = (s: TextStyle) =>
        sameTextStyle(s, look) && !(s.getSharedPluginData(NAMESPACE, VALUE_KEY) && boundFields(s));
      const found =
        ownStyles.get(role.key)?.find(fits) ??
        ownStyles.get(leadKey(role.from))?.find(fits) ??
        ownStylesNamed.get(role.name)?.find(fits) ??
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
    };

    /**
     * Frottage's style of this name for a set with another width. It holds what its first mode
     * read, so that's what it's compared with, and a field not bound yet has to read the same at
     * every label shared, or the style wasn't this role's.
     */
    const styleByName = (
      role: PlanModeType,
      look: TextLook,
      fields: { field: TypeField; varying: boolean }[],
      target: Home
    ) => {
      const defaultId = target.collection.defaultModeId;
      const reads: TextLook = { ...look };
      for (const { field } of fields) {
        if (field.field === "lineHeight" && look.lineHeight === null) continue;
        reads[field.field] = field.wants.get(defaultId) ?? look[field.field] ?? 0;
      }
      const shared = sharedModes(fields[0]?.field.wants ?? new Map());
      if (shared.length === 0) return undefined;
      const readsAcross = ({ field, wants }: TypeField) =>
        shared.every((modeId) => {
          const want = wants.get(modeId);
          return want === undefined || FLOAT.same(want, reads[field] ?? 0);
        });
      return ownStylesNamed
        .get(role.name)
        ?.find(
          (s) =>
            sameTextStyle(s, reads) &&
            fields.every(({ field }) =>
              s.boundVariables?.[field.field]
                ? boundFits(s, field, target, true)
                : readsAcross(field)
            )
        );
    };

    const settleVaryingRole = async (
      role: PlanModeType,
      look: TextLook,
      fields: { field: TypeField; varying: boolean }[]
    ): Promise<void> => {
      const target = await homeOf();
      if (closed) return;
      // Every field a style binds has to read what this set asks, even one that doesn't vary here.
      const isFit = (s: TextStyle) =>
        sameTextStyle(s, look) &&
        fields.every(({ field, varying }) =>
          s.boundVariables?.[field.field] ? boundFits(s, field, target) : !varying
        );
      const keyed = ownStyles.get(role.key)?.find(isFit);
      const found = keyed ?? styleByName(role, look, fields, target);
      if (found) {
        const made: Variable[] = [];
        for (const { field, varying } of fields) {
          const bound = boundFits(found, field, target, !keyed);
          if (bound) {
            await fillIn(bound.variable, bound.stale);
            if (closed) return;
            counts.variablesReused++;
          } else if (varying && !(await bindType(found, field, target, made))) {
            // The style was there before this import: it stays, and its runs keep plain values.
            for (const variable of made) dropVariable(variable);
            return;
          }
          if (closed) return;
        }
        counts.variablesCreated += made.length;
        styleIds.set(role.key, found.id);
        counts.stylesReused++;
        return;
      }
      const style = createStyle(look, takenStyles);
      createdStyles.push(style);
      styleIds.set(role.key, style.id);
      counts.stylesCreated++;
      const made: Variable[] = [];
      for (const { field, varying } of fields) {
        if (closed) return;
        if (!varying || (await bindType(style, field, target, made))) continue;
        dropRole(role.key, style, made);
        return;
      }
      counts.variablesCreated += made.length;
    };

    const settleRole = async (role: PlanModeType): Promise<void> => {
      const firstSize = role.fontSize[0]?.value;
      if (firstSize === undefined) throw new Error("no value");
      const firstLine = role.lineHeight[0]?.value ?? null;
      const firstTracking = role.letterSpacing[0]?.value ?? 0;

      const sizes = valuesFor(role.fontSize, firstSize, modeIds);
      const trackings = valuesFor(role.letterSpacing, firstTracking, modeIds);
      // A role is AUTO in every version or a number in every one: `fixedLook` keeps them apart.
      const lines =
        firstLine === null
          ? new Map<string, number>()
          : valuesFor(role.lineHeight, firstLine, modeIds);

      const sizeVaries = varies(sizes, FLOAT);
      const lineVaries = varies(lines, FLOAT);
      const trackingVaries = varies(trackings, FLOAT);
      const look = styleLook(
        role,
        sizeVaries ? firstSize : leadOf(sizes, firstSize),
        firstLine === null || lineVaries ? firstLine : leadOf(lines, firstLine),
        trackingVaries ? firstTracking : leadOf(trackings, firstTracking)
      );
      if (!sizeVaries && !lineVaries && !trackingVaries) return settleFlatRole(role, look);

      const prefix = `type/${role.name}`;
      const field = (
        name: TypeField["field"],
        suffix: string,
        first: number,
        wants: Map<string, number>,
        varying: boolean
      ) => ({
        field: {
          field: name,
          name: `${prefix}/${suffix}`,
          key: `${role.key}/${suffix}`,
          first,
          wants,
        },
        varying,
      });
      await settleVaryingRole(role, look, [
        field("fontSize", "size", firstSize, sizes, sizeVaries),
        field("lineHeight", "line-height", firstLine ?? 0, lines, lineVaries),
        field("letterSpacing", "tracking", firstTracking, trackings, trackingVaries),
      ]);
    };

    try {
      const different =
        plan.colors.some((t) => differs(t.values, COLOR)) ||
        plan.textStyles.some(
          (t) =>
            differs(t.fontSize, FLOAT) ||
            differs(t.lineHeight, FLOAT) ||
            differs(t.letterSpacing, FLOAT)
        ) ||
        lengths.some((t) => differs(t.values, FLOAT));
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
      for (const token of lengths) {
        if (!(await pause())) return;
        try {
          await settleSpacing(token);
        } catch {
          failed();
        }
        if (closed) return;
      }
    } finally {
      if (!closed) {
        const dropped = wanted ? withoutMode(plan) : [];
        if (createdCollection && createdVariables.length === 0) {
          // Nothing needed it, so a version that held a mode lost nothing by its going.
          createdCollection.remove();
          createdCollection = null;
          modesCollection = null;
          modeIds = new Map();
        }
        recordModes(dropped);
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
        const lengths = plan.spacing?.length ?? 0;
        failed(Math.max(plan.colors.length + lengths - colors.size - spacing.size, 1));
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
        const total = plan.textStyles.length + plan.colors.length + (plan.spacing?.length ?? 0);
        failed(Math.max(total - styleIds.size - colors.size - spacing.size, 1));
        recordModes(withoutMode(plan));
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
    spacing: (key: string | null | undefined) => (key ? spacing.get(key) : undefined),
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
