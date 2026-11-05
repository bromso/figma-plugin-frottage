import type { Capture } from "@repo/capture-schema";
import { evalLength, parseCssColor } from "@repo/capture-schema/css-values";
import type { PlanLayers, PlanVarValue, StagedVariable } from "./plan";
import { collectionName, MAX_VALUE_LENGTH, resolveVars, SAFE_PROPERTY } from "./tokens";

/**
 * Builds the page's Primitives and Theme collections from its custom properties. A property a
 * theme context sets is a theme variable with one value per mode; the rest are primitives.
 */

export type Catalogue = {
  hostname: string;
  modes: string[];
  /** The mode the page was captured in: its computed values are that mode's. */
  activeMode: string;
  themeSource: PlanLayers["themeSource"];
  /** What the theme choice left out, in the words the report uses. */
  notes: string[];
  /** Every custom property that became a variable or collapsed into one. */
  byCssVar: Map<string, StagedVariable>;
  variables: StagedVariable[];
  /** The variable a token ref (`--name` or `--name*n`) names, or null. */
  resolveRef(ref: string): StagedVariable | null;
  /**
   * `radius/<name>` for a corner the site's `rounded-<name>` class set, made on first use with
   * that corner's px. Null at the cap, or with `differs` when the name already holds another value.
   */
  namedRadius(
    name: string,
    px: number
  ): { variable: StagedVariable | null; differs: boolean; name: string };
  /**
   * Variables left out past `MAX_VARIABLES`, theme or primitive, including spacing steps refused
   * later by `resolveRef`. It grows as those are asked for, so read it after binding.
   */
  dropped: number;
};

const LIGHT = "Light";
const DARK = "Dark";
const MAX_ALIAS_DEPTH = 16;
/** Variables per import, so that a page with thousands of custom properties can't flood a file. */
export const MAX_VARIABLES = 1000;
/** Custom properties read per import; the rest, in name order, are counted as dropped. */
export const MAX_PROPERTIES = 5000;
/** The largest `--spacing*n` or `--radius*n` step made on demand. */
const MAX_SPACING_STEP = 1000;
/** A corner this round or rounder, as `rounded-full`'s 3.40282e38px, is stored as this. */
export const MAX_RADIUS = 9999;
const RADIUS_SCOPES = ["CORNER_RADIUS"];
const RADIUS_DIFFERS = " has different values on this page.";

/** The report line for a radius name whose corners hold different values. */
export const radiusDiffers = (name: string) => `${name}${RADIUS_DIFFERS}`;
/** Whether a report line is one `radiusDiffers` made. */
export const isRadiusDiffers = (line: string) =>
  line.startsWith("radius/") && line.endsWith(RADIUS_DIFFERS);
const NO_DARK_NOTE = "This page has no dark theme, so only Light was made.";
const NOT_MADE_NOTE = "Not made: ";
/** Whether a report line is one of the theme notes `buildCatalogue` makes. */
export const isThemeNote = (line: string) =>
  line === NO_DARK_NOTE || (line.startsWith(NOT_MADE_NOTE) && line.endsWith("."));
/** Prefixes frameworks put on their own properties; the name is what follows. */
const FRAMEWORK_PREFIX = /^(bs|mantine|chakra|ant)-/i;
/** A value that is one `var()` and nothing else, with or without a fallback (one level deep). */
const SINGLE_VAR = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,(?:[^()]|\([^()]*\))*)?\)$/;
const REF = /^(--[A-Za-z0-9_-]+)(?:\*(-?(?:\d+\.?\d*|\.\d+)))?$/;
const FAMILY = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9 _-]+?))\s*(?:,|$)/;
const NAMED = new Map([
  ["white", "#ffffff"],
  ["black", "#000000"],
]);

export const COLOR_SCOPES = ["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"];
const SPACING_SCOPES = ["GAP", "WIDTH_HEIGHT"];

type Spec = {
  name: string;
  type: StagedVariable["type"];
  value: PlanVarValue;
  scopes: string[];
};

/** The entries of `from` named in `names`, as own properties. */
function pick(from: Record<string, string>, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    if (!Object.hasOwn(from, name)) continue;
    Object.defineProperty(out, name, {
      value: from[name],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Tailwind's `--tw-*` properties are internals and never become tokens. */
export const usable = (prop: string) => SAFE_PROPERTY.test(prop) && !/^--tw-/i.test(prop);

/** `--bs-primary` becomes `primary`. */
export const bareName = (prop: string) => prop.slice(2).replace(FRAMEWORK_PREFIX, "");

/** A variable's value with its alias followed, or null. */
export function followAlias(
  byKey: Map<string, StagedVariable>,
  value: PlanVarValue | undefined
): PlanVarValue | null {
  let at = value;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    if (at === undefined) return null;
    if (typeof at !== "object" || !("alias" in at)) return at;
    at = byKey.get(at.alias)?.values[0];
  }
  return null;
}

function colourOf(value: string, props: Record<string, string>): PlanVarValue | null {
  const text = resolveVars(value, props)?.trim().toLowerCase();
  if (!text) return null;
  const c = parseCssColor(NAMED.get(text) ?? text);
  return c ? { r: c.r, g: c.g, b: c.b, a: c.a } : null;
}

/**
 * A length in pixels, or null. `+ 0px` keeps only values in `px` or `rem`: `evalLength` alone also
 * returns plain numbers.
 */
function pxOf(value: string, props: Record<string, string>): number | null {
  const n = evalLength(value, props);
  if (n === null) return null;
  return n === 0 || evalLength(`calc((${value}) + 0px)`, props) !== null ? n : null;
}

/** A plain number, as a font weight is. */
const numberOf = (value: string, props: Record<string, string>) =>
  evalLength(`calc((${value}) + 0)`, props);

function familyOf(value: string): string | null {
  const m = FAMILY.exec(value);
  const family = (m?.[1] ?? m?.[2] ?? m?.[3])?.trim();
  return family ? family : null;
}

function lengthScopes(bare: string): string[] {
  const first = bare.split("-")[0] as string;
  if (/radius/i.test(bare)) return ["CORNER_RADIUS"];
  if (/^(spacing|space|gap)$/i.test(first)) return SPACING_SCOPES;
  if (first === "text") return ["FONT_SIZE"];
  if (first === "tracking") return ["LETTER_SPACING"];
  if (first === "leading") return ["LINE_HEIGHT"];
  return ["ALL_SCOPES"];
}

/**
 * What a property's value makes, named by the primitive rules, or by its bare name in the theme.
 * Null for a value that is neither color nor length (nor a weight or family where the name says so).
 */
function classify(
  prop: string,
  value: string,
  props: Record<string, string>,
  theme: boolean
): Spec | null {
  const bare = bareName(prop);
  // `--text-sm--line-height` belongs to `--text-sm`, not a variable of its own.
  if (bare === "" || bare.includes("--") || value.length > MAX_VALUE_LENGTH) return null;
  const dash = bare.indexOf("-");
  const first = dash === -1 ? bare : bare.slice(0, dash);
  const rest = dash === -1 ? "" : bare.slice(dash + 1);
  const grouped = (group: string, tail: string) =>
    theme ? bare : tail ? `${group}/${tail}` : group;

  const color = colourOf(value, props);
  if (color) {
    const name = theme || first !== "color" || !rest ? bare : `color/${rest}`;
    return { name, type: "COLOR", value: color, scopes: COLOR_SCOPES };
  }
  if (/^font-weight-./i.test(bare)) {
    const n = numberOf(value, props);
    if (n === null) return null;
    const name = grouped("font-weight", bare.slice("font-weight-".length));
    return { name, type: "FLOAT", value: n, scopes: ["FONT_WEIGHT"] };
  }
  const px = pxOf(value, props);
  if (px !== null) {
    return { name: grouped(first, rest), type: "FLOAT", value: px, scopes: lengthScopes(bare) };
  }
  if (first === "font" && rest) {
    const family = familyOf(value);
    if (!family) return null;
    return { name: grouped("font", rest), type: "STRING", value: family, scopes: ["FONT_FAMILY"] };
  }
  return null;
}

export function buildCatalogue(
  capture: Capture,
  themes?: { light: boolean; dark: boolean }
): Catalogue {
  // A hostile page can list tens of thousands: only the first in name order are read.
  // Capture lists them in name order; the order they come in is kept.
  let names = Object.keys(capture.tokens.cssCustomProperties);
  let unread = 0;
  if (names.length > MAX_PROPERTIES) {
    const sorted = [...names].sort();
    unread = sorted.slice(MAX_PROPERTIES).filter(usable).length;
    const kept = new Set(sorted.slice(0, MAX_PROPERTIES));
    names = names.filter((name) => kept.has(name));
  }
  const root = pick(capture.tokens.cssCustomProperties, names);
  const authored = pick(capture.tokens.authored ?? {}, Object.keys(root));
  const stylesheetThemes = capture.tokens.themes ?? [];
  // Authored text where there is one, so a context's change reaches what is built on it.
  const rootAuthored = { ...root, ...authored };

  // Contexts that share a mode share its values, the first one winning.
  const byMode = new Map<string, Record<string, string>>();
  const themeProps = new Set<string>();
  for (const t of stylesheetThemes) {
    for (const prop of Object.keys(t.properties)) if (usable(prop)) themeProps.add(prop);
    if (t.mode === LIGHT) continue;
    byMode.set(t.mode, { ...t.properties, ...byMode.get(t.mode) });
  }
  const allModes = [LIGHT, ...byMode.keys()];
  // In a theme the page was captured in, the root's values are that theme's: Light is what the
  // root's own rules set outside it.
  const captured = capture.tokens.activeTheme;
  const activeMode = captured !== undefined && byMode.has(captured) ? captured : LIGHT;
  const base = activeMode === LIGHT ? {} : (capture.tokens.base ?? {});
  /** Light's value of a property, as the root's own rules set it. */
  const lightText = (prop: string) => base[prop] ?? root[prop];
  /** The root's authored text outside any active context: what every other mode builds on. */
  const baseAuthored = { ...rootAuthored, ...base };
  // Light's own values: the page's computed ones when it was captured in Light.
  const lightProps = activeMode === LIGHT ? root : baseAuthored;
  const lightAuthored = (prop: string) => base[prop] ?? authored[prop];
  // Each mode's values over the root's authored text, built once, never over computed values: a
  // context's change must reach what root-only aliases build on it. The active mode is over the
  // page's own text; any other over the text outside the active context.
  const modeProps = new Map(
    [...byMode].map(([mode, context]) => [
      mode,
      mode === activeMode ? { ...rootAuthored, ...context } : { ...baseAuthored, ...context },
    ])
  );

  const variables: StagedVariable[] = [];
  const byKey = new Map<string, StagedVariable>();
  const byCssVar = new Map<string, StagedVariable>();

  const add = (
    collection: StagedVariable["collection"],
    spec: Spec,
    values: PlanVarValue[],
    from: string,
    cssVar?: string
  ) => {
    let name = spec.name;
    for (let n = 2; byKey.has(`${collection}:${name}`); n++) name = `${spec.name}-${n}`;
    const v: StagedVariable = {
      key: `${collection}:${name}`,
      name,
      collection,
      type: spec.type,
      values,
      description: `From the site: ${from}`,
      scopes: spec.scopes,
      ...(cssVar ? { cssVar } : {}),
    };
    variables.push(v);
    byKey.set(v.key, v);
    return v;
  };

  /** The theme property an authored `var()` chain ends at, or null. */
  const collapsesInto = (prop: string): string | null => {
    let at = prop;
    for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
      const next = SINGLE_VAR.exec(authored[at]?.trim() ?? "")?.[1];
      if (!next) break;
      if (themeProps.has(next)) return next;
      at = next;
    }
    // Tailwind's `--color-foreground: var(--foreground)` on a page with no theme: one primitive.
    // Other aliases, as `--radius-lg: var(--radius)`, name a step of a scale and stay their own.
    const primitive = at !== prop && /^--color-/i.test(prop) && at !== "--spacing";
    return primitive && usable(at) && Object.hasOwn(root, at) && !collapsesFurther(at) ? at : null;
  };
  /** Whether a property is itself an alias, so that a chain's end is not a primitive. */
  const collapsesFurther = (prop: string) => SINGLE_VAR.test(authored[prop]?.trim() ?? "");

  // Primitives.
  for (const prop of Object.keys(root)) {
    if (!usable(prop) || themeProps.has(prop) || collapsesInto(prop)) continue;
    // `--spacing` is the base its steps are made from, on demand.
    if (prop === "--spacing") continue;
    const spec = classify(prop, root[prop] as string, root, false);
    if (spec) byCssVar.set(prop, add("primitives", spec, [spec.value], prop, prop));
  }

  /** A value authored as `var()` of a primitive of the same type aliases it. */
  const aliasOf = (text: string | undefined, type: StagedVariable["type"]): PlanVarValue | null => {
    const named = SINGLE_VAR.exec(text?.trim() ?? "")?.[1];
    // A color alias that collapsed stands for the primitive it names.
    const target = named && !themeProps.has(named) ? (collapsesInto(named) ?? named) : undefined;
    const v = target && !themeProps.has(target) ? byCssVar.get(target) : undefined;
    return v && v.collection === "primitives" && v.type === type ? { alias: v.key } : null;
  };

  // Theme: Light is the root's value, each other mode its context's over the root.
  for (const prop of Object.keys(root)) {
    if (!themeProps.has(prop)) continue;
    const light = classify(prop, lightText(prop) as string, lightProps, true);
    if (!light) continue;
    const values: PlanVarValue[] = [aliasOf(lightAuthored(prop), light.type) ?? light.value];
    for (const [mode, context] of byMode) {
      const text = context[prop];
      if (text === undefined) {
        values.push(values[0] as PlanVarValue);
        continue;
      }
      const alias = aliasOf(text, light.type);
      const spec = alias ? null : classify(prop, text, modeProps.get(mode) ?? context, true);
      // A value of another type, or none, keeps Light's.
      values.push(alias ?? (spec?.type === light.type ? spec.value : (values[0] as PlanVarValue)));
    }
    byCssVar.set(prop, add("theme", light, values, prop, prop));
  }

  // The cap: theme variables first, then primitives in property order.
  let dropped = unread;
  const themeVars = variables.filter((v) => v.collection === "theme");
  const kept = new Set([
    ...themeVars.slice(0, MAX_VARIABLES),
    ...variables
      .filter((v) => v.collection === "primitives")
      .slice(0, Math.max(0, MAX_VARIABLES - themeVars.length)),
  ]);
  if (kept.size < variables.length) {
    const gone = new Map(variables.filter((v) => !kept.has(v)).map((v) => [v.key, v]));
    dropped += gone.size;
    for (const v of gone.values()) byKey.delete(v.key);
    for (const [prop, v] of byCssVar) if (gone.has(v.key)) byCssVar.delete(prop);
    // A theme value aliased to a dropped primitive holds the primitive's value instead.
    for (const v of kept) {
      v.values = v.values.map((value) => {
        const target = typeof value === "object" && "alias" in value ? gone.get(value.alias) : null;
        return target ? (target.values[0] as PlanVarValue) : value;
      });
    }
    variables.splice(0, variables.length, ...variables.filter((v) => kept.has(v)));
  }

  // Aliases of theme properties, as Tailwind's `--color-card: var(--card)`, collapse into them, and
  // color aliases into the primitive they name.
  for (const prop of Object.keys(root)) {
    if (!usable(prop) || themeProps.has(prop)) continue;
    const target = collapsesInto(prop);
    const v = target ? byCssVar.get(target) : undefined;
    if (v) byCssVar.set(prop, v);
  }

  // The themes chosen at capture: a mode not chosen is dropped from every theme variable, and
  // bindings keep naming the same variables. Neither ticked is no choice at all.
  const choice = themes ?? capture.themeChoice;
  const notes: string[] = [];
  let keptModes = allModes;
  if (choice && (choice.light || choice.dark)) {
    const hasDark = byMode.has(DARK);
    keptModes = allModes.filter((mode) =>
      mode === LIGHT
        ? choice.light || (choice.dark && !hasDark)
        : mode === DARK
          ? choice.dark
          : choice.light && choice.dark
    );
    if (choice.dark && !hasDark && keptModes.length === 1 && keptModes[0] === LIGHT)
      notes.push(NO_DARK_NOTE);
    const left = allModes.filter(
      (mode) => mode !== LIGHT && mode !== DARK && !keptModes.includes(mode)
    );
    if (left.length > 0) notes.push(`${NOT_MADE_NOTE}${left.join(", ")}.`);
    if (keptModes.length < allModes.length) {
      const at = keptModes.map((mode) => allModes.indexOf(mode));
      for (const v of variables) {
        if (v.collection !== "theme") continue;
        v.values = at.map((i) => v.values[i] ?? (v.values[0] as PlanVarValue));
      }
    }
  }
  const modes = keptModes;
  const openMode = keptModes.includes(activeMode) ? activeMode : (keptModes[0] as string);

  const baseOf = (prop: string) => (usable(prop) && root[prop] ? pxOf(root[prop], root) : null);
  const spacingBase = baseOf("--spacing");
  const radiusBase = baseOf("--radius");
  /** Steps refused at the cap, so each counts once. */
  const refused = new Set<string>();
  /** A primitive made on demand, or null, counted once, at the cap. */
  const made = (name: string, px: number, scopes: string[], from: string) => {
    const existing = byKey.get(`primitives:${name}`);
    if (existing) return existing;
    if (variables.length >= MAX_VARIABLES) {
      if (!refused.has(name)) {
        refused.add(name);
        catalogue.dropped++;
      }
      return null;
    }
    return add("primitives", { name, type: "FLOAT", value: px, scopes }, [px], from);
  };
  /** Figma names can't hold `.`. */
  const safe = (text: string) => text.replaceAll(".", "_");
  const stepOk = (base: number | null, n: number): base is number =>
    base !== null && Number.isFinite(n) && n >= 0 && n <= MAX_SPACING_STEP;
  /** `spacing/<n>`, made when a ref first asks for it. */
  const spacingStep = (n: number): StagedVariable | null =>
    stepOk(spacingBase, n)
      ? made(`spacing/${safe(String(n))}`, n * spacingBase, SPACING_SCOPES, "--spacing")
      : null;
  /** `radius/x<n>`, for `calc(var(--radius) * n)`. */
  const radiusStep = (n: number): StagedVariable | null =>
    stepOk(radiusBase, n)
      ? made(`radius/x${safe(String(n))}`, n * radiusBase, RADIUS_SCOPES, "--radius")
      : null;

  const catalogue: Catalogue = {
    dropped,
    hostname: collectionName(capture.source.url),
    modes,
    activeMode: openMode,
    notes,
    themeSource: stylesheetThemes.length > 0 ? "site" : "none",
    byCssVar,
    variables,
    resolveRef(ref) {
      const m = REF.exec(ref);
      if (!m) return null;
      const prop = m[1] as string;
      const n = m[2] === undefined ? null : Number.parseFloat(m[2]);
      if (prop === "--spacing") return spacingStep(n ?? 1);
      if (prop === "--radius" && n !== null && n !== 1) return radiusStep(n);
      if (n !== null && n !== 1) return null;
      return byCssVar.get(prop) ?? null;
    },
    namedRadius(name, px) {
      const value = name === "full" || px >= MAX_RADIUS ? MAX_RADIUS : px;
      const vname = `radius/${name === "DEFAULT" ? "default" : safe(name)}`;
      const existing = byKey.get(`primitives:${vname}`);
      if (existing) {
        const held = existing.values[0];
        const same = typeof held === "number" && Math.abs(held - value) <= 0.01 + 1e-9;
        return { variable: same ? existing : null, differs: !same, name: vname };
      }
      const from = name === "DEFAULT" ? ".rounded" : `.rounded-${name}`;
      return { variable: made(vname, value, RADIUS_SCOPES, from), differs: false, name: vname };
    },
  };
  return catalogue;
}
