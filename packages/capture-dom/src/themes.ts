import type { Capture } from "@repo/capture-schema";
import { nestSelectors, specificity, splitSelectors as splitNested } from "./hover";
import { isTokenValue } from "./styles";

type Themes = NonNullable<Capture["tokens"]["themes"]>;

// Mirror the schema's limits.
const MAX_THEMES = 8;
const MAX_THEME_PROPERTIES = 2000;
const MAX_MODE_LENGTH = 40;
const MAX_CONTEXT_LENGTH = 200;
const DARK_MEDIA = "@media (prefers-color-scheme: dark)";

/** A condition a rule sits in: `applies` is whether it holds in this page now. */
export type RuleCondition = { text: string; applies: boolean; media: boolean };

/**
 * Where a rule sits. `layer` orders cascade layers: one index per level, by first appearance
 * among its siblings, ending in `Infinity` for rules outside any deeper layer, so a plain
 * comparison puts later layers after earlier ones and unlayered rules last. `parents` are the
 * selectors of the rules a nested rule sits in, as `nestSelectors` takes them.
 */
export type RuleContext = { layer: number[]; parents: string[] | undefined };

/**
 * Call `visit` for every style rule in every readable stylesheet, with the conditions (`@media`,
 * `@supports`, `@container`) it sits in. Cross-origin sheets are skipped silently. The walk
 * stops when `visit` returns false. `onSkipped` is called once per sheet that could not be read.
 */
export function walkStyleRules(
  doc: Document,
  visit: (
    rule: CSSStyleRule,
    conditions: RuleCondition[],
    context: RuleContext
  ) => boolean | undefined,
  onSkipped?: () => void
): void {
  const win = doc.defaultView;
  const RuleType = win?.CSSStyleRule;
  if (!win || !RuleType) return;
  const LayerBlock = (win as { CSSLayerBlockRule?: typeof CSSLayerBlockRule }).CSSLayerBlockRule;
  const LayerStatement = (win as { CSSLayerStatementRule?: typeof CSSLayerStatementRule })
    .CSSLayerStatementRule;
  const holds = (rule: { type?: number }, text: string): boolean => {
    try {
      if (rule.type === 4) return win.matchMedia ? win.matchMedia(text).matches : true;
      if (rule.type === 12) return win.CSS ? win.CSS.supports(text) : true;
    } catch {
      // a condition the browser can't test
    }
    return true; // unknown kinds are assumed to hold
  };
  const MediaRule = (win as { CSSMediaRule?: typeof CSSMediaRule }).CSSMediaRule;
  const isMedia = (rule: { type?: number }): boolean =>
    MediaRule ? rule instanceof MediaRule : rule.type === 4;
  // Layer indices by parent path and name, in order of first appearance.
  const layers = new Map<string, Map<string, number>>();
  let anonymous = 0;
  const layerIndex = (parent: number[], name: string): number => {
    const key = parent.join(".");
    let names = layers.get(key);
    if (!names) {
      names = new Map();
      layers.set(key, names);
    }
    let index = names.get(name);
    if (index === undefined) {
      index = names.size;
      names.set(name, index);
    }
    return index;
  };
  const layerPath = (parent: number[], dotted: string): number[] => {
    const path = [...parent];
    const parts = dotted ? dotted.split(".").map((p) => p.trim()) : [`\0${anonymous++}`];
    for (const part of parts) path.push(layerIndex(path, part));
    return path;
  };
  let stopped = false;
  const walk = (
    rules: CSSRuleList,
    conditions: RuleCondition[],
    layer: number[],
    parents: string[] | undefined
  ) => {
    for (const rule of Array.from(rules)) {
      if (stopped) return;
      if (LayerStatement && rule instanceof LayerStatement) {
        for (const name of Array.from(rule.nameList)) layerPath(layer, name);
        continue;
      }
      let inLayer = layer;
      let inParents = parents;
      if (rule instanceof RuleType) {
        if (
          visit(rule, conditions, { layer: [...layer, Number.POSITIVE_INFINITY], parents }) ===
          false
        ) {
          stopped = true;
          return;
        }
        if (rule.cssRules?.length) {
          inParents = nestSelectors(splitNested(rule.selectorText), parents).selectors;
        }
      } else if (LayerBlock && rule instanceof LayerBlock) {
        inLayer = layerPath(layer, rule.name);
      }
      const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
      if (!inner) continue;
      const text = (rule as { conditionText?: string }).conditionText;
      walk(
        inner,
        text === undefined
          ? conditions
          : [...conditions, { text, applies: holds(rule, text), media: isMedia(rule) }],
        inLayer,
        inParents
      );
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    if (stopped) break;
    try {
      walk(sheet.cssRules, [], [], undefined);
    } catch {
      // cross-origin stylesheet
      onSkipped?.();
    }
  }
}

/** `:root` or `html`, then at most one class or attribute test. */
const ROOT_SELECTOR =
  /^(:root|html)?(?:\.([\w-]+)|\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\s*(?:[is])?\s*\])?$/;

// Whole words only: `high-contrast` and `color-scheme-dark` count, `highlight` and `lightbox` do not.
const THEME_WORD = /(?:^|[-_])(?:dark|light|theme|mode|scheme|contrast|night)(?:$|[-_])/i;

function sentenceCase(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The mode a selector names, or null when it is not a root selector with a class or attribute. */
function modeOfSelector(selector: string): string | null {
  const m = ROOT_SELECTOR.exec(selector);
  if (!m) return null;
  const [, prefix, cls, attr, dq, sq, bare] = m;
  const name = cls ?? dq ?? sq ?? bare ?? attr;
  if (!name) return null;
  // A bare `.card` could be anywhere on the page: only a name that reads as a theme counts.
  if (!prefix && !THEME_WORD.test(cls ?? attr ?? "") && !THEME_WORD.test(name)) return null;
  return sentenceCase(name);
}

/** Split a selector list on commas outside brackets and parentheses. */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

const isDarkMedia = (condition: string) =>
  /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i.test(condition.trim());

/** The stylesheet themes, the one the page was in, and the root's values outside them. */
export type ReadThemes = {
  themes?: Themes;
  /** The mode of the context the root was in when captured; absent when none applied. */
  activeTheme?: string;
  /** With a context other than Light active: what the root sets outside every context. */
  base?: Record<string, string>;
};

/** Where a declaration sits in the cascade, to say which of two wins. */
type Place = { layer: number[]; spec: number; order: number };

function wins(a: Place, b: Place): boolean {
  for (let i = 0; i < Math.max(a.layer.length, b.layer.length); i++) {
    const x = a.layer[i] ?? Number.POSITIVE_INFINITY;
    const y = b.layer[i] ?? Number.POSITIVE_INFINITY;
    if (x !== y) return x > y;
  }
  if (a.spec !== b.spec) return a.spec > b.spec;
  return a.order > b.order;
}

/**
 * The stylesheet contexts that restyle the root: `.dark`, `[data-theme="dark"]` or a dark
 * `prefers-color-scheme` block, whether the root is in one now or not. Contexts with the same mode
 * name merge, later rules winning. When the root is in one, its computed values are that theme's,
 * so the values the root's own rules set outside every context are read as well, for Light.
 */
export function readThemes(
  doc: Document,
  root: Element,
  isColor: (value: string) => boolean
): ReadThemes {
  const byMode = new Map<string, Themes[number]>();
  const active = new Set<string>();
  /** The winning base declaration of each property, by cascade place. */
  const base = new Map<string, Place & { value: string }>();
  let order = 0;
  const add = (context: string, mode: string, rule: CSSStyleRule, applies: boolean) => {
    // Names past the schema's lengths are skipped, and leave their place to the next.
    if (mode.length > MAX_MODE_LENGTH || context.length > MAX_CONTEXT_LENGTH) return;
    const known = byMode.get(mode);
    if (!known && byMode.size >= MAX_THEMES) return;
    const properties = known?.properties ?? {};
    let count = Object.keys(properties).length;
    for (const name of Array.from(rule.style)) {
      if (!name.startsWith("--") || name.startsWith("--tw-")) continue;
      if (!(name in properties) && count >= MAX_THEME_PROPERTIES) break;
      const value = rule.style.getPropertyValue(name).trim();
      if (!isTokenValue(value, isColor)) continue;
      if (!(name in properties)) count++;
      properties[name] = value;
    }
    // A context with nothing usable takes no place.
    if (count === 0) return;
    if (!known) byMode.set(mode, { context, mode, properties });
    if (applies) active.add(mode);
  };
  const addBase = (rule: CSSStyleRule, place: Place) => {
    for (const name of Array.from(rule.style)) {
      if (!name.startsWith("--") || name.startsWith("--tw-")) continue;
      const held = base.get(name);
      if (held && !wins(place, held)) continue;
      base.set(name, { ...place, value: rule.style.getPropertyValue(name).trim() });
    }
  };
  const matches = (selector: string): boolean | null => {
    try {
      return root.matches(selector);
    } catch {
      return null; // a selector `matches` can't take
    }
  };
  try {
    walkStyleRules(doc, (rule, conditions, { layer }) => {
      if (!Array.from(rule.style).some((name) => name.startsWith("--"))) return;
      order++;
      const holds = conditions.every((c) => c.applies);
      // Only a `prefers-color-scheme: dark` block may hold a theme; print, width and feature
      // conditions say nothing about a theme.
      const dark = conditions.length > 0 && conditions.every((c) => isDarkMedia(c.text));
      for (const selector of splitSelectors(rule.selectorText)) {
        if (dark && /^(?::root|html)$/.test(selector)) {
          add(DARK_MEDIA, "Dark", rule, holds);
          continue;
        }
        const mode = modeOfSelector(selector);
        const on = matches(selector);
        if (on === null) continue;
        if (mode === null) {
          // The root's own rules, outside any context: what Light is when a context applies.
          if (on && holds && !conditions.some((c) => isDarkMedia(c.text))) {
            addBase(rule, { layer, spec: specificity(selector), order });
          }
          continue;
        }
        if (dark) add(DARK_MEDIA, "Dark", rule, holds && on);
        else if (conditions.length === 0) add(selector, mode, rule, on);
      }
    });
  } catch {
    // themes are best effort
  }
  const themes = [...byMode.values()];
  const out: ReadThemes = {};
  if (themes.length === 0) return out;
  out.themes = themes;
  const on = themes.filter((t) => active.has(t.mode));
  const lead = on.find((t) => t.mode !== "Light") ?? on[0];
  if (!lead) return out;
  out.activeTheme = lead.mode;
  // Light's values for what an active context changes; Light itself needs none.
  const values: Record<string, string> = {};
  let count = 0;
  for (const theme of on) {
    if (theme.mode === "Light") continue;
    for (const name of Object.keys(theme.properties)) {
      const value = base.get(name)?.value;
      if (value === undefined || name in values || !isTokenValue(value, isColor)) continue;
      if (++count > MAX_THEME_PROPERTIES) break;
      values[name] = value;
    }
  }
  if (count > 0) out.base = values;
  return out;
}
