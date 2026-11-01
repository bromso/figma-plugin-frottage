import type { ElementNode } from "@repo/capture-schema";
import { parseComputedColor, type Rgba } from "./color";
import { flatChildren, isEditable, shadowRootOf } from "./flatten";
import { parseAuthoredBoxShadows, splitTop } from "./styles";
import type { CaptureEnv } from "./walk";

export type Hover = NonNullable<ElementNode["hover"]>;
type Root = Document | ShadowRoot;
type Win = Window & typeof globalThis;

export type HoverDeps = {
  win: Win;
  computed: (el: Element) => CSSStyleDeclaration;
  /** Counts only: how many sheets could not be read, and how many rules were read in part. */
  report: (code: "hover-unreadable" | "hover-partial", count: number) => void;
};

/** Matches `LIMITS` in spirit: a page with more hover rules than this is read up to here. */
const MAX_HOVER_RULES = 2000;
/** Rules looked at in total, hover or not, so a huge sheet cannot stall the capture. */
const MAX_RULES_SEEN = 200_000;
const MAX_ELEMENTS = 100_000;
const MAX_VAR_DEPTH = 8;
const MAX_VALUE_LENGTH = 2000;
const MAX_SHADOWS = 8;
const MAX_NESTED_COMBOS = 50;
const MAX_LONGHANDS = 500;

// ---------- Which elements may carry a hover

/**
 * Elements whose hover is worth storing: custom elements (a hyphen in the tag) whose tag appears
 * at least twice, which are the ones that become components, and everything below them in the
 * flat tree. Editable elements and what they hold are left out. Also returns the roots whose
 * rules can reach them: the roots they sit in, and the shadow roots they host.
 */
export function hoverCandidates(
  doc: Document,
  env: CaptureEnv
): { candidates: Set<Element>; roots: Set<Root> } {
  const byTag = new Map<string, Element[]>();
  const stack: Element[] = [doc.documentElement];
  let seen = 0;
  while (stack.length > 0 && seen++ < MAX_ELEMENTS) {
    const el = stack.pop() as Element;
    if (isEditable(el)) continue;
    if (el.localName.includes("-")) {
      const list = byTag.get(el.localName);
      if (list) list.push(el);
      else byTag.set(el.localName, [el]);
    }
    for (const child of flatChildren(el, env))
      if (child.nodeType === 1) stack.push(child as Element);
  }

  const candidates = new Set<Element>();
  for (const list of byTag.values()) {
    if (list.length < 2) continue;
    for (const start of list) {
      const down: Element[] = [start];
      while (down.length > 0 && candidates.size < MAX_ELEMENTS) {
        const el = down.pop() as Element;
        if (candidates.has(el) || isEditable(el)) continue;
        candidates.add(el);
        for (const child of flatChildren(el, env))
          if (child.nodeType === 1) down.push(child as Element);
      }
    }
  }

  const roots = new Set<Root>();
  for (const el of candidates) {
    const root = el.getRootNode();
    if (root.nodeType === 9 || root.nodeType === 11) roots.add(root as Root);
    const own = shadowRootOf(el, env);
    if (own) roots.add(own);
  }
  return { candidates, roots };
}

// ---------- Selectors

/** Split a selector list on its top-level commas. */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === "\\") current += ch + (text[++i] ?? "");
      else {
        current += ch;
        if (ch === quote) quote = "";
      }
      continue;
    }
    if (ch === "\\") {
      current += ch + (text[++i] ?? "");
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

type Analysis =
  | { kind: "none" }
  | { kind: "skip" }
  | { kind: "partial" }
  | { kind: "ok"; selector: string };

const PSEUDO_ELEMENT_NAMES = new Set(["before", "after", "first-line", "first-letter"]);

/**
 * Replace each `:hover` with `:is(*)`, "assume it is hovered", which is valid wherever `:hover`
 * was. `:not(:hover)` describes the resting element, so it is skipped. `:hover` under `:has()`
 * or beside a pseudo-element can't be answered from the elements that exist, so it is partial.
 */
export function analyse(selector: string): Analysis {
  let out = "";
  const stack: string[] = [];
  let hover = false;
  let negated = false;
  let has = false;
  let pseudoElement = false;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (ch === "\\") {
      out += ch + (selector[++i] ?? "");
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < selector.length && selector[j] !== ch) j += selector[j] === "\\" ? 2 : 1;
      out += selector.slice(i, j + 1);
      i = j;
    } else if (ch === "[") {
      let j = i + 1;
      while (j < selector.length && selector[j] !== "]") {
        if (selector[j] === '"' || selector[j] === "'") {
          const q = selector[j];
          j++;
          while (j < selector.length && selector[j] !== q) j += selector[j] === "\\" ? 2 : 1;
        }
        j++;
      }
      out += selector.slice(i, j + 1);
      i = j;
    } else if (ch === "(") {
      stack.push((/:([\w-]+)$/.exec(out)?.[1] ?? "").toLowerCase());
      out += ch;
    } else if (ch === ")") {
      stack.pop();
      out += ch;
    } else if (ch === ":") {
      if (selector[i + 1] === ":") {
        pseudoElement = true;
        out += "::";
        i++;
        continue;
      }
      const name = /^[\w-]+/.exec(selector.slice(i + 1))?.[0] ?? "";
      i += name.length;
      const lower = name.toLowerCase();
      if (lower === "hover") {
        hover = true;
        if (stack.includes("not")) negated = true;
        if (stack.includes("has")) has = true;
        out += ":is(*)";
      } else {
        if (PSEUDO_ELEMENT_NAMES.has(lower)) pseudoElement = true;
        out += `:${name}`;
      }
    } else {
      out += ch;
    }
  }
  if (!hover) return { kind: "none" };
  if (pseudoElement || has) return { kind: "partial" };
  if (negated) return { kind: "skip" };
  return { kind: "ok", selector: out };
}

/** The end of the parentheses that open at `open`, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

// ---------- Values

type Lookup = (name: string) => string | undefined;

/**
 * Substitute `var()` up to `MAX_VAR_DEPTH` times, with fallbacks. Null when a variable has no
 * value and no fallback, when it is still unresolved after that, or when the text grows too long.
 */
export function resolveVars(value: string, lookup: Lookup): string | null {
  let text = value;
  for (let round = 0; round <= MAX_VAR_DEPTH; round++) {
    if (!/var\(/i.test(text)) return text;
    if (round === MAX_VAR_DEPTH) return null;
    let out = "";
    let i = 0;
    while (i < text.length) {
      const at = text.slice(i).search(/var\(/i);
      if (at < 0) {
        out += text.slice(i);
        break;
      }
      const start = i + at;
      out += text.slice(i, start);
      const end = closeOf(text, start + 3);
      if (end < 0) return null;
      const inner = text.slice(start + 4, end);
      const comma = inner.indexOf(",");
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
      if (!name.startsWith("--")) return null;
      const got = lookup(name)?.trim();
      const use = got ? got : fallback;
      if (use === undefined || use === "") return null;
      out += use;
      i = end + 1;
      if (out.length > MAX_VALUE_LENGTH) return null;
    }
    text = out;
  }
  return null;
}

const UNPINNED = /^(?:currentcolor|inherit|initial|unset|revert|revert-layer)$/i;

/** A colour token as authored; null for `currentcolor` and the like, which depend on the element. */
function colourOf(token: string): Rgba | null {
  if (UNPINNED.test(token.trim())) return null;
  return parseComputedColor(token);
}

const LINES = new Set(["none", "underline", "overline", "line-through"]);

type Declared = {
  get: (name: string) => string;
  custom: Lookup;
  unsupported: boolean;
};

const IGNORED =
  /^(?:transition|cursor$|will-change$|pointer-events$|user-select$|-webkit-tap-highlight-color$)/;

/** Whether the rule declares anything outside the supported set (custom properties and motion aside). */
function hasUnsupported(style: CSSStyleDeclaration, get: (n: string) => string): boolean {
  const shorthand = {
    background: get("background") !== "",
    border: get("border") !== "",
    borderColor: get("border-color") !== "",
    decoration: get("text-decoration") !== "",
  };
  const count = Math.min(style.length, MAX_LONGHANDS);
  for (let i = 0; i < count; i++) {
    const name = style.item(i);
    if (name.startsWith("--") || IGNORED.test(name)) continue;
    if (name === "background-color" || name === "color" || name === "opacity") continue;
    if (name === "box-shadow" || name === "text-decoration-line") continue;
    if (name.startsWith("background-") && shorthand.background) continue;
    if (name.startsWith("border") && shorthand.border) continue;
    if (/^border-(?:top|right|bottom|left)-color$/.test(name) && shorthand.borderColor) continue;
    if (name.startsWith("text-decoration-") && shorthand.decoration) continue;
    return true;
  }
  return false;
}

function declared(rule: CSSStyleRule): Declared {
  const style = rule.style;
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    get,
    custom: (name) => get(name) || undefined,
    unsupported: hasUnsupported(style, get),
  };
}

/** A colour out of a shorthand's tokens. `rest` is true when other tokens (width, image, style...) came with it. */
function colourFromShorthand(tokens: string[]): { color: Rgba | null; rest: boolean } {
  let color: Rgba | null = null;
  let rest = false;
  for (const token of tokens) {
    const parsed = /^url\(|gradient\(|^image-set\(/i.test(token) ? null : colourOf(token);
    if (parsed) color = parsed;
    else rest = true;
  }
  return { color, rest };
}

/**
 * Write what the rule says into `into` for one element. Returns whether anything in the rule was
 * left out: an unreadable value, or a property the format has no place for.
 */
function apply(into: Hover, d: Declared, el: Element, deps: HoverDeps): boolean {
  let partial = d.unsupported;
  let computed: CSSStyleDeclaration | undefined;
  const lookup: Lookup = (name) => {
    const own = d.custom(name);
    if (own !== undefined) return own;
    computed ??= deps.computed(el);
    return computed.getPropertyValue(name);
  };
  /** The declared text of the first property that has one, with `var()` resolved. */
  const read = (...names: string[]): { text: string; name: string } | null => {
    for (const name of names) {
      const raw = d.get(name);
      if (raw === "") continue;
      const text = resolveVars(raw, lookup);
      if (text === null) {
        partial = true;
        return null;
      }
      return { text: text.trim(), name };
    }
    return null;
  };

  const bg = read("background-color", "background");
  if (bg) {
    const { color, rest } = colourFromShorthand(
      bg.name === "background" ? splitTop(bg.text, " ") : [bg.text]
    );
    if (color) into.backgroundColor = color;
    if (!color || rest) partial = true;
  }

  const fg = read("color");
  if (fg) {
    const color = colourOf(fg.text);
    if (color) into.color = color;
    else partial = true;
  }

  const border = read("border-color", "border");
  if (border) {
    const tokens = splitTop(border.text, " ");
    if (border.name === "border-color") {
      const colours = tokens.map(colourOf);
      const first = colours[0];
      const same = colours.every((c) => c && first && JSON.stringify(c) === JSON.stringify(first));
      if (first && same) into.borderColor = first;
      else partial = true;
    } else {
      const { color } = colourFromShorthand(tokens);
      if (color) into.borderColor = color;
      partial = true; // width and style come with a border shorthand
    }
  }

  const opacity = read("opacity");
  if (opacity) {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(opacity.text);
    const n = m ? Number(m[1]) / (m[2] ? 100 : 1) : Number.NaN;
    if (Number.isFinite(n)) into.opacity = Math.min(1, Math.max(0, n));
    else partial = true;
  }

  const shadow = read("box-shadow");
  if (shadow) {
    const shadows = parseAuthoredBoxShadows(shadow.text);
    if (shadows) {
      into.boxShadows = shadows.slice(0, MAX_SHADOWS);
      if (shadows.length > MAX_SHADOWS) partial = true;
    } else partial = true;
  }

  const line = read("text-decoration-line", "text-decoration");
  if (line) {
    const tokens = line.text.toLowerCase().split(/\s+/).filter(Boolean);
    const lines = tokens.filter((t) => LINES.has(t));
    if (lines.length > 0) into.decoration = lines.join(" ");
    if (lines.length === 0 || (line.name === "text-decoration" && lines.length < tokens.length)) {
      partial = true;
    }
  }
  return partial;
}

// ---------- Reading the sheets

/**
 * Read the `:hover` rules in `roots` and return, for each candidate element they reach, what
 * hovering changes. Nothing is written to the page and no pointer moves: the rules are read
 * from the stylesheets and matched against the candidates.
 *
 * Specificity is not computed. Where two matching rules set the same property, the later rule in
 * document order wins (adopted sheets after the root's own), as if all had equal weight. Script
 * driven hovers can't be seen.
 */
export function readHover(
  roots: Iterable<Root>,
  candidates: Set<Element>,
  deps: HoverDeps
): Map<Element, Hover> {
  const result = new Map<Element, Hover>();
  if (candidates.size === 0) return result;
  const { win } = deps;
  let unreadable = 0;
  let partial = 0;
  let hoverRules = 0;
  let seen = 0;
  let stopped = false;

  const store = (el: Element, from: Hover) => {
    result.set(el, { ...result.get(el), ...from });
  };

  const matching = (root: Root, selector: string): Element[] => {
    const found = root.querySelectorAll(selector);
    const hits: Element[] = [];
    for (const el of Array.from(found)) if (candidates.has(el)) hits.push(el);
    return hits;
  };

  /** The candidates one `:hover` selector reaches inside `root`. Throws on an invalid selector. */
  const targets = (root: Root, selector: string): Element[] => {
    const hostRule = /^:host\(/i.exec(selector);
    if (!hostRule) return matching(root, selector);
    if (root.nodeType !== 11) return [];
    const host = (root as ShadowRoot).host;
    const end = closeOf(selector, 5);
    if (end < 0) throw new Error("unbalanced");
    const inner = selector.slice(6, end);
    const rest = selector.slice(end + 1);
    if (!host.matches(inner)) return [];
    if (rest.trim() === "") return candidates.has(host) ? [host] : [];
    // `:host(:hover) .title`: anything in this root is a descendant of its host.
    if (/^\s/.test(rest) && !/^\s*[>+~]/.test(rest)) return matching(root, rest.trim());
    throw new Error("unsupported host combinator");
  };

  const handleSelectors = (root: Root, selectors: string[], rule: CSSStyleRule) => {
    let decl: Declared | undefined;
    let ruleIsPartial = false;
    let counted = false;
    for (const sel of selectors) {
      const a = analyse(sel.replace(/^:host:hover/i, ":host(:hover)"));
      if (a.kind === "none" || a.kind === "skip") continue;
      if (!counted) {
        counted = true;
        if (++hoverRules > MAX_HOVER_RULES) {
          stopped = true;
          partial++;
          return;
        }
      }
      if (a.kind === "partial") {
        ruleIsPartial = true;
        continue;
      }
      let hits: Element[];
      try {
        hits = targets(root, a.selector);
      } catch {
        ruleIsPartial = true;
        continue;
      }
      if (hits.length === 0) continue;
      decl ??= declared(rule);
      for (const el of hits) {
        const into: Hover = {};
        if (apply(into, decl, el, deps)) ruleIsPartial = true;
        if (Object.keys(into).length > 0) store(el, into);
      }
    }
    if (ruleIsPartial) partial++;
  };

  /** The rule's selectors with a parent's folded in, as CSS nesting means them. */
  const nest = (own: string[], parents: string[] | undefined): string[] => {
    if (!parents) return own;
    const out: string[] = [];
    for (const child of own) {
      for (const parent of parents) {
        if (out.length >= MAX_NESTED_COMBOS) return out;
        out.push(
          child.includes("&") ? child.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${child}`
        );
      }
    }
    return out;
  };

  const readRules = (rules: CSSRuleList, root: Root, parents: string[] | undefined) => {
    for (const rule of Array.from(rules)) {
      if (stopped || seen++ > MAX_RULES_SEEN) {
        stopped = true;
        return;
      }
      if (rule instanceof win.CSSStyleRule) {
        const selectors = nest(splitSelectors(rule.selectorText), parents);
        if (selectors.some((s) => /:hover/i.test(s))) handleSelectors(root, selectors, rule);
        if (rule.cssRules && rule.cssRules.length > 0) readRules(rule.cssRules, root, selectors);
      } else if (rule instanceof win.CSSMediaRule) {
        if (win.matchMedia(rule.media.mediaText).matches) readRules(rule.cssRules, root, parents);
      } else if (rule instanceof win.CSSSupportsRule) {
        if (win.CSS.supports(rule.conditionText)) readRules(rule.cssRules, root, parents);
      } else if (rule instanceof win.CSSImportRule) {
        if (rule.styleSheet) readSheet(rule.styleSheet, root);
      } else if (win.CSSLayerBlockRule && rule instanceof win.CSSLayerBlockRule) {
        readRules(rule.cssRules, root, parents);
      }
    }
  };

  const readSheet = (sheet: CSSStyleSheet, root: Root) => {
    if (sheet.disabled) return;
    const media = sheet.media?.mediaText;
    if (media && !win.matchMedia(media).matches) return;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadable++; // cross-origin
      return;
    }
    readRules(rules, root, undefined);
  };

  for (const root of roots) {
    const sheets = [...Array.from(root.styleSheets), ...(root.adoptedStyleSheets ?? [])];
    for (const sheet of sheets) {
      if (stopped) break;
      readSheet(sheet, root);
    }
  }

  if (unreadable > 0) deps.report("hover-unreadable", unreadable);
  if (partial > 0) deps.report("hover-partial", partial);
  return result;
}
