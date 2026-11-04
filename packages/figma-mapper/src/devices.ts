import type { Capture } from "@repo/capture-schema";
import { breakpointName } from "@repo/capture-schema/css-values";
import { isRadiusDiffers, MAX_VARIABLES } from "./catalogue";
import { COLLECTION_NAMES, COLLECTION_ORDER, orderVariables } from "./layering";
import type {
  LayerPlan,
  PlanCollection,
  PlanCollectionKind,
  PlanLayers,
  PlanOp,
  PlanTextStyle,
  PlanVariable,
  PlanVarValue,
  SpacingKeys,
} from "./plan";
import { joinStyles, type StyleJoins, textsOf } from "./versions";

/**
 * Merges the layered plans of one page captured at several widths into one set of collections:
 * a Device mode per device capture, a Breakpoint mode per range of the page's CSS that a capture
 * falls in, and a single Theme that every device's layers bind to.
 *
 * Each Breakpoint mode reads the widest capture in its range, device or extra. A Theme token whose
 * source differs between modes aliases a Breakpoint variable of its name, which aliases a raw value
 * per mode named `<mode>/<name>`; one that is the same everywhere aliases its source as before. Text
 * styles join across captures (shared text, then role) and bind a size, line height or tracking
 * that differs by breakpoint through `type/<style>/size`, `…/line-height` and `…/tracking`.
 */

export type DeviceEntry = { capture: Capture; plan: LayerPlan };

/** A device capture's frame: its Device mode, and its Breakpoint mode when the page has any. */
export type DeviceFrame = { index: number; device: string; breakpoint: string | null };

export type DeviceMerge = {
  layers: PlanLayers;
  /** Per entry, its plan with every key pointing into `layers` and its text styles joined. */
  plans: LayerPlan[];
  /** Device entries only; extras make no frame. */
  frames: DeviceFrame[];
  report: string[];
};

/** A Breakpoint mode: `[min, max)` in pixels, and the entry its values come from. */
type Range = { name: string; min: number; max: number | null; owner: number };

const BASE_MODE = "Base";
const THEME_MODE = "Default";
const BASE_RANGE = "base";
/** Device width, device height, breakpoint min and max width. */
const FIXED_VARIABLES = 4;
const LENGTH_SCOPES = ["WIDTH_HEIGHT"];

const isAlias = (v: PlanVarValue): v is { alias: string } =>
  typeof v === "object" && v !== null && "alias" in v;

/**
 * The width a capture was laid out at, which media queries matched: the recorded `version.width`.
 * An older capture has none. One with no device data then goes by its label, the width the user
 * chose, and anything else by `viewport.w`, the client width, which a scrollbar can make narrower.
 */
export function captureWidth(capture: Capture): number {
  const recorded = capture.version?.width;
  if (recorded !== undefined && recorded > 0) return recorded;
  const label = capture.version?.device ? undefined : capture.version?.label;
  const n = label !== undefined && /^\d+(\.\d+)?$/.test(label.trim()) ? Number(label) : Number.NaN;
  return n > 0 ? n : Math.round(capture.source.viewport.w);
}

/** The width a device goes by, for its `device/width` and a name when it has none. */
export const deviceWidth = captureWidth;

const widthOf = (entry: DeviceEntry) => captureWidth(entry.capture);

/** A device capture, or an older one with neither a device nor a breakpoint. */
const isDevice = (entry: DeviceEntry) =>
  entry.capture.version?.device !== undefined || entry.capture.version?.breakpoint === undefined;

/** `name`, or `name-2` and on: the first not in `taken`, recorded as taken. */
function free(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name}-${n}`;
  taken.add(out);
  return out;
}

/** `shadow/1` free, or the next free number (`shadow/2`); a name with no number goes as `free`. */
function numbered(name: string, taken: Set<string>): string {
  const m = /^(.*\/)(\d+)$/.exec(name);
  if (!m) return free(name, taken);
  let n = Number(m[2]);
  while (taken.has(`${m[1]}${n}`)) n++;
  const out = `${m[1]}${n}`;
  taken.add(out);
  return out;
}

/** Unique labels, a repeat getting ` (2)` and on. */
function uniqueLabels(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    let out = label;
    for (let n = 2; taken.has(out); n++) out = `${label} (${n})`;
    taken.add(out);
    return out;
  });
}

function emptyLayers(hostname: string): PlanLayers {
  return {
    hostname,
    modes: ["Light"],
    themeSource: "none",
    collections: [],
    variables: [],
    effectStyles: [],
    gradientStyles: [],
    notes: { twins: [], inferred: [], droppedPrimitives: 0 },
  };
}

/**
 * The page's Breakpoint modes, each read from the widest entry in it. Ranges no entry falls in are
 * left out and named in `missing`. A page that records no boundaries uses its device widths, and
 * with one device there is one range and no Breakpoint mode.
 */
function rangesOf(entries: DeviceEntry[], order: number[]) {
  const recorded = [
    ...new Set(entries.flatMap((e) => e.capture.breakpoints?.widths ?? []).filter((w) => w > 0)),
  ].sort((a, b) => a - b);
  // A page that records none still differs by device: each device width but the narrowest is one.
  const deviceWidths = [...new Set(entries.filter(isDevice).map(widthOf))].sort((a, b) => a - b);
  const fromDevices = recorded.length === 0 && deviceWidths.length > 1;
  const boundaries = fromDevices ? deviceWidths.slice(1) : recorded;
  const all: Omit<Range, "owner">[] =
    boundaries.length === 0
      ? [{ name: BASE_RANGE, min: 0, max: null }]
      : [
          { name: BASE_RANGE, min: 0, max: boundaries[0] ?? null },
          ...boundaries.map((min, i) => ({
            name: breakpointName(min),
            min,
            max: boundaries[i + 1] ?? null,
          })),
        ];
  const inRange = (w: number, range: { min: number; max: number | null }) =>
    w >= range.min && (range.max === null || w < range.max);
  /** An extra goes in the range it was captured for, when the page has it; else by its width. */
  const placed = (i: number) => {
    const e = entries[i] as DeviceEntry;
    const named = isDevice(e) ? undefined : e.capture.version?.breakpoint;
    const at = named === undefined ? -1 : all.findIndex((r) => r.name === named);
    return at >= 0 ? at : all.findIndex((r) => inRange(widthOf(e), r));
  };
  const ranges: Range[] = [];
  const missing: string[] = [];
  for (const [at, range] of all.entries()) {
    // `order` is widest first, so the first entry inside is the widest.
    const owner = order.find((i) => placed(i) === at);
    if (owner === undefined) missing.push(range.name);
    else ranges.push({ ...range, owner });
  }
  // Ranges show smallest to largest. Under a file's mode limit Figma keeps them in this priority:
  // the frames' ranges first, the widest device's first, so a limit leaves out the extras' ranges
  // before any frame's.
  const rank = (r: Range) => {
    const at = all.findIndex((a) => a.name === r.name);
    const framed = order.findIndex((i) => isDevice(entries[i] as DeviceEntry) && placed(i) === at);
    // A range only extras are in: after every frame's, widest first.
    return framed >= 0 ? framed : order.length + all.length - at;
  };
  const priority = [...ranges].sort((a, b) => rank(a) - rank(b)).map((r) => r.name);
  /** The Breakpoint mode an entry is in. */
  const rangeOf = (i: number) => {
    const name = all[placed(i)]?.name;
    return ranges.find((r) => r.name === name);
  };
  return { ranges, priority, missing, breakpoints: boundaries.length > 0, fromDevices, rangeOf };
}

type Rekey = (key: string) => string | undefined;

function rekeyList<T extends string | undefined>(keys: T[], rekey: Rekey) {
  return keys.map((key) => (key === undefined ? key : rekey(key)));
}

function rekeySpacing(keys: SpacingKeys, rekey: Rekey): SpacingKeys | undefined {
  const out: SpacingKeys = {};
  for (const field of ["itemSpacing", "counterSpacing", "rowGap", "columnGap"] as const) {
    const key = keys[field];
    const next = key === undefined ? undefined : rekey(key);
    if (next !== undefined) out[field] = next;
  }
  if (keys.padding) {
    const padding = rekeyList(keys.padding, rekey);
    if (padding.some((key) => key !== undefined)) out.padding = padding as SpacingKeys["padding"];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A deep copy of `ops` with variable and text style keys renamed, or removed with no new name. */
function rekeyed(value: unknown, vars: Rekey, styles: Rekey): unknown {
  if (Array.isArray(value)) return value.map((item) => rekeyed(item, vars, styles));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
    if (field === "spacingKeys") {
      const next = rekeySpacing(inner as SpacingKeys, vars);
      if (next) out[field] = next;
    } else if (field === "radiusKeys") {
      const next = rekeyList(inner as (string | undefined)[], vars);
      if (next.some((key) => key !== undefined)) out[field] = next;
    } else if (field === "colorKey" || field === "styleKey") {
      const next = (field === "colorKey" ? vars : styles)(inner as string);
      if (next !== undefined) out[field] = next;
    } else out[field] = rekeyed(inner, vars, styles);
  }
  return out;
}

const TYPE_FIELDS = [
  { field: "fontSize", suffix: "size", scope: "FONT_SIZE" },
  { field: "lineHeight", suffix: "line-height", scope: "LINE_HEIGHT" },
  { field: "letterSpacing", suffix: "tracking", scope: "LETTER_SPACING" },
] as const;

export type MergeOptions = {
  /** Breakpoints whose extra capture the user left out: not reported as having none. */
  leftOut?: string[];
};

export function mergeDevices(entries: DeviceEntry[], options: MergeOptions = {}): DeviceMerge {
  const report: string[] = [];
  // Widest first; the widest entry is the primary one, and wins a tie.
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => {
      const wa = widthOf(entries[a] as DeviceEntry);
      const wb = widthOf(entries[b] as DeviceEntry);
      return wb - wa || a - b;
    });
  const primary = order[0] ?? 0;
  const layersAt = (i: number): PlanLayers =>
    entries[i]?.plan.tokens.layers ?? emptyLayers(entries[i]?.plan.tokens.collection ?? "");
  const top = layersAt(primary);
  // Color Mode holds the themes the first device chose: the primary's modes, narrowed to its.
  const firstLayers = layersAt(0);
  const colorModes = top.modes.some((m) => firstLayers.modes.includes(m))
    ? top.modes.filter((m) => firstLayers.modes.includes(m))
    : top.modes;
  const openMode = [firstLayers.activeMode, top.activeMode].find(
    (m): m is string => m !== undefined && colorModes.includes(m)
  );

  const { ranges, priority, missing, breakpoints, fromDevices, rangeOf } = rangesOf(entries, order);
  if (fromDevices) {
    report.push("This page records no breakpoints, so each device width was used as one.");
  }
  const unreadable = Math.max(0, ...entries.map((e) => e.capture.breakpoints?.unreadable ?? 0));
  if (unreadable > 0) {
    const sheets = unreadable === 1 ? "1 stylesheet" : `${unreadable} stylesheets`;
    report.push(`Breakpoints from ${sheets} couldn't be read.`);
  }
  for (const name of missing) {
    if (!options.leftOut?.includes(name)) report.push(`No capture for the ${name} breakpoint.`);
  }
  const modeNames = ranges.map((r) => r.name);
  /** The widest range, whose value a token that can't switch by breakpoint keeps. */
  const widest = ranges.reduce((best, r, at) => (r.min > (ranges[best]?.min ?? -1) ? at : best), 0);

  const deviceAt = entries.flatMap((e, i) => (isDevice(e) ? [i] : []));
  const deviceNames = uniqueLabels(
    deviceAt.map((i) => {
      const e = entries[i] as DeviceEntry;
      return e.capture.version?.device?.name ?? String(deviceWidth(e.capture));
    })
  );

  // ---------- Raw and Color Mode variables: one per name and value across entries.

  const merged = new Map<string, PlanVariable>();
  const taken = new Map<PlanCollectionKind, Set<string>>(
    COLLECTION_ORDER.map((kind) => [kind, new Set()])
  );
  const namesIn = (kind: PlanCollectionKind) => taken.get(kind) as Set<string>;
  /** `<collection>|<name in its entry>|<values>` to the merged key holding it. */
  const byContent = new Map<string, string>();
  /** Per entry, its raw and Color Mode keys to merged ones. */
  const remaps = entries.map(() => new Map<string, string>());
  /** Variables made for a clash or left behind by a split: gone if nothing aliases them. */
  const prunable = new Set<string>();
  let dropped = 0;
  const reserved = breakpoints ? FIXED_VARIABLES : FIXED_VARIABLES / 2;
  const tokens: PlanVariable[] = [];
  const bpVariables: PlanVariable[] = [];
  const room = (more = 1) =>
    merged.size + tokens.length + bpVariables.length + reserved + more <= MAX_VARIABLES;

  for (const i of order) {
    const layers = layersAt(i);
    const own = new Map(layers.variables.map((v) => [v.key, v]));
    /** A value with no merged home holds its target's value, as layering does. */
    const carried = (value: PlanVarValue, depth = 0): PlanVarValue => {
      if (!isAlias(value)) return value;
      const to = remaps[i]?.get(value.alias);
      if (to) return { alias: to };
      const target = own.get(value.alias)?.values[0];
      return target === undefined || depth > 16 ? value : carried(target, depth + 1);
    };
    for (const v of layers.variables) {
      if (v.collection === "theme") continue;
      // Color Mode's modes follow the primary's, by name.
      const aligned =
        v.collection === "colorMode"
          ? colorModes.map((mode) => v.values[layers.modes.indexOf(mode)] ?? v.values[0])
          : v.values;
      const values = aligned.map((value) => carried(value as PlanVarValue));
      const content = `${v.collection}|${v.name}|${JSON.stringify(values)}`;
      const known = byContent.get(content);
      if (known) {
        remaps[i]?.set(v.key, known);
        continue;
      }
      if (!room()) {
        dropped++;
        continue;
      }
      const names = namesIn(v.collection);
      const clash = names.has(v.name);
      const name = free(v.name, names);
      const key = `${v.collection}:${name}`;
      if (clash) prunable.add(key);
      merged.set(key, { ...v, key, name, values });
      byContent.set(content, key);
      remaps[i]?.set(v.key, key);
    }
  }

  /** A merged variable's values with every alias followed, to compare two of them. */
  const resolved = (key: string, depth = 0): unknown =>
    merged
      .get(key)
      ?.values.map((value) =>
        isAlias(value) && depth < 16 ? resolved(value.alias, depth + 1) : value
      );
  const rawValue = (key: string): PlanVarValue | undefined => {
    let value = merged.get(key)?.values[0];
    for (let depth = 0; value !== undefined && isAlias(value) && depth < 16; depth++) {
      value = merged.get(value.alias)?.values[0];
    }
    return value;
  };

  // ---------- Theme tokens, split by breakpoint where their sources differ.

  const themeNames = namesIn("theme");
  const bpNames = namesIn("breakpoint");

  /**
   * One raw variable per mode, `<mode>/<name>` in its collection, and a Breakpoint variable `name`
   * aliasing them. Returns the Breakpoint variable's key.
   */
  const split = (
    name: string,
    model: Pick<PlanVariable, "type" | "scopes" | "cssVar">,
    perMode: { kind: PlanCollectionKind; value: PlanVarValue; description: string }[]
  ): string => {
    const aliases = perMode.map(({ kind, value, description }, m) => {
      const rawName = free(`${modeNames[m]}/${name}`, namesIn(kind));
      const key = `${kind}:${rawName}`;
      merged.set(key, {
        key,
        name: rawName,
        collection: kind,
        type: model.type,
        values: [value],
        description,
        scopes: model.scopes,
        ...(model.cssVar ? { cssVar: model.cssVar } : {}),
      });
      return { alias: key };
    });
    const bpName = free(name, bpNames);
    const key = `breakpoint:${bpName}`;
    bpVariables.push({
      key,
      name: bpName,
      collection: "breakpoint",
      type: model.type,
      values: aliases,
      description: "Differs by breakpoint",
      scopes: model.scopes,
      ...(model.cssVar ? { cssVar: model.cssVar } : {}),
    });
    return key;
  };
  const splitRoom = () => room(ranges.length + 2);

  /** Each theme token's name, with the entries that have it, the primary's first. */
  const themeOf = order.map((i) => {
    const map = new Map<string, PlanVariable>();
    for (const v of layersAt(i).variables) if (v.collection === "theme") map.set(v.name, v);
    return map;
  });
  const entryAt = new Map(order.map((i, at) => [i, at]));
  const themeIn = (i: number) => themeOf[entryAt.get(i) as number] as Map<string, PlanVariable>;
  const sourceIn = (i: number, name: string): string | undefined => {
    const value = themeIn(i).get(name)?.values[0];
    return value !== undefined && isAlias(value) ? remaps[i]?.get(value.alias) : undefined;
  };
  const allNames = [...new Set(themeOf.flatMap((map) => [...map.keys()]))];
  for (const name of allNames) {
    const fallback = order.map((i) => sourceIn(i, name)).find((key) => key !== undefined);
    if (fallback === undefined) {
      dropped++;
      continue;
    }
    const model = order.map((i) => themeIn(i).get(name)).find(Boolean) as PlanVariable;
    const sources = ranges.map((r) => sourceIn(r.owner, name) ?? fallback);
    const topKey = sources[widest] ?? fallback;
    const differs = new Set(sources.map((key) => JSON.stringify(resolved(key)))).size > 1;
    let alias = topKey;
    let source = COLLECTION_NAMES[(merged.get(topKey) as PlanVariable).collection];
    if (differs) {
      const top = modeNames[widest];
      const kinds = sources.map((key) => (merged.get(key) as PlanVariable).collection);
      if (kinds.includes("colorMode")) {
        report.push(`${name} differs by breakpoint in Color Mode; kept the ${top} value.`);
      } else if (!splitRoom()) {
        dropped += ranges.length + 1;
        report.push(`${name} differs by breakpoint; kept the ${top} value, at the variable limit.`);
      } else {
        alias = split(
          name,
          model,
          sources.map((key, m) => {
            const v = merged.get(key) as PlanVariable;
            prunable.add(key);
            return {
              kind: v.collection,
              value: rawValue(key) as PlanVarValue,
              description: `${v.description} (${modeNames[m]})`,
            };
          })
        );
        source = COLLECTION_NAMES.breakpoint;
      }
    }
    if (!room()) {
      dropped++;
      continue;
    }
    themeNames.add(name);
    tokens.push({
      ...model,
      key: `theme:${name}`,
      name,
      values: [{ alias }],
      description: `Final theme token; source: ${source}`,
    });
  }
  const tokenKeys = new Set(tokens.map((t) => t.key));
  const themeKey: Rekey = (key) =>
    key.startsWith("paint:") || tokenKeys.has(key) ? key : undefined;

  // ---------- Text styles: the primary's, joined by the others; their own ones after.

  const primaryPlan = entries[primary]?.plan;
  const seeds = (primaryPlan?.tokens.textStyles ?? []).map((s) => structuredClone(s));
  const styles: PlanTextStyle[] = [...seeds];
  const styleKeys = new Set(styles.map((s) => s.key));
  const styleNames = new Set(styles.map((s) => s.name));
  const seedTexts = textsOf(primaryPlan?.ops ?? []);
  const originals = primaryPlan?.tokens.textStyles ?? [];
  const styleMaps = entries.map(() => new Map<string, string>());
  const joinsAt = new Map<number, StyleJoins>();
  for (const i of order) {
    const plan = (entries[i] as DeviceEntry).plan;
    if (i === primary) {
      for (const s of seeds) styleMaps[i]?.set(s.key, s.key);
      continue;
    }
    const sets = joinStyles(originals, plan.tokens.textStyles, seedTexts, textsOf(plan.ops));
    joinsAt.set(i, sets);
    for (const [seed, token] of sets.joins) styleMaps[i]?.set(token.key, seed.key);
    for (const style of plan.tokens.textStyles) {
      if (styleMaps[i]?.has(style.key)) continue;
      if (!styleKeys.has(style.key)) {
        const copy = structuredClone(style);
        copy.name = free(style.name, styleNames);
        styles.push(copy);
        styleKeys.add(copy.key);
      }
      styleMaps[i]?.set(style.key, style.key);
    }
  }
  for (const style of styles) {
    if (!style.bind) continue;
    for (const field of Object.keys(style.bind) as (keyof NonNullable<PlanTextStyle["bind"]>)[]) {
      const next = themeKey(style.bind[field] as string);
      if (next === undefined) delete style.bind[field];
    }
    if (Object.keys(style.bind).length === 0) delete style.bind;
  }

  /** Whether a Theme token already switches by breakpoint. */
  const switches = (key: string | undefined) => {
    const value = tokens.find((t) => t.key === key)?.values[0];
    return value !== undefined && isAlias(value) && value.alias.startsWith("breakpoint:");
  };
  if (ranges.length > 1) {
    seeds.forEach((seed, at) => {
      const original = originals[at] as PlanTextStyle;
      const inMode = ranges.map((r) => {
        if (r.owner === primary) return original;
        const sets = joinsAt.get(r.owner);
        return sets?.joins.get(original) ?? sets?.shared.get(original);
      });
      for (const { field, suffix, scope } of TYPE_FIELDS) {
        const values = inMode.map((s) => (s ?? original)[field]);
        if (values.some((v) => v === null) || new Set(values).size < 2) continue;
        if (switches(seed.bind?.[field])) continue;
        if (!room(ranges.length + 2)) {
          dropped += ranges.length + 2;
          report.push(`${seed.name} ${suffix} differs by breakpoint; kept, at the variable limit.`);
          continue;
        }
        const name = free(`type/${seed.name}/${suffix}`, themeNames);
        const bp = split(
          name,
          { type: "FLOAT", scopes: [scope] },
          values.map((value, m) => ({
            kind: "typography",
            value: value as number,
            description: `Text style ${seed.name}, ${suffix} (${modeNames[m]})`,
          }))
        );
        const key = `theme:${name}`;
        tokens.push({
          key,
          name,
          collection: "theme",
          type: "FLOAT",
          values: [{ alias: bp }],
          description: `Final theme token; source: ${COLLECTION_NAMES.breakpoint}`,
          scopes: [scope],
        });
        tokenKeys.add(key);
        seed.bind = { ...seed.bind, [field]: key };
      }
    });
  }

  // ---------- A device sharing a range with a wider capture shows that capture's values.

  const nameOf = (i: number) => {
    const at = deviceAt.indexOf(i);
    return at >= 0
      ? (deviceNames[at] as string)
      : `the ${widthOf(entries[i] as DeviceEntry)} capture`;
  };
  const resolvedIn = (i: number, name: string) => {
    const key = sourceIn(i, name);
    return key === undefined ? undefined : JSON.stringify(resolved(key));
  };
  const looksOf = (i: number) => {
    const sets = joinsAt.get(i);
    return originals.map((s) => {
      const style = i === primary ? s : (sets?.joins.get(s) ?? sets?.shared.get(s));
      return style ? JSON.stringify([style.fontSize, style.lineHeight, style.letterSpacing]) : null;
    });
  };
  if (breakpoints) {
    for (const i of deviceAt) {
      const range = rangeOf(i);
      if (!range || range.owner === i) continue;
      const owner = range.owner;
      const tokenDiffers = [...themeIn(i).keys()].some((name) => {
        const mine = resolvedIn(i, name);
        const theirs = resolvedIn(owner, name);
        return mine !== undefined && theirs !== undefined && mine !== theirs;
      });
      const ownerLooks = looksOf(owner);
      const styleDiffers = looksOf(i).some(
        (look, at) => look !== null && ownerLooks[at] != null && look !== ownerLooks[at]
      );
      if (tokenDiffers || styleDiffers) {
        report.push(
          `${nameOf(i)} shares the ${range.name} breakpoint with ${nameOf(owner)} and uses its values.`
        );
      }
    }
  }

  // ---------- Prune what a split or clash left with nothing aliasing it.

  for (let removed = true; removed; ) {
    removed = false;
    const aliased = new Set<string>();
    for (const v of [...merged.values(), ...bpVariables, ...tokens]) {
      for (const value of v.values) if (isAlias(value)) aliased.add(value.alias);
    }
    for (const key of prunable) {
      if (aliased.has(key) || !merged.has(key)) continue;
      merged.delete(key);
      removed = true;
    }
  }

  // ---------- Device and Breakpoint, and the layers.

  const fixed = (
    kind: "device" | "breakpoint",
    name: string,
    values: number[],
    description: string
  ): PlanVariable => ({
    key: `${kind}:${name}`,
    name,
    collection: kind,
    type: "FLOAT",
    values,
    description,
    scopes: LENGTH_SCOPES,
  });
  const deviceVars =
    deviceAt.length === 0
      ? []
      : [
          fixed(
            "device",
            "device/width",
            deviceAt.map((i) => deviceWidth((entries[i] as DeviceEntry).capture)),
            "The width the device was captured at"
          ),
          fixed(
            "device",
            "device/height",
            deviceAt.map((i) => entries[i]?.capture.version?.device?.height ?? 0),
            "The device's nominal height; reference data only"
          ),
        ];
  const breakpointVars = breakpoints
    ? [
        fixed(
          "breakpoint",
          "breakpoint/min-width",
          ranges.map((r) => r.min),
          "Where the range starts"
        ),
        fixed(
          "breakpoint",
          "breakpoint/max-width",
          // Up to the next mode's start: a range with no capture leaves no gap.
          ranges.map((r) => {
            const next = Math.min(...ranges.map((o) => o.min).filter((min) => min > r.min));
            return Number.isFinite(next) ? next - 1 : 0;
          }),
          "Where the range ends; 0 means it has no end"
        ),
        ...bpVariables,
      ]
    : [];

  if (dropped > 0) {
    report.push(
      `${dropped} variable${dropped === 1 ? "" : "s"} past the 1,000-variable limit ${
        dropped === 1 ? "was" : "were"
      } left out`
    );
  }

  const variables = orderVariables(
    [...merged.values(), ...deviceVars, ...breakpointVars, ...tokens],
    modeNames
  );
  const modesOf = (kind: PlanCollectionKind): string[] => {
    switch (kind) {
      case "colorMode":
        return [...colorModes];
      case "theme":
        return [THEME_MODE];
      case "device":
        return deviceNames;
      case "breakpoint":
        return modeNames;
      default:
        return [BASE_MODE];
    }
  };
  const collections: PlanCollection[] = COLLECTION_ORDER.filter(
    (kind) => kind === "theme" || variables.some((v) => v.collection === kind)
  ).map((kind) => ({
    kind,
    name: COLLECTION_NAMES[kind],
    modes: modesOf(kind),
    ...(kind === "breakpoint" ? { priority } : {}),
  }));

  // Effect and gradient styles, and paint-style colors: one per key, the primary's first.
  const effectStyles: PlanLayers["effectStyles"] = [];
  const gradientStyles: PlanLayers["gradientStyles"] = [];
  const styleColors = new Map<string, NonNullable<PlanLayers["styleColors"]>[number]>();
  const inferred = new Set<string>();
  const effectNames = new Set<string>();
  const gradientNames = new Set<string>();
  for (const i of order) {
    const layers = layersAt(i);
    for (const style of layers.effectStyles) {
      if (effectStyles.some((s) => s.key === style.key)) continue;
      effectStyles.push({
        ...style,
        name: numbered(style.name, effectNames),
        colorKeys: style.colorKeys.map((key) => (key === null ? null : (themeKey(key) ?? null))),
      });
    }
    for (const style of layers.gradientStyles) {
      if (gradientStyles.some((s) => s.key === style.key)) continue;
      gradientStyles.push({
        ...style,
        name: numbered(style.name, gradientNames),
        stopKeys: style.stopKeys.map((key) => (key === null ? null : (themeKey(key) ?? null))),
      });
    }
    for (const color of layers.styleColors ?? []) {
      const known = styleColors.get(color.key);
      styleColors.set(color.key, known ? { ...known, uses: known.uses + color.uses } : color);
    }
    for (const name of layers.notes.inferred) inferred.add(name);
  }
  const twins = top.notes.twins.flatMap(([a, b]): [string, string][] => {
    const x = remaps[primary]?.get(a);
    const y = remaps[primary]?.get(b);
    return x && y && merged.has(x) && merged.has(y) ? [[x, y]] : [];
  });

  const layers: PlanLayers = {
    hostname: top.hostname,
    modes: [...colorModes],
    ...(openMode ? { activeMode: openMode } : {}),
    themeSource: top.themeSource,
    collections,
    variables,
    effectStyles,
    gradientStyles,
    ...(styleColors.size > 0 ? { styleColors: [...styleColors.values()] } : {}),
    notes: {
      twins,
      inferred: [...inferred],
      droppedPrimitives: top.notes.droppedPrimitives + dropped,
    },
  };

  // A radius name that differs is said once for the set, widest capture first, not per frame.
  const differs = new Set(
    order.flatMap((i) => entries[i]?.plan.report.warnings.filter(isRadiusDiffers) ?? [])
  );
  report.push(...differs);

  const plans = entries.map(({ plan }, i): LayerPlan => {
    const styleKey: Rekey = (key) => styleMaps[i]?.get(key);
    return {
      ...plan,
      report: {
        ...plan.report,
        warnings: plan.report.warnings.filter((line) => !isRadiusDiffers(line)),
      },
      ops: rekeyed(plan.ops, themeKey, styleKey) as PlanOp[],
      tokens: { ...plan.tokens, textStyles: styles, layers },
    };
  });

  const frames = deviceAt.map((i, at): DeviceFrame => {
    const range = rangeOf(i);
    return {
      index: i,
      device: deviceNames[at] as string,
      breakpoint: breakpoints ? (range?.name ?? null) : null,
    };
  });

  return { layers, plans, frames, report };
}
