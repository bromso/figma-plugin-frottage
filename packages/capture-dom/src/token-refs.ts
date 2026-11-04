import type { TokenRefs } from "@repo/capture-schema";
import { evalLength, parseCssColor } from "@repo/capture-schema/css-values";
import { analyse, nestSelectors, resolveVars, specificity, splitSelectors } from "./hover";
import { type RuleContext, walkStyleRules } from "./themes";

export type { TokenRefs };

type Win = Window & typeof globalThis;

export type RefDeps = {
  /** Milliseconds, `performance.now()`. */
  now: () => number;
  /** Called once, when the budget runs out and later nodes get no refs. */
  report?: (code: "token-refs-partial") => void;
};

/** Reading stops after this long, so a heavy page cannot stall the capture. */
const TIME_BUDGET_MS = 1000;
/** Rules looked at in total, indexed or matched against an element. */
const MAX_RULES_SEEN = 200_000;
const MAX_REF_LENGTH = 80;
const MAX_ANCESTORS = 256;
const REF = /^--[A-Za-z0-9_-]+(?:\*-?(?:\d+\.?\d*|\.\d+))?$/;

// ---------- Which declarations count for each property

type Kind = "color" | "length" | "family" | "weight";
type Slot = { names: string[]; inherits: boolean; kind: Kind };

// Longhand first: within one rule it is usually the later, more specific declaration.
const SIDES = {
  top: ["padding-top", "padding-block-start", "padding-block", "padding"],
  right: ["padding-right", "padding-inline-end", "padding-inline", "padding"],
  bottom: ["padding-bottom", "padding-block-end", "padding-block", "padding"],
  left: ["padding-left", "padding-inline-start", "padding-inline", "padding"],
};
const SLOTS = {
  background: { names: ["background-color", "background"], inherits: false, kind: "color" },
  color: { names: ["color"], inherits: true, kind: "color" },
  border: { names: ["border-color", "border"], inherits: false, kind: "color" },
  radius: { names: ["border-radius"], inherits: false, kind: "length" },
  paddingTop: { names: SIDES.top, inherits: false, kind: "length" },
  paddingRight: { names: SIDES.right, inherits: false, kind: "length" },
  paddingBottom: { names: SIDES.bottom, inherits: false, kind: "length" },
  paddingLeft: { names: SIDES.left, inherits: false, kind: "length" },
  rowGap: { names: ["row-gap", "gap"], inherits: false, kind: "length" },
  columnGap: { names: ["column-gap", "gap"], inherits: false, kind: "length" },
  fontSize: { names: ["font-size", "font"], inherits: true, kind: "length" },
  lineHeight: { names: ["line-height", "font"], inherits: true, kind: "length" },
  letterSpacing: { names: ["letter-spacing"], inherits: true, kind: "length" },
  fontFamily: { names: ["font-family", "font"], inherits: true, kind: "family" },
  fontWeight: { names: ["font-weight", "font"], inherits: true, kind: "weight" },
} satisfies Record<string, Slot>;
type SlotName = keyof typeof SLOTS;

/** The computed properties a slot's ref must agree with. */
const COMPUTED: Record<SlotName, string[]> = {
  background: ["background-color"],
  color: ["color"],
  border: ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  radius: [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  paddingTop: ["padding-top"],
  paddingRight: ["padding-right"],
  paddingBottom: ["padding-bottom"],
  paddingLeft: ["padding-left"],
  rowGap: ["row-gap"],
  columnGap: ["column-gap"],
  fontSize: ["font-size"],
  lineHeight: ["line-height"],
  letterSpacing: ["letter-spacing"],
  fontFamily: ["font-family"],
  fontWeight: ["font-weight"],
};

/**
 * Each corner, [top-left, top-right, bottom-right, bottom-left], for the class that rounded it.
 * Logical corners are read as on a left-to-right page.
 */
const CORNERS: Slot[] = [
  ["border-top-left-radius", "border-start-start-radius"],
  ["border-top-right-radius", "border-start-end-radius"],
  ["border-bottom-right-radius", "border-end-end-radius"],
  ["border-bottom-left-radius", "border-end-start-radius"],
].map((names) => ({ names: [...names, "border-radius"], inherits: false, kind: "length" }));

const TRACKED = [...new Set([...Object.values(SLOTS), ...CORNERS].flatMap((s: Slot) => s.names))];

/** Tailwind's rounding utilities: the size is group 1, none for bare `rounded`. */
const ROUNDED = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-([a-z0-9.]+))?$/;
const MAX_RADIUS_CLASS = 20;
const SINGLE_CLASS = /^\.((?:[\w-]|\\[0-9a-fA-F]{1,6}\s?|\\.)+)$/;

/**
 * The radius name a selector gives: only a single class that is a rounding utility. A variant
 * prefix, as `md:` in `md:rounded-xl`, is the same token at another breakpoint: the name follows
 * its last colon.
 */
function radiusClassOf(selector: string | null): string | null {
  const m = selector ? SINGLE_CLASS.exec(selector.trim()) : null;
  if (!m) return null;
  const size = ROUNDED.exec(
    unescapeIdent(m[1] as string)
      .split(":")
      .at(-1) as string
  );
  if (!size) return null;
  const name = size[1] ?? "DEFAULT";
  return name.length <= MAX_RADIUS_CLASS ? name : null;
}

// ---------- Selectors

function unescapeIdent(name: string): string {
  return name.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(.))/g, (_, hex: string, ch: string) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd) : ch
  );
}

/** The bucket a selector's rightmost compound files it under: an id, a class, a tag or `*`. */
function bucketOf(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  const compound = selector.slice(start);
  // Only the top level of the compound counts: `:is(.a)` could be any of its branches.
  let top = "";
  depth = 0;
  for (let i = 0; i < compound.length; i++) {
    const ch = compound[i] as string;
    if (ch === "\\") {
      if (depth === 0) top += ch + (compound[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (depth === 0) top += ch;
    if (ch === ")" || ch === "]") depth--;
  }
  const NAME = "((?:[\\w-]|\\\\[0-9a-fA-F]{1,6}\\s?|\\\\.|[^\\x00-\\x7f])+)";
  const id = new RegExp(`#${NAME}`).exec(top);
  if (id) return `#${unescapeIdent(id[1] as string)}`;
  const cls = new RegExp(`(?:^|[^:\\w-])\\.${NAME}`).exec(top);
  if (cls) return `.${unescapeIdent(cls[1] as string)}`;
  const tag = /^[A-Za-z][\w-]*/.exec(top);
  if (tag) return tag[0].toLowerCase();
  return "*";
}

// ---------- Values

/** The ref a declared value names: `var(--x)`, with or without fallback, or `calc(var(--x) * n)`. */
export function refOf(value: string): string | null {
  const text = value.trim();
  let m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,.*)?\)$/s.exec(text);
  let ref = m?.[1];
  if (!m) {
    m =
      /^calc\(\s*var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^()]*)?\)\s*\*\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i.exec(
        text
      );
    if (m) ref = `${m[1]}*${Number(m[2])}`;
  }
  if (!ref || ref.startsWith("--tw-") || ref.length > MAX_REF_LENGTH || !REF.test(ref)) return null;
  // A fallback holding more than one var() would end the match early: check the parentheses.
  if (m && text.startsWith("var(") && !balancedEnd(text)) return null;
  return ref;
}

/** Whether the `var(` that opens `text` closes at its last character. */
function balancedEnd(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i === text.length - 1;
  }
  return false;
}

const close = (a: number, b: number, within: number) => Math.abs(a - b) <= within + 1e-9;
/** A plain `px` length, exponent included, as `3.40282e+38px`; null for anything else. */
const pxOf = (value: string | undefined): number | null => {
  const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px$/i.exec(value?.trim() ?? "");
  return m ? Number(m[1]) : null;
};
/** Browsers clamp a huge radius to their own float, so past 9999 px every value is the same. */
const sameRadius = (a: number, b: number) => (a >= 9999 && b >= 9999) || close(a, b, 0.01);
const normaliseFamily = (v: string) =>
  v
    .split(",")
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase()
    )
    .join(",");

// ---------- The reader

type Decl = { value: string; important: boolean };
type Entry = {
  selector: string;
  spec: number;
  layer: number[];
  order: number;
  decls: Map<string, Decl>;
};
/** One declaration that reaches an element, with what orders it in the cascade. */
type Winner = Decl & {
  name: string;
  /** The rule's selector; null for the inline style. */
  selector: string | null;
  inline: boolean;
  layer: number[];
  spec: number;
  order: number;
};

/** Which declaration wins the cascade: positive when `a` does. */
function compare(a: Winner, b: Winner): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  for (let i = 0; i < Math.max(a.layer.length, b.layer.length); i++) {
    const x = a.layer[i] ?? Number.POSITIVE_INFINITY;
    const y = b.layer[i] ?? Number.POSITIVE_INFINITY;
    // !important reverses layer order: earlier layers, then layered over unlayered.
    if (x !== y) return (x < y ? -1 : 1) * (a.important ? -1 : 1);
  }
  if (a.spec !== b.spec) return a.spec - b.spec;
  return a.order - b.order;
}

/**
 * Says, for each element, which custom property each of its properties came from. The rules are
 * read once, filed by their rightmost compound, and matched per element; the cascade's winner
 * names the ref, which is kept only when the token gives the value the page shows.
 */
export function createRefReader(
  doc: Document,
  win: Win,
  deps: RefDeps
): { refsFor(el: Element): TokenRefs | undefined } {
  // Only time spent reading refs counts, not the rest of the capture between calls.
  let spent = 0;
  let since = 0;
  const timed = <T>(read: () => T): T => {
    since = deps.now();
    try {
      return read();
    } finally {
      spent += deps.now() - since;
    }
  };
  let seen = 0;
  let stopped = false;
  const overBudget = (): boolean => {
    if (stopped) return true;
    if (seen > MAX_RULES_SEEN || spent + deps.now() - since > TIME_BUDGET_MS) {
      stopped = true;
      deps.report?.("token-refs-partial");
    }
    return stopped;
  };

  const buckets = new Map<string, Entry[]>();
  let order = 0;
  try {
    timed(() =>
      walkStyleRules(doc, (rule, conditions, context: RuleContext) => {
        seen++;
        if (overBudget()) return false;
        if (!conditions.every((c) => c.applies)) return;
        const decls = new Map<string, Decl>();
        for (const name of TRACKED) {
          const value = rule.style.getPropertyValue(name).trim();
          if (value) {
            decls.set(name, {
              value,
              important: rule.style.getPropertyPriority(name) === "important",
            });
          }
        }
        order++;
        if (decls.size === 0) return;
        const { selectors } = nestSelectors(splitSelectors(rule.selectorText), context.parents);
        for (const selector of selectors) {
          // A rule for a pseudo-element or for hover says nothing about the element at rest.
          if (/::|:(?:before|after|first-line|first-letter)\b/i.test(selector)) continue;
          if (analyse(selector).kind !== "none") continue;
          const entry = {
            selector,
            spec: specificity(selector),
            layer: context.layer,
            order,
            decls,
          };
          const key = bucketOf(selector);
          const list = buckets.get(key);
          if (list) list.push(entry);
          else buckets.set(key, [entry]);
        }
      })
    );
  } catch {
    // refs are best effort
  }

  const matched = new WeakMap<Element, Winner[]>();
  /** The entries that match `el`, inline style included; null once the budget is spent. */
  const matchesOf = (el: Element): Winner[] | null => {
    const known = matched.get(el);
    if (known) return known;
    if (overBudget()) return null;
    const out: Winner[] = [];
    const keys = ["*", el.localName.toLowerCase(), ...Array.from(el.classList, (c) => `.${c}`)];
    if (el.id) keys.push(`#${el.id}`);
    const tried = new Set<Entry>();
    // Rules from the document's sheets do not reach into shadow roots.
    const inDocument = el.getRootNode().nodeType === 9;
    for (const key of inDocument ? keys : []) {
      for (const entry of buckets.get(key) ?? []) {
        if (tried.has(entry)) continue;
        tried.add(entry);
        seen++;
        let hit = false;
        try {
          hit = el.matches(entry.selector);
        } catch {
          // a selector `matches` can't take
        }
        if (!hit) continue;
        for (const [name, decl] of entry.decls) {
          const { layer, spec, order, selector } = entry;
          out.push({ ...decl, name, selector, inline: false, layer, spec, order });
        }
      }
      if (overBudget()) return null;
    }
    const inline = (el as HTMLElement).style;
    if (inline && typeof inline.getPropertyValue === "function") {
      for (const name of TRACKED) {
        const value = inline.getPropertyValue(name).trim();
        if (!value) continue;
        out.push({
          value,
          important: inline.getPropertyPriority(name) === "important",
          name,
          selector: null,
          inline: true,
          layer: [],
          spec: 0,
          order: 0,
        });
      }
    }
    matched.set(el, out);
    return out;
  };

  /** The winning declaration for one slot on `el` itself, or null when no rule sets it. */
  const ownWinner = (el: Element, slot: Slot): Winner | null | undefined => {
    const list = matchesOf(el);
    if (!list) return undefined;
    let best: Winner | null = null;
    for (const w of list) {
      if (!slot.names.includes(w.name)) continue;
      if (!best || compare(w, best) > 0) best = w;
      else if (compare(w, best) === 0) {
        // Same rule: the longhand, listed first, is taken as the later declaration.
        if (slot.names.indexOf(w.name) < slot.names.indexOf(best.name)) best = w;
      }
    }
    return best;
  };

  const parentOf = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement;
    const root = el.parentNode as ShadowRoot | null;
    return root && root.nodeType === 11 ? root.host : null;
  };

  /** The declaration a slot takes, walking up for inherited properties. Undefined past the budget. */
  const declFor = (el: Element, slot: Slot): Decl | null | undefined => {
    let at: Element | null = el;
    for (let step = 0; at && step < MAX_ANCESTORS; step++) {
      const own = ownWinner(at, slot);
      if (own === undefined) return undefined;
      const keyword = own?.value.toLowerCase();
      const passes = keyword === "inherit" || (slot.inherits && keyword === "unset");
      if (own && !passes) return own;
      if (!own && !slot.inherits) return null;
      at = parentOf(at);
    }
    return null;
  };

  let rootStyle: CSSStyleDeclaration | undefined;
  const rootProps = () => {
    rootStyle ??= win.getComputedStyle(doc.documentElement);
    return rootStyle;
  };
  const rootPx = () => Number.parseFloat(rootProps().getPropertyValue("font-size")) || 16;

  /** Whether the token behind `ref` gives `el`'s computed value for the slot. */
  const agrees = (ref: string, slot: SlotName, kind: Kind, style: CSSStyleDeclaration): boolean => {
    const [name, times] = ref.split("*") as [string, string | undefined];
    const token = resolveVars(
      `var(${name})`,
      (n) => rootProps().getPropertyValue(n).trim() || undefined
    );
    if (token === null || token.trim() === "") return false;
    const values = COMPUTED[slot].map((p) => style.getPropertyValue(p).trim());
    // A border colour with no border to paint it (Tailwind sets one on every element) says nothing.
    const widths = ["top", "right", "bottom", "left"].map((side) =>
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`))
    );
    if (slot === "border" && !widths.some((w) => w > 0)) return false;
    if (kind === "color") {
      if (times !== undefined) return false;
      const want = parseCssColor(token);
      if (!want) return false;
      return values.every((v) => {
        const got = parseCssColor(v);
        return (
          got !== null &&
          close(got.r, want.r, 1 / 255) &&
          close(got.g, want.g, 1 / 255) &&
          close(got.b, want.b, 1 / 255) &&
          close(got.a, want.a, 1 / 255)
        );
      });
    }
    if (kind === "family") {
      return (
        times === undefined && values.every((v) => normaliseFamily(v) === normaliseFamily(token))
      );
    }
    if (kind === "weight") {
      const want = Number(token.trim()) * (times === undefined ? 1 : Number(times));
      return Number.isFinite(want) && values.every((v) => close(Number(v), want, 0.01));
    }
    let length = evalLength(token, {}, rootPx());
    if (length === null) return false;
    if (times !== undefined) length *= Number(times);
    // A unitless line height scales with the font size.
    if (slot === "lineHeight" && !/[a-z%]/i.test(token.replace(/calc|var|--[\w-]+/gi, ""))) {
      length *= Number.parseFloat(style.getPropertyValue("font-size"));
    }
    const want = length;
    return values.every((v) => /px$/.test(v) && close(Number.parseFloat(v), want, 0.01));
  };

  /** A corner's declared value in px, its `var()`s read from the root; null when it can't be. */
  const cornerLength = (value: string): number | null => {
    const plain = pxOf(value);
    if (plain !== null) return plain;
    const text = resolveVars(value, (n) => rootProps().getPropertyValue(n).trim() || undefined);
    return text === null ? null : evalLength(text, {}, rootPx());
  };

  const cache = new WeakMap<Element, TokenRefs | undefined>();
  return {
    refsFor(el: Element): TokenRefs | undefined {
      if (cache.has(el)) return cache.get(el);
      if (stopped || buckets.size === 0) return undefined;
      return timed(() => read(el));
    },
  };

  function read(el: Element): TokenRefs | undefined {
    let style: CSSStyleDeclaration | undefined;
    const refs: Partial<Record<SlotName, string>> = {};
    for (const [slotName, slot] of Object.entries(SLOTS) as Array<[SlotName, Slot]>) {
      const decl = declFor(el, slot);
      if (decl === undefined) return undefined;
      const ref = decl && refOf(decl.value);
      if (!ref) continue;
      style ??= win.getComputedStyle(el);
      if (agrees(ref, slotName, slot.kind, style)) refs[slotName] = ref;
    }
    const out: TokenRefs = {};
    for (const key of ["background", "color", "border", "radius"] as const) {
      if (refs[key]) out[key] = refs[key];
    }
    // A class names a corner only where its value is the corner's computed px, so that a rule
    // the reader got wrong, as when the real winner sat in a sheet it couldn't read, names nothing.
    const corners: (string | null)[] = [];
    for (const [at, corner] of CORNERS.entries()) {
      const own = ownWinner(el, corner);
      if (own === undefined) return undefined;
      let name = radiusClassOf(own?.selector ?? null);
      if (name && own) {
        style ??= win.getComputedStyle(el);
        const got = pxOf(style.getPropertyValue(COMPUTED.radius[at] as string).split(/\s+/)[0]);
        const want = cornerLength(own.value);
        if (got === null || want === null || !(got > 0) || !sameRadius(got, want)) name = null;
      }
      corners.push(name);
    }
    if (corners.some(Boolean)) out.radiusClass = corners as NonNullable<TokenRefs["radiusClass"]>;
    const sides = [refs.paddingTop, refs.paddingRight, refs.paddingBottom, refs.paddingLeft];
    if (sides.some(Boolean)) {
      out.padding = sides.map((s) => s ?? null) as NonNullable<TokenRefs["padding"]>;
    }
    if (refs.rowGap && refs.rowGap === refs.columnGap) out.gap = refs.rowGap;
    for (const key of [
      "fontSize",
      "lineHeight",
      "letterSpacing",
      "fontFamily",
      "fontWeight",
    ] as const) {
      if (refs[key]) out[key] = refs[key];
    }
    const result = Object.keys(out).length > 0 ? out : undefined;
    cache.set(el, result);
    return result;
  }
}
