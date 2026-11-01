import type {
  LayerPlan,
  ModeValue,
  PlanColor,
  PlanModeColor,
  PlanModeSpacing,
  PlanModeType,
  PlanOp,
  PlanRun,
  PlanSpacing,
  PlanTextStyle,
  PlanVersionTokens,
  SpacingKeys,
} from "./plan";
import { cssColorOf, cssSpacingOf, MIN_USES, rgbaOf } from "./tokens";

/**
 * Turns several versions' tokens into one set with a mode per version. The first version seeds
 * the set, and a later version's token joins a seed or stays a plain value in its own frame. A
 * colour joins by the same custom property, then the same value. A text style joins by shared
 * text, then the same role, and only with the same look apart from what varies by mode. A spacing
 * token joins by its custom property alone: a length no property names stays plain. A colour or
 * text style stays a token when its uses across the versions it joined reach `MIN_USES`, so that a
 * heading set once at each width still varies, and each plan's own floor may be lower for that.
 */

export type TokenVersion = {
  label: string;
  plan: LayerPlan;
  /** The capture's `tokens.cssCustomProperties`. */
  cssValues: Record<string, string>;
};

/** Per version, the token standing in for each seed. */
type Joins<T> = Map<T, T>[];

/** A later version's colours: `cssOnly` is what a seed's property holds where no token does. */
type ColorJoins = { joins: Map<PlanColor, PlanColor>; cssOnly: Map<PlanColor, string> };

/** Per version, what each single-version key becomes. */
type Renames = {
  colors: Map<string, string>;
  styles: Map<string, string>;
  spacing: Map<string, string>;
};

/** Longest label the file format accepts, which a mode's name keeps to as well. */
const LABEL_MAX = 40;

/** `base (n)` within the limit, cutting the base and never a character in half. */
function suffixed(base: string, n: number): string {
  const suffix = ` (${n})`;
  const room = base.slice(0, LABEL_MAX - suffix.length);
  return `${room.replace(/\p{Cs}$/u, "").trimEnd()}${suffix}`;
}

function uniqueLabels(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = label.replace(/ \(\d+\)$/, "");
    let unique = label;
    for (let n = 2; taken.has(unique); n++) unique = suffixed(base, n);
    taken.add(unique);
    return unique;
  });
}

function joinColors(
  seeds: PlanColor[],
  tokens: PlanColor[],
  cssValues: Record<string, string>
): ColorJoins {
  const joins = new Map<PlanColor, PlanColor>();
  const cssOnly = new Map<PlanColor, string>();
  const free = new Map(tokens.map((t) => [t.key, t]));
  const join = (seed: PlanColor, token: PlanColor | undefined) => {
    if (!token || joins.has(seed) || !free.has(token.key)) return;
    joins.set(seed, token);
    free.delete(token.key);
  };

  const byCssVar = new Map(tokens.map((t) => [t.cssVar, t]));
  for (const seed of seeds) if (seed.cssVar) join(seed, byCssVar.get(seed.cssVar));
  // A token shows one custom property, and the seed's may be another that holds the same value.
  // Where no token holds it, the property still says what the variable is in this version.
  for (const seed of seeds) {
    const value = seed.cssVar ? cssColorOf(seed.cssVar, cssValues) : null;
    if (!value || joins.has(seed)) continue;
    const token = free.get(value);
    if (token) join(seed, token);
    else cssOnly.set(seed, value);
  }
  // A property this version defines has spoken, even in a value that can't be read.
  for (const seed of seeds) {
    if (!seed.cssVar || !Object.hasOwn(cssValues, seed.cssVar)) join(seed, free.get(seed.key));
  }
  return { joins, cssOnly };
}

/** A later version's spacing: `cssOnly` is what a seed's property holds where no token does. */
type SpacingJoins = { joins: Map<PlanSpacing, PlanSpacing>; cssOnly: Map<PlanSpacing, number> };

function joinSpacing(
  seeds: PlanSpacing[],
  tokens: PlanSpacing[],
  cssValues: Record<string, string>
): SpacingJoins {
  const joins = new Map<PlanSpacing, PlanSpacing>();
  const cssOnly = new Map<PlanSpacing, number>();
  const byCssVar = new Map(tokens.map((t) => [t.cssVar, t]));
  for (const seed of seeds) {
    const token = byCssVar.get(seed.cssVar);
    if (token) {
      joins.set(seed, token);
      continue;
    }
    const px = cssSpacingOf(seed.cssVar, cssValues);
    if (px !== null) cssOnly.set(seed, px);
  }
  return { joins, cssOnly };
}

/** A later version's text styles: `shared` seeds read a token that another seed joined. */
type StyleJoins = {
  joins: Map<PlanTextStyle, PlanTextStyle>;
  shared: Map<PlanTextStyle, PlanTextStyle>;
};

/** What has to match for two text styles to be one: letter spacing goes with the size. */
function fixedLook(s: PlanTextStyle): string {
  const tracking = s.fontSize === 0 ? 0 : Math.round((s.letterSpacing / s.fontSize) * 1000);
  return JSON.stringify([s.fontName, tracking, s.lineHeight === null, s.decoration, s.textCase]);
}

/** Per text style, how many times each string is set in it. */
type TextCounts = Map<string, Map<string, number>>;

function textsOf(ops: PlanOp[]): TextCounts {
  const counts: TextCounts = new Map();
  const add = (text: string, runs: PlanRun[]) => {
    for (const { styleKey, start, end } of runs) {
      const piece = text.slice(start, end).trim();
      if (!styleKey || piece === "") continue;
      let texts = counts.get(styleKey);
      if (!texts) {
        texts = new Map();
        counts.set(styleKey, texts);
      }
      texts.set(piece, (texts.get(piece) ?? 0) + 1);
    }
  };
  for (const op of ops) {
    if (op.op === "text") add(op.text, op.runs);
    if (op.op !== "instance") continue;
    for (const over of op.overrides) if (over.kind === "text") add(over.text, over.runs);
  }
  return counts;
}

/** Fewer shared characters than this are chance, such as a lone "Menu". */
const MIN_SHARED = 8;
/** A piece in more styles than this tells them apart no better than a role, at seeds × tokens. */
const MAX_HOLDERS = 50;
const HAS_LETTER = /\p{L}/u;

/**
 * Characters each seed and token have in common, by their keys. Only pairs with some appear. A
 * number or a mark says nothing about a role, so only pieces with a letter count.
 */
function sharedCharacters(seeds: TextCounts, tokens: TextCounts): Map<string, Map<string, number>> {
  const holders = new Map<string, { seed: string; times: number }[]>();
  for (const [seed, texts] of seeds) {
    for (const [text, times] of texts) {
      if (!HAS_LETTER.test(text)) continue;
      const list = holders.get(text);
      if (list) list.push({ seed, times });
      else holders.set(text, [{ seed, times }]);
    }
  }
  const scores = new Map<string, Map<string, number>>();
  for (const [token, texts] of tokens) {
    for (const [text, times] of texts) {
      const list = holders.get(text);
      if (!list || list.length > MAX_HOLDERS) continue;
      for (const holder of list) {
        let row = scores.get(holder.seed);
        if (!row) {
          row = new Map();
          scores.set(holder.seed, row);
        }
        const chars = Math.min(times, holder.times) * text.length;
        row.set(token, (row.get(token) ?? 0) + chars);
      }
    }
  }
  return scores;
}

const roleOf = (style: PlanTextStyle) => style.name.split("/")[0] ?? "";

/** Each style at the floor by its role and its place among those, as `heading/2`. */
function ranksOf(styles: PlanTextStyle[]): Map<PlanTextStyle, string> {
  const counts = new Map<string, number>();
  const ranks = new Map<PlanTextStyle, string>();
  for (const style of styles) {
    if (style.uses < MIN_USES) continue;
    const role = roleOf(style);
    const n = (counts.get(role) ?? 0) + 1;
    counts.set(role, n);
    ranks.set(style, `${role}/${n}`);
  }
  return ranks;
}

function joinStyles(
  seeds: PlanTextStyle[],
  tokens: PlanTextStyle[],
  seedTexts: TextCounts,
  tokenTexts: TextCounts
): StyleJoins {
  const scores = sharedCharacters(seedTexts, tokenTexts);
  const pairs: { seed: PlanTextStyle; token: PlanTextStyle; chars: number; order: number }[] = [];
  const looks = new Map(tokens.map((t) => [t, fixedLook(t)]));
  const tokenAt = new Map(tokens.map((t, at) => [t.key, { token: t, at }]));
  seeds.forEach((seed, seedAt) => {
    const look = fixedLook(seed);
    for (const [key, chars] of scores.get(seed.key) ?? []) {
      const found = tokenAt.get(key);
      if (chars < MIN_SHARED || !found || looks.get(found.token) !== look) continue;
      pairs.push({ seed, token: found.token, chars, order: seedAt * tokens.length + found.at });
    }
  });
  pairs.sort((a, b) => b.chars - a.chars || a.order - b.order);

  const joins = new Map<PlanTextStyle, PlanTextStyle>();
  const shared = new Map<PlanTextStyle, PlanTextStyle>();
  const claimed = new Set<PlanTextStyle>();
  for (const { seed, token } of pairs) {
    if (joins.has(seed) || shared.has(seed)) continue;
    if (claimed.has(token)) shared.set(seed, token);
    else {
      joins.set(seed, token);
      claimed.add(token);
    }
  }

  // A seed with no text in common: a language pair, or a part of the page only one version shows.
  // The same value in the same role is the best evidence left. Then rank, which a one-off in either
  // plan would shift, so only tokens at the floor have one.
  const free = (seed: PlanTextStyle, token: PlanTextStyle | undefined) => {
    if (joins.has(seed) || shared.has(seed)) return;
    if (!token || claimed.has(token) || looks.get(token) !== fixedLook(seed)) return;
    joins.set(seed, token);
    claimed.add(token);
  };
  for (const seed of seeds) {
    const same = tokenAt.get(seed.key)?.token;
    if (same && roleOf(same) === roleOf(seed)) free(seed, same);
  }
  const seedRanks = ranksOf(seeds);
  const byRank = new Map([...ranksOf(tokens)].map(([token, rank]) => [rank, token]));
  for (const [seed, rank] of seedRanks) free(seed, byRank.get(rank));
  return { joins, shared };
}

/**
 * The name, then each mode's value with its label, sorted by label. Labels keep values with their
 * modes, so a repeat import finds the token in any order, and swapped themes don't.
 */
function mergedKey(name: string, modes: string[], valueAt: (mode: number) => string | undefined) {
  const parts = modes.flatMap((label, mode) => {
    const value = valueAt(mode);
    return value === undefined ? [] : [`${label}=${value}`];
  });
  return [name, ...parts.sort()].join("|");
}

function perMode<T, V>(
  modes: string[],
  at: (mode: number) => T | undefined,
  value: (found: T) => V
): ModeValue<V>[] {
  return modes.flatMap((_, mode) => {
    const found = at(mode);
    return found === undefined ? [] : [{ mode, value: value(found) }];
  });
}

const fromKeys = <T extends { key: string }>(seed: T, joins: Joins<T>) =>
  joins.map((version) => version.get(seed)?.key ?? null);

/** Spacing keys renamed, or gone with their token. Undefined where none is left. */
function rekeyedSpacing(keys: SpacingKeys, names: Map<string, string>): SpacingKeys | undefined {
  const out: SpacingKeys = {};
  for (const field of ["itemSpacing", "counterSpacing", "rowGap", "columnGap"] as const) {
    const key = keys[field];
    const next = key == null ? undefined : names.get(key);
    if (next !== undefined) out[field] = next;
  }
  const padding = keys.padding?.map((key) => (key == null ? undefined : names.get(key)));
  if (padding?.some((key) => key !== undefined)) out.padding = padding as SpacingKeys["padding"];
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A deep copy with every token key renamed, or removed if it has no new name, wherever it sits. */
function rekeyed(value: unknown, renames: Renames): unknown {
  if (Array.isArray(value)) return value.map((item) => rekeyed(item, renames));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
    if (field === "spacingKeys") {
      const next = rekeyedSpacing(inner as SpacingKeys, renames.spacing);
      if (next) out[field] = next;
      continue;
    }
    const names =
      field === "colorKey" ? renames.colors : field === "styleKey" ? renames.styles : null;
    if (!names) out[field] = rekeyed(inner, renames);
    else {
      const key = names.get(inner as string);
      if (key !== undefined) out[field] = key;
    }
  }
  return out;
}

/** `ops` with their keys renamed. The set's tokens replace `tokens`, whose keys ops no longer hold. */
function withRenames(plan: LayerPlan, renames: Renames): LayerPlan {
  return {
    ...plan,
    ops: rekeyed(plan.ops, renames) as PlanOp[],
    tokens: { textStyles: [], colors: [], collection: plan.tokens.collection },
  };
}

/** A plan with no tokens: every key goes, as an unmatched token's does, and plain values stay. */
export function stripTokens(plan: LayerPlan): LayerPlan {
  const none = {
    colors: new Map<string, string>(),
    styles: new Map<string, string>(),
    spacing: new Map<string, string>(),
  };
  return withRenames(plan, none);
}

/** Uses of a seed across the versions it reads a token in. */
const usesAcross = <T extends { uses: number }>(seed: T, joins: Joins<T>) =>
  joins.reduce((sum, version) => sum + (version.get(seed)?.uses ?? 0), 0);

/** A version's tokens at the floor that joined no kept seed: they stay plain, and it's said. */
function strandedIn<T extends { uses: number }>(tokens: T[], joined: Map<T, T> | undefined) {
  const held = new Set(joined?.values());
  return tokens.filter((t) => t.uses >= MIN_USES && !held.has(t)).length;
}

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function plainReport(mode: string, colors: number, styles: number, spacing: number): string[] {
  const parts = [
    ...(colors > 0 ? [counted(colors, "colour")] : []),
    ...(styles > 0 ? [counted(styles, "text style")] : []),
    ...(spacing > 0 ? [counted(spacing, "spacing value")] : []),
  ];
  if (parts.length === 0) return [];
  const verb = colors + styles + spacing === 1 ? "stayed a plain value" : "stayed plain values";
  return [`${mode}: ${parts.join(" and ")} ${verb}.`];
}

export function mergeVersions(versions: TokenVersion[]): {
  tokens: PlanVersionTokens;
  plans: LayerPlan[];
  report: string[];
} {
  const firstColors = versions[0]?.plan.tokens.colors ?? [];
  const firstStyles = versions[0]?.plan.tokens.textStyles ?? [];
  const seedSpacing = versions[0]?.plan.tokens.spacing ?? [];
  const colorSets = versions.map((v, i) =>
    i === 0
      ? { joins: new Map(firstColors.map((seed) => [seed, seed])), cssOnly: new Map() }
      : joinColors(firstColors, v.plan.tokens.colors, v.cssValues)
  );
  const colorJoins = colorSets.map((set) => set.joins);
  const seedColors = firstColors.filter((seed) => usesAcross(seed, colorJoins) >= MIN_USES);
  const colorKeyAt = (seed: PlanColor, mode: number) =>
    colorJoins[mode]?.get(seed)?.key ?? colorSets[mode]?.cssOnly.get(seed);
  const seedTexts = textsOf(versions[0]?.plan.ops ?? []);
  const styleSets: StyleJoins[] = versions.map((v, i) =>
    i === 0
      ? { joins: new Map(firstStyles.map((seed) => [seed, seed])), shared: new Map() }
      : joinStyles(firstStyles, v.plan.tokens.textStyles, seedTexts, textsOf(v.plan.ops))
  );
  const styleJoins = styleSets.map((set) => set.joins);
  const styleReads = styleSets.map((set) => new Map([...set.joins, ...set.shared]));
  const seedStyles = firstStyles.filter((seed) => usesAcross(seed, styleReads) >= MIN_USES);
  const styleAt = (seed: PlanTextStyle, mode: number) =>
    styleJoins[mode]?.get(seed) ?? styleSets[mode]?.shared.get(seed);

  const spacingSets: SpacingJoins[] = versions.map((v, i) =>
    i === 0
      ? { joins: new Map(seedSpacing.map((seed) => [seed, seed])), cssOnly: new Map() }
      : joinSpacing(seedSpacing, v.plan.tokens.spacing ?? [], v.cssValues)
  );
  const spacingPxAt = (seed: PlanSpacing, mode: number) =>
    spacingSets[mode]?.joins.get(seed)?.px ?? spacingSets[mode]?.cssOnly.get(seed);

  const modes = uniqueLabels(versions.map((v) => v.label));
  const colors = seedColors.map(
    (seed): PlanModeColor => ({
      key: mergedKey(seed.name, modes, (mode) => colorKeyAt(seed, mode)),
      name: seed.name,
      ...(seed.cssVar ? { cssVar: seed.cssVar } : {}),
      values: perMode(modes, (mode) => colorKeyAt(seed, mode), rgbaOf),
      from: fromKeys(seed, colorJoins),
    })
  );
  const textStyles = seedStyles.map((seed): PlanModeType => {
    const at = (mode: number) => styleAt(seed, mode);
    return {
      key: mergedKey(seed.name, modes, (mode) => at(mode)?.key),
      name: seed.name,
      fontName: seed.fontName,
      decoration: seed.decoration,
      textCase: seed.textCase,
      letterSpacing: perMode(modes, at, (t) => t.letterSpacing),
      fontSize: perMode(modes, at, (t) => t.fontSize),
      lineHeight: perMode(modes, at, (t) => t.lineHeight),
      from: fromKeys(seed, styleJoins),
    };
  });

  const spacing = seedSpacing.map(
    (seed): PlanModeSpacing => ({
      key: mergedKey(`spacing:${seed.cssVar}`, modes, (mode) =>
        spacingPxAt(seed, mode)?.toString()
      ),
      name: seed.name,
      cssVar: seed.cssVar,
      values: perMode(
        modes,
        (mode) => spacingPxAt(seed, mode),
        (px) => px
      ),
      from: spacingSets.map((set) => set.joins.get(seed)?.key ?? null),
    })
  );

  const renamesOf = (tokens: { key: string; from: (string | null)[] }[], version: number) =>
    new Map(tokens.flatMap((t) => (t.from[version] ? [[t.from[version], t.key] as const] : [])));

  const plans = versions.map(({ plan }, i) =>
    withRenames(plan, {
      colors: renamesOf(colors, i),
      styles: renamesOf(textStyles, i),
      spacing: renamesOf(spacing, i),
    })
  );

  const report = versions.flatMap((v, i) =>
    plainReport(
      modes[i] ?? v.label,
      strandedIn(v.plan.tokens.colors, colorJoins[i]),
      strandedIn(v.plan.tokens.textStyles, styleJoins[i]),
      (v.plan.tokens.spacing?.length ?? 0) - (spacingSets[i]?.joins.size ?? 0)
    )
  );

  return {
    tokens: {
      collection: versions[0]?.plan.tokens.collection ?? "",
      modes,
      colors,
      textStyles,
      ...(spacing.length > 0 ? { spacing } : {}),
    },
    plans,
    report,
  };
}
