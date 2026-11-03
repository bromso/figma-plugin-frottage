import type { Capture } from "@repo/capture-schema";
import { evalLength, parseCssColor } from "@repo/capture-schema/css-values";
import type { PlanLayers, PlanVariable, PlanVarValue } from "./plan";
import { collectionName, MAX_VALUE_LENGTH, resolveVars, SAFE_PROPERTY } from "./tokens";

/**
 * Builds the page's Primitives and Theme collections from its custom properties. A property a
 * theme context sets is a theme variable with one value per mode; the rest are primitives.
 */

export type Catalogue = {
  hostname: string;
  modes: string[];
  themeSource: PlanLayers["themeSource"];
  /** Every custom property that became a variable or collapsed into one. */
  byCssVar: Map<string, PlanVariable>;
  variables: PlanVariable[];
  /** The variable a token ref (`--name` or `--name*n`) names, or null. */
  resolveRef(ref: string): PlanVariable | null;
  /**
   * Variables left out past `MAX_VARIABLES`, theme or primitive, including spacing steps refused
   * later by `resolveRef`. It grows as those are asked for, so read it after binding.
   */
  dropped: number;
};

const LIGHT = "Light";
const MAX_ALIAS_DEPTH = 16;
/** Variables per import, so that a page with thousands of custom properties can't flood a file. */
export const MAX_VARIABLES = 1000;
/** The largest `--spacing*n` step made on demand. */
const MAX_SPACING_STEP = 1000;
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
  type: PlanVariable["type"];
  value: PlanVarValue;
  scopes: string[];
};

/** Tailwind's `--tw-*` properties are internals and never become tokens. */
export const usable = (prop: string) => SAFE_PROPERTY.test(prop) && !/^--tw-/i.test(prop);

/** `--bs-primary` becomes `primary`. */
export const bareName = (prop: string) => prop.slice(2).replace(FRAMEWORK_PREFIX, "");

/** A variable's value with its alias followed, or null. */
export function followAlias(
  byKey: Map<string, PlanVariable>,
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
 * Null for a value that is neither colour nor length (nor a weight or family where the name says so).
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

  const colour = colourOf(value, props);
  if (colour) {
    const name = theme || first !== "color" || !rest ? bare : `color/${rest}`;
    return { name, type: "COLOR", value: colour, scopes: COLOR_SCOPES };
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

export function buildCatalogue(capture: Capture): Catalogue {
  const root = capture.tokens.cssCustomProperties;
  const authored = capture.tokens.authored ?? {};
  const themes = capture.tokens.themes ?? [];
  // Authored text where there is one, so a context's change reaches what is built on it.
  const rootAuthored = { ...root, ...authored };

  // Contexts that share a mode share its values, the first one winning.
  const byMode = new Map<string, Record<string, string>>();
  const themeProps = new Set<string>();
  for (const t of themes) {
    for (const prop of Object.keys(t.properties)) if (usable(prop)) themeProps.add(prop);
    if (t.mode === LIGHT) continue;
    byMode.set(t.mode, { ...t.properties, ...byMode.get(t.mode) });
  }
  const modes = [LIGHT, ...byMode.keys()];

  const variables: PlanVariable[] = [];
  const byKey = new Map<string, PlanVariable>();
  const byCssVar = new Map<string, PlanVariable>();

  const add = (
    collection: PlanVariable["collection"],
    spec: Spec,
    values: PlanVarValue[],
    from: string,
    cssVar?: string
  ) => {
    let name = spec.name;
    for (let n = 2; byKey.has(`${collection}:${name}`); n++) name = `${spec.name}-${n}`;
    const v: PlanVariable = {
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
      if (!next) return null;
      if (themeProps.has(next)) return next;
      at = next;
    }
    return null;
  };

  // Primitives.
  for (const prop of Object.keys(root)) {
    if (!usable(prop) || themeProps.has(prop) || collapsesInto(prop)) continue;
    // `--spacing` is the base its steps are made from, on demand.
    if (prop === "--spacing") continue;
    const spec = classify(prop, root[prop] as string, root, false);
    if (spec) byCssVar.set(prop, add("primitives", spec, [spec.value], prop, prop));
  }

  /** A value authored as `var()` of a primitive of the same type aliases it. */
  const aliasOf = (text: string | undefined, type: PlanVariable["type"]): PlanVarValue | null => {
    const target = SINGLE_VAR.exec(text?.trim() ?? "")?.[1];
    const v = target && !themeProps.has(target) ? byCssVar.get(target) : undefined;
    return v && v.collection === "primitives" && v.type === type ? { alias: v.key } : null;
  };

  // Theme: Light is the root's value, each other mode its context's over the root.
  for (const prop of Object.keys(root)) {
    if (!themeProps.has(prop)) continue;
    const light = classify(prop, root[prop] as string, root, true);
    if (!light) continue;
    const values: PlanVarValue[] = [aliasOf(authored[prop], light.type) ?? light.value];
    for (const context of byMode.values()) {
      const text = context[prop];
      if (text === undefined) {
        values.push(values[0] as PlanVarValue);
        continue;
      }
      const alias = aliasOf(text, light.type);
      const spec = alias ? null : classify(prop, text, { ...rootAuthored, ...context }, true);
      // A value of another type, or none, keeps Light's.
      values.push(alias ?? (spec?.type === light.type ? spec.value : (values[0] as PlanVarValue)));
    }
    byCssVar.set(prop, add("theme", light, values, prop, prop));
  }

  // The cap: theme variables first, then primitives in property order.
  let dropped = 0;
  const themeVars = variables.filter((v) => v.collection === "theme");
  const kept = new Set([
    ...themeVars.slice(0, MAX_VARIABLES),
    ...variables
      .filter((v) => v.collection === "primitives")
      .slice(0, Math.max(0, MAX_VARIABLES - themeVars.length)),
  ]);
  if (kept.size < variables.length) {
    const gone = new Map(variables.filter((v) => !kept.has(v)).map((v) => [v.key, v]));
    dropped = gone.size;
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

  // Aliases of theme properties, as Tailwind's `--color-card: var(--card)`, collapse into them.
  for (const prop of Object.keys(root)) {
    if (!usable(prop) || themeProps.has(prop)) continue;
    const target = collapsesInto(prop);
    const v = target ? byCssVar.get(target) : undefined;
    if (v) byCssVar.set(prop, v);
  }

  const spacingBase =
    usable("--spacing") && root["--spacing"] ? pxOf(root["--spacing"], root) : null;
  /** Steps refused at the cap, so each counts once. */
  const refused = new Set<string>();
  /** `spacing/<n>`, made when a ref first asks for it. Figma names can't hold `.`. */
  const spacingStep = (n: number): PlanVariable | null => {
    if (spacingBase === null || !Number.isFinite(n) || n < 0 || n > MAX_SPACING_STEP) return null;
    const name = `spacing/${String(n).replace(".", "_")}`;
    const existing = byKey.get(`primitives:${name}`);
    if (existing) return existing;
    if (variables.length >= MAX_VARIABLES) {
      if (!refused.has(name)) {
        refused.add(name);
        catalogue.dropped++;
      }
      return null;
    }
    const px = n * spacingBase;
    return add(
      "primitives",
      { name, type: "FLOAT", value: px, scopes: SPACING_SCOPES },
      [px],
      "--spacing"
    );
  };

  const catalogue: Catalogue = {
    dropped,
    hostname: collectionName(capture.source.url),
    modes,
    themeSource: themes.length > 0 ? "site" : "none",
    byCssVar,
    variables,
    resolveRef(ref) {
      const m = REF.exec(ref);
      if (!m) return null;
      const prop = m[1] as string;
      const n = m[2] === undefined ? null : Number.parseFloat(m[2]);
      if (prop === "--spacing") return spacingStep(n ?? 1);
      if (n !== null && n !== 1) return null;
      return byCssVar.get(prop) ?? null;
    },
  };
  return catalogue;
}
