import type { Capture } from "@repo/capture-schema";
import { isTokenValue } from "./styles";

type Themes = NonNullable<Capture["tokens"]["themes"]>;

// Mirror the schema's limits.
const MAX_THEMES = 8;
const MAX_THEME_PROPERTIES = 2000;
const DARK_MEDIA = "@media (prefers-color-scheme: dark)";

/**
 * Call `visit` for every style rule in every readable stylesheet, with the text of the `@media`
 * and `@supports` conditions it sits in. Cross-origin sheets are skipped silently.
 */
export function walkStyleRules(
  doc: Document,
  visit: (rule: CSSStyleRule, conditions: string[]) => void
): void {
  const RuleType = doc.defaultView?.CSSStyleRule;
  if (!RuleType) return;
  const walk = (rules: CSSRuleList, conditions: string[]) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof RuleType) visit(rule, conditions);
      const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
      if (!inner) continue;
      const condition = (rule as { conditionText?: string }).conditionText;
      walk(inner, condition === undefined ? conditions : [...conditions, condition]);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules, []);
    } catch {
      // cross-origin stylesheet
    }
  }
}

/** `:root` or `html`, then at most one class or attribute test. */
const ROOT_SELECTOR =
  /^(:root|html)?(?:\.([\w-]+)|\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\s*(?:[is])?\s*\])?$/;

const THEME_WORD = /dark|light|theme|mode|scheme|contrast|night/i;

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

/**
 * The stylesheet contexts that restyle the root: `.dark`, `[data-theme="dark"]` or a dark
 * `prefers-color-scheme` block. Contexts with the same mode name merge, later rules winning.
 */
export function readThemes(
  doc: Document,
  root: Element,
  isColor: (value: string) => boolean
): Capture["tokens"]["themes"] {
  const byMode = new Map<string, Themes[number]>();
  const add = (context: string, mode: string, rule: CSSStyleRule) => {
    let theme = byMode.get(mode);
    if (!theme) {
      if (byMode.size >= MAX_THEMES) return;
      theme = { context, mode, properties: {} };
      byMode.set(mode, theme);
    }
    for (const name of Array.from(rule.style)) {
      if (!name.startsWith("--") || name.startsWith("--tw-")) continue;
      if (
        !(name in theme.properties) &&
        Object.keys(theme.properties).length >= MAX_THEME_PROPERTIES
      ) {
        break;
      }
      const value = rule.style.getPropertyValue(name).trim();
      if (isTokenValue(value, isColor)) theme.properties[name] = value;
    }
  };
  try {
    walkStyleRules(doc, (rule, conditions) => {
      if (!Array.from(rule.style).some((name) => name.startsWith("--"))) return;
      const dark = conditions.some(isDarkMedia);
      for (const selector of splitSelectors(rule.selectorText)) {
        if (dark && /^(?::root|html)$/.test(selector)) {
          add(DARK_MEDIA, "Dark", rule);
          continue;
        }
        const mode = modeOfSelector(selector);
        if (mode === null) continue;
        let matches = false;
        try {
          matches = root.matches(selector);
        } catch {
          continue; // a selector `matches` can't take
        }
        if (dark) add(DARK_MEDIA, "Dark", rule);
        else if (!matches) add(selector, mode, rule);
      }
    });
  } catch {
    // themes are best effort
  }
  const themes = [...byMode.values()].filter((t) => Object.keys(t.properties).length > 0);
  return themes.length > 0 ? themes : undefined;
}
