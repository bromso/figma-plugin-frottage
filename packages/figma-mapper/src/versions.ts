import type {
  LayerPlan,
  ModeValue,
  PlanColor,
  PlanModeColor,
  PlanModeType,
  PlanOp,
  PlanTextStyle,
  PlanVersionTokens,
} from "./plan";
import { cssColorOf } from "./tokens";

/**
 * Turns several versions' tokens into one set with a mode per version. The first version seeds
 * the set. A later version's token joins a seed by the same custom property, then for text styles
 * by the same role, then for colours by the same value. One that can't join stays a plain value
 * in its own frame.
 */

export type TokenVersion = {
  label: string;
  plan: LayerPlan;
  /** The capture's `tokens.cssCustomProperties`. */
  cssValues: Record<string, string>;
};

/** Per version, the token standing in for each seed. */
type Joins<T> = Map<T, T>[];

/** Per version, what each single-version key becomes. */
type Renames = { colors: Map<string, string>; styles: Map<string, string> };

function uniqueLabels(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = label.replace(/ \(\d+\)$/, "");
    let unique = label;
    for (let n = 2; taken.has(unique); n++) unique = `${base} (${n})`;
    taken.add(unique);
    return unique;
  });
}

function joinColors(
  seeds: PlanColor[],
  tokens: PlanColor[],
  cssValues: Record<string, string>
): Map<PlanColor, PlanColor> {
  const joins = new Map<PlanColor, PlanColor>();
  const free = new Map(tokens.map((t) => [t.key, t]));
  const join = (seed: PlanColor, token: PlanColor | undefined) => {
    if (!token || joins.has(seed) || !free.has(token.key)) return;
    joins.set(seed, token);
    free.delete(token.key);
  };

  const byCssVar = new Map(tokens.map((t) => [t.cssVar, t]));
  for (const seed of seeds) if (seed.cssVar) join(seed, byCssVar.get(seed.cssVar));
  // A token shows one custom property, and the seed's may be another that holds the same value.
  for (const seed of seeds) {
    const value = seed.cssVar ? cssColorOf(seed.cssVar, cssValues) : null;
    if (value) join(seed, free.get(value));
  }
  for (const seed of seeds) join(seed, free.get(seed.key));
  return joins;
}

/** What has to be equal for two text styles to share a role: only size and line height vary. */
const fixedLook = (s: PlanTextStyle) =>
  JSON.stringify([s.fontName, s.letterSpacing, s.decoration, s.textCase]);

function joinStyles(
  seeds: PlanTextStyle[],
  tokens: PlanTextStyle[]
): Map<PlanTextStyle, PlanTextStyle> {
  const joins = new Map<PlanTextStyle, PlanTextStyle>();
  const byRole = new Map(tokens.map((t) => [t.name, t]));
  for (const seed of seeds) {
    const token = byRole.get(seed.name);
    if (token && fixedLook(token) === fixedLook(seed)) joins.set(seed, token);
  }
  return joins;
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

function perMode<T, V>(seed: T, joins: Joins<T>, value: (token: T) => V): ModeValue<V>[] {
  return joins.flatMap((version, mode) => {
    const token = version.get(seed);
    return token ? [{ mode, value: value(token) }] : [];
  });
}

const fromKeys = <T extends { key: string }>(seed: T, joins: Joins<T>) =>
  joins.map((version) => version.get(seed)?.key ?? null);

/** A deep copy with every token key renamed, or removed if it has no new name, wherever it sits. */
function rekeyed(value: unknown, renames: Renames): unknown {
  if (Array.isArray(value)) return value.map((item) => rekeyed(item, renames));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
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

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function plainReport(mode: string, colors: number, styles: number): string[] {
  const parts = [
    ...(colors > 0 ? [counted(colors, "colour")] : []),
    ...(styles > 0 ? [counted(styles, "text style")] : []),
  ];
  if (parts.length === 0) return [];
  const verb = colors + styles === 1 ? "stayed a plain value" : "stayed plain values";
  return [`${mode}: ${parts.join(" and ")} ${verb}.`];
}

export function mergeVersions(versions: TokenVersion[]): {
  tokens: PlanVersionTokens;
  plans: LayerPlan[];
  report: string[];
} {
  const seedColors = versions[0]?.plan.tokens.colors ?? [];
  const seedStyles = versions[0]?.plan.tokens.textStyles ?? [];
  const colorJoins: Joins<PlanColor> = versions.map((v, i) =>
    i === 0
      ? new Map(seedColors.map((seed) => [seed, seed]))
      : joinColors(seedColors, v.plan.tokens.colors, v.cssValues)
  );
  const styleJoins: Joins<PlanTextStyle> = versions.map((v, i) =>
    i === 0
      ? new Map(seedStyles.map((seed) => [seed, seed]))
      : joinStyles(seedStyles, v.plan.tokens.textStyles)
  );

  const modes = uniqueLabels(versions.map((v) => v.label));
  const colors = seedColors.map(
    (seed): PlanModeColor => ({
      key: mergedKey(seed.name, modes, (mode) => colorJoins[mode]?.get(seed)?.key),
      name: seed.name,
      ...(seed.cssVar ? { cssVar: seed.cssVar } : {}),
      values: perMode(seed, colorJoins, (t) => t.rgba),
      from: fromKeys(seed, colorJoins),
    })
  );
  const textStyles = seedStyles.map(
    (seed): PlanModeType => ({
      key: mergedKey(seed.name, modes, (mode) => styleJoins[mode]?.get(seed)?.key),
      name: seed.name,
      fontName: seed.fontName,
      letterSpacing: seed.letterSpacing,
      decoration: seed.decoration,
      textCase: seed.textCase,
      fontSize: perMode(seed, styleJoins, (t) => t.fontSize),
      lineHeight: perMode(seed, styleJoins, (t) => t.lineHeight),
      from: fromKeys(seed, styleJoins),
    })
  );

  const renamesOf = (tokens: { key: string; from: (string | null)[] }[], version: number) =>
    new Map(tokens.flatMap((t) => (t.from[version] ? [[t.from[version], t.key] as const] : [])));

  const plans = versions.map(({ plan }, i): LayerPlan => {
    const renames = { colors: renamesOf(colors, i), styles: renamesOf(textStyles, i) };
    return {
      ...plan,
      ops: rekeyed(plan.ops, renames) as PlanOp[],
      // The set's tokens replace these, whose keys no op holds any more.
      tokens: { textStyles: [], colors: [], collection: plan.tokens.collection },
    };
  });

  const report = versions.flatMap((v, i) =>
    plainReport(
      modes[i] ?? v.label,
      v.plan.tokens.colors.length - (colorJoins[i]?.size ?? 0),
      v.plan.tokens.textStyles.length - (styleJoins[i]?.size ?? 0)
    )
  );

  return {
    tokens: {
      collection: versions[0]?.plan.tokens.collection ?? "",
      modes,
      colors,
      textStyles,
    },
    plans,
    report,
  };
}
