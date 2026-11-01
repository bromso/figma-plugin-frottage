import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { colorOf, px, readLayout, readStyle, readTransform, readZIndex } from "./styles";
import { cleanText } from "./urls";

export type Box = { x: number; y: number; w: number; h: number };
export type Which = "before" | "after";

/** What text takes from the elements around it, passed down the walk. */
export type Inherited = {
  /** The link in effect. `undefined` is no link. */
  link: string | undefined;
  /** The `text-decoration-line` in effect. */
  decoration: string;
};

/** What a pseudo-element needs from the walker; kept narrow so this file does not import it. */
export type PseudoCtx = {
  win: Window & typeof globalThis;
  /** Computed style of an element, or of one of its pseudo-elements. */
  cs: (el: Element, pseudo?: `::${Which}`) => CSSStyleDeclaration;
  /** The next node id, or null once the node budget is spent. */
  nextId: () => number | null;
  warn: (code: string, nodeId: string | undefined, detail: string) => void;
  /** Page-space border box of an element. */
  pageBox: (el: Element) => Box;
  scroll: { x: number; y: number };
  viewport: { w: number; h: number };
  /** Width in px of `text` set in the font of `style`. */
  measure: (text: string, style: CSSStyleDeclaration) => number;
  /** Whether a field's content must never be read. */
  isSecret: (el: Element) => boolean;
  /** A text node for a string the page does not hold in a text node. */
  text: (
    value: string,
    style: CSSStyleDeclaration,
    box: Box,
    tag: string,
    inherited: Inherited
  ) => TextNode | null;
  cache: WeakMap<Element, { before?: Pseudo | null; after?: Pseudo | null }>;
};

export type Pseudo = {
  which: Which;
  style: CSSStyleDeclaration;
  /** Quoted strings (and resolved `attr()`), joined; `counter()`, `url()` and the like are left out. */
  text: string;
  /** Names of the parts of `content` that were left out. */
  approximated: string[];
  /** `inline`: unpainted inline text that joins its element's text. `box`: anything else. */
  mode: "inline" | "box";
};

const CONTROLS = new Set(["input", "textarea", "select", "button", "option", "output"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

function unescapeString(body: string): string {
  return body
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\\(.)/gs, "$1");
}

/**
 * The text of a computed `content` value, or null when nothing is generated (`none`, `normal`).
 * Quoted strings are kept (the browser has already turned `attr()` into one); everything else is
 * left out and named in `approximated`. URLs inside the text lose query, fragment and userinfo.
 */
export function parseContent(value: string): { text: string; approximated: string[] } | null {
  const v = value.trim();
  if (v === "" || v === "none" || v === "normal") return null;
  let text = "";
  const approximated: string[] = [];
  let i = 0;
  while (i < v.length) {
    const ch = v[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < v.length && v[j] !== ch) j += v[j] === "\\" ? 2 : 1;
      text += unescapeString(v.slice(i + 1, j));
      i = j + 1;
    } else if (ch === "/") {
      break; // alternative text for assistive technology, not rendered
    } else {
      let j = i;
      while (j < v.length && /[^\s(]/.test(v[j] as string)) j++;
      const name = v.slice(i, j).toLowerCase();
      if (v[j] === "(") {
        let depth = 0;
        let quote = "";
        let k = j;
        for (; k < v.length; k++) {
          const c = v[k] as string;
          if (quote) {
            if (c === "\\") k++;
            else if (c === quote) quote = "";
          } else if (c === '"' || c === "'") quote = c;
          else if (c === "(") depth++;
          else if (c === ")" && --depth === 0) break;
        }
        // Browsers resolve attr() before the computed value is read; one left here is unreadable.
        approximated.push(`${name}()`);
        i = k + 1;
      } else {
        approximated.push(name || "content");
        i = Math.max(j, i + 1);
      }
    }
  }
  return { text: cleanText(text), approximated };
}

function paints(s: CSSStyleDeclaration): boolean {
  return (
    colorOf(s.backgroundColor).a > 0 ||
    s.backgroundImage !== "none" ||
    (s.borderTopStyle !== "none" && px(s.borderTopWidth) > 0) ||
    (s.borderRightStyle !== "none" && px(s.borderRightWidth) > 0) ||
    (s.borderBottomStyle !== "none" && px(s.borderBottomWidth) > 0) ||
    (s.borderLeftStyle !== "none" && px(s.borderLeftWidth) > 0) ||
    s.boxShadow !== "none"
  );
}

/**
 * The generated content of `::before` or `::after` on an element, or null when it generates none:
 * `content: none` or `normal`, `display: none`, or an element whose content must not be read.
 * Read once per element and cached for the capture.
 */
export function readPseudo(el: Element, which: Which, ctx: PseudoCtx): Pseudo | null {
  let slot = ctx.cache.get(el);
  if (!slot) {
    slot = {};
    ctx.cache.set(el, slot);
  }
  const hit = slot[which];
  if (hit !== undefined) return hit;
  const found = compute(el, which, ctx);
  slot[which] = found;
  return found;
}

function compute(el: Element, which: Which, ctx: PseudoCtx): Pseudo | null {
  if (ctx.isSecret(el)) return null;
  const style = ctx.cs(el, `::${which}`);
  if (style.display === "none") return null;
  const parsed = parseContent(style.content);
  if (!parsed) return null;
  // Generated text on a form control is never kept; its box and paint still are.
  if (CONTROLS.has(el.localName)) parsed.text = "";
  const flow =
    style.display === "inline" &&
    style.position === "static" &&
    style.cssFloat === "none" &&
    style.transform === "none" &&
    style.opacity === "1" &&
    style.filter === "none" &&
    style.mixBlendMode === "normal" &&
    !paints(style);
  return { which, style, ...parsed, mode: flow ? "inline" : "box" };
}

/** Reports what was left out of a pseudo-element's content; one warning per pseudo-element. */
export function noteApproximations(p: Pseudo, nodeId: string | undefined, ctx: PseudoCtx) {
  if (p.approximated.length === 0) return;
  ctx.warn(
    "pseudo-approximate",
    nodeId,
    `Generated content was left out or placed approximately: ${[...new Set(p.approximated)].join(", ")}`
  );
}

/** Collapses white space as the page's `white-space` does, for text that has no DOM node. */
export function collapse(text: string, whiteSpace: string): string {
  if (whiteSpace === "pre" || whiteSpace === "pre-wrap" || whiteSpace === "break-spaces") {
    return text;
  }
  if (whiteSpace === "pre-line") return text.replace(/[ \t\f\r]+/g, " ");
  return text.replace(/[ \t\n\r\f]+/g, " ");
}

function composedParent(el: Element): Element | null {
  const root = el.getRootNode();
  return el.parentElement ?? ("host" in root ? (root as ShadowRoot).host : null);
}

/** The padding box that positions an absolutely placed pseudo-element of `el`. */
function containingBlock(el: Element, fixed: boolean, ctx: PseudoCtx): Box {
  if (fixed) {
    return { x: ctx.scroll.x, y: ctx.scroll.y, w: ctx.viewport.w, h: ctx.viewport.h };
  }
  for (let at: Element | null = el; at; at = composedParent(at)) {
    const s = ctx.cs(at);
    if (s.position === "static" && s.transform === "none") continue;
    const b = ctx.pageBox(at);
    const l = px(s.borderLeftWidth);
    const t = px(s.borderTopWidth);
    return {
      x: b.x + l,
      y: b.y + t,
      w: b.w - l - px(s.borderRightWidth),
      h: b.h - t - px(s.borderBottomWidth),
    };
  }
  // The initial containing block: the viewport-sized area at the top of the page.
  return { x: 0, y: 0, w: ctx.viewport.w, h: ctx.viewport.h };
}

const used = (value: string): number | null => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The node for a `::before` or `::after` that cannot join its element's text: a painted or
 * positioned one becomes a synthetic element named `::before` or `::after`, with its text inside.
 * Unpainted inline text is not handled here; the walker merges it into the surrounding text.
 *
 * An absolutely positioned pseudo-element is placed from its computed `top`, `left`, `width` and
 * `height`. Any other sits at its element's content edge: the start for `::before`, the end for
 * `::after`; that placement is approximate and counted in a `pseudo-approximate` warning.
 */
export function pseudoNodes(
  el: Element,
  which: Which,
  ctx: PseudoCtx,
  inherited: Inherited
): CaptureNode[] {
  const p = readPseudo(el, which, ctx);
  if (p?.mode !== "box") return [];
  const s = p.style;
  const host = ctx.cs(el);
  const hostBox = ctx.pageBox(el);
  const text = collapse(p.text, s.whiteSpace);
  const shown = s.visibility === "visible" && text.trim() !== "";
  const approximated = [...p.approximated];

  const border = {
    l: px(s.borderLeftWidth),
    t: px(s.borderTopWidth),
    r: px(s.borderRightWidth),
    b: px(s.borderBottomWidth),
  };
  const pad = {
    l: px(s.paddingLeft),
    t: px(s.paddingTop),
    r: px(s.paddingRight),
    b: px(s.paddingBottom),
  };
  const fontSize = px(s.fontSize);
  const lineH = used(s.lineHeight) ?? fontSize * 1.2;
  // `auto` sizes (an inline pseudo-element) come from the text itself.
  const textW = shown ? ctx.measure(text.trim(), s) : 0;
  // A computed width or height excludes padding and border unless the box is `border-box`.
  const extraW = s.boxSizing === "border-box" ? 0 : pad.l + pad.r + border.l + border.r;
  const extraH = s.boxSizing === "border-box" ? 0 : pad.t + pad.b + border.t + border.b;
  const usedW = used(s.width);
  const usedH = used(s.height);
  const w = usedW === null ? textW + pad.l + pad.r + border.l + border.r : usedW + extraW;
  const h = usedH === null ? lineH + pad.t + pad.b + border.t + border.b : usedH + extraH;

  let x: number;
  let y: number;
  const out = s.position === "absolute" || s.position === "fixed";
  const left = out ? used(s.left) : null;
  const top = out ? used(s.top) : null;
  if (out && left !== null && top !== null) {
    const cb = containingBlock(el, s.position === "fixed", ctx);
    x = cb.x + left;
    y = cb.y + top;
  } else {
    approximated.push("position");
    const hb = px(host.borderLeftWidth) + px(host.paddingLeft);
    x = hostBox.x + hb;
    y =
      which === "before"
        ? hostBox.y + px(host.borderTopWidth) + px(host.paddingTop)
        : hostBox.y + hostBox.h - px(host.borderBottomWidth) - px(host.paddingBottom) - h;
    // In a row flex container a generated box is an item, next to the first or last child.
    // Children without a box or out of flow are not items; row-reverse swaps the two ends.
    const items = Array.from(el.children).filter((c) => {
      const cs = ctx.cs(c);
      return (
        cs.display !== "none" &&
        cs.display !== "contents" &&
        cs.position !== "absolute" &&
        cs.position !== "fixed"
      );
    });
    const anchor = which === "before" ? items[0] : items[items.length - 1];
    if (host.display.includes("flex") && host.flexDirection.startsWith("row") && anchor) {
      const sb = ctx.pageBox(anchor);
      const gap = px(host.columnGap);
      // `before` comes first in order: left of the first item, or right of it in row-reverse.
      const leftOf = (which === "before") !== host.flexDirection.endsWith("reverse");
      x = leftOf ? sb.x - gap - w : sb.x + sb.w + gap;
      // Cross axis: centre on the neighbour when the container centres its items.
      y = host.alignItems === "center" ? sb.y + (sb.h - h) / 2 : sb.y;
    }
  }
  const box: Box = { x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
  if (!(box.w > 0 && box.h > 0)) return [];

  const n = ctx.nextId();
  if (n === null) return [];
  const id = `n${n}`;
  const tag = `::${which}`;
  noteApproximations({ ...p, approximated }, id, ctx);
  const transform = readTransform(s.transform);
  const node: ElementNode = {
    id,
    kind: "element",
    box,
    paintOrder: n,
    ...readZIndex(s, host.display),
    visible: s.visibility !== "hidden",
    opacity: Math.min(1, Math.max(0, Number.parseFloat(s.opacity))) || 0,
    blendMode: s.mixBlendMode,
    ...(transform ? { transform } : {}),
    semantic: { tag },
    style: readStyle(s, box.w, box.h),
    layout: readLayout(s),
    children: [],
  };
  if (shown) {
    const inner: Box = {
      x: round2(box.x + border.l + pad.l),
      y: round2(box.y + border.t + pad.t),
      w: round2(Math.max(box.w - border.l - border.r - pad.l - pad.r, textW)),
      h: round2(lineH),
    };
    const t = ctx.text(text.trim(), s, inner, tag, inherited);
    if (t) node.children.push(t);
  }
  return [node];
}
