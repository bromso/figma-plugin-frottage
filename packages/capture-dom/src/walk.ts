import type {
  Capture,
  CaptureNode,
  ElementNode,
  ImageNode,
  PlaceholderNode,
  TextNode,
} from "@repo/capture-schema";
import type { Rgba } from "./color";
import { flatChildren, insideEditable, isEditable, shadowRootOf } from "./flatten";
import { authoredTracksReader } from "./grid";
import { type Hover, type HoverDeps, hoverCandidates, readHover } from "./hover";
import {
  collapse,
  type Inherited,
  noteApproximations,
  type Pseudo,
  type PseudoCtx,
  pseudoNodes,
  readPseudo,
  type Which,
} from "./pseudo";
import {
  clipsToText,
  colorOf,
  isTokenValue,
  parseFilters,
  px,
  readBorders,
  readFlow,
  readLayout,
  readMarginAuto,
  readRadii,
  readStyle,
  readTransform,
  readZIndex,
} from "./styles";
import { emptySvgReport, MAX_SVG_BYTES, SvgTooLargeError, serialiseSvg } from "./svg";
import { cleanUrl, rememberUrl } from "./urls";

export type CaptureEnv = {
  now: () => string;
  toolVersion: string;
  /** Reaches closed shadow roots (the extension passes `chrome.dom.openOrClosedShadowRoot`); open ones are read without it. */
  getShadowRoot?: (el: Element) => ShadowRoot | null;
  /**
   * Leave out an element that does nothing but hold one child: no paint, spacing, position,
   * effect, text or meaning of its own. The child keeps its own box, in page coordinates, so the
   * look is the same with fewer layers. Off by default.
   */
  collapseWrappers?: boolean;
};

type Box = { x: number; y: number; w: number; h: number };
/** A generated rect inside a text group, placed once the real rects around it are known. */
type Rect = Box & { gen?: Which };
/** `::before` or `::after` text that joins the text of the group it sits in. */
class PseudoItem {
  constructor(readonly pseudo: Pseudo) {}
}
type Item = Node | PseudoItem;
// A class, not a `"pseudo" in` test: newer browsers give every Element a `pseudo` method.
const isPseudoItem = (i: Item): i is PseudoItem => i instanceof PseudoItem;
type Run = TextNode["runs"][number];
type Font = Capture["fonts"][number];
type Warning = Capture["warnings"][number];

/** Matches `LIMITS.depth` in @repo/capture-schema; the root counts as depth 1. */
const MAX_DEPTH = 256;
/** Matches `LIMITS.nodes` in @repo/capture-schema; kept local so the walker stays type-only. */
const MAX_NODES = 20_000;
const XHTML = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Elements that mean something on their own, so they stay even when they only hold one child. */
const KEPT_WRAPPER_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "details",
  "dialog",
  "form",
  "fieldset",
  "table",
  "li",
  "ul",
  "ol",
  "p",
  "pre",
  "blockquote",
  "figure",
  "iframe",
  "canvas",
  "video",
  "svg",
  "img",
]);

const IGNORED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "meta",
  "link",
  "title",
  "base",
  "datalist",
]);
/** Tags whose content is not part of the text flow. */
const NOT_TEXT = new Set([
  "img",
  "svg",
  "canvas",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  "input",
  "textarea",
  "select",
  "button",
  "picture",
  "meter",
  "progress",
]);

/** Page strings index this table and `LANDMARK_TAGS`, so neither has a prototype. */
const GENERIC_FAMILIES: Record<string, string> = Object.assign(Object.create(null), {
  "sans-serif": "Arial",
  serif: "Times New Roman",
  monospace: "Courier New",
  cursive: "Comic Sans MS",
  fantasy: "Impact",
  "system-ui": "Arial",
  "ui-sans-serif": "Arial",
  "ui-serif": "Times New Roman",
  "ui-monospace": "Courier New",
  "ui-rounded": "Arial",
  "-apple-system": "Arial",
  blinkmacsystemfont: "Arial",
});

const LANDMARK_TAGS: Record<string, string> = Object.assign(Object.create(null), {
  header: "banner",
  nav: "navigation",
  main: "main",
  footer: "contentinfo",
  aside: "complementary",
  form: "form",
});

const NO_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "image",
  "file",
  "hidden",
  "password",
]);
const BUTTON_INPUTS = new Set(["submit", "button", "reset"]);
const SECRET_AUTOCOMPLETE =
  /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)\b/;

const STORED_LINK = /^(?:https?|javascript|data|blob):/i;

const round2 = (n: number) => Math.round(n * 100) / 100;
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Whether a field's content must never be read. Looks at attributes only, never at `value`.
 * True for password inputs and for fields that declare a password, one-time-code or card secret
 * through `autocomplete`. Such a field is captured as an empty box.
 */
function isSecretField(el: Element): boolean {
  const tag = el.localName;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
  if ((el.getAttribute("type") ?? "").trim().toLowerCase() === "password") return true;
  return SECRET_AUTOCOMPLETE.test((el.getAttribute("autocomplete") ?? "").toLowerCase());
}

/** Whether anything inside `el` must stay unread: a secret field, or text a person can type into. */
const isPrivate = (el: Element): boolean => isSecretField(el) || isEditable(el);

/** `textContent`, skipping what must stay unread, including text slotted into an editable element. */
function publicText(node: Node): string {
  if (node.nodeType === 3) return insideEditable(node) ? "" : (node.nodeValue ?? "");
  if (node.nodeType !== 1 || isPrivate(node as Element)) return "";
  return Array.from(node.childNodes, publicText).join("");
}

export function captureDocument(doc: Document, env: CaptureEnv): Capture {
  const win = doc.defaultView as Window & typeof globalThis;
  const root = doc.documentElement;
  const scrollX = win.scrollX;
  const scrollY = win.scrollY;
  const warnings = new Map<string, { first: Warning; count: number }>();
  const fonts = new Map<string, Font>();
  const familyCache = new Map<string, string>();
  const installedCache = new Map<string, boolean>();
  const mergeable = new WeakMap<Element, boolean>();
  const authoredTracks = authoredTracksReader(win);
  let counter = 0;
  let limitHit = false;
  /** Ids and node budget in one: nothing is emitted once MAX_NODES ids have been handed out. */
  const nextId = (): number | null => {
    if (counter >= MAX_NODES) {
      if (!limitHit) {
        limitHit = true;
        warn("node-limit", "", `Capture stopped at ${MAX_NODES} nodes; the rest was not captured`);
      }
      return null;
    }
    return counter++;
  };
  let canvasCtx: CanvasRenderingContext2D | null | undefined;

  const cs = (el: Element) => win.getComputedStyle(el);
  /** A slot with `display: contents` has no box and is replaced by what it shows; any other keeps its node. */
  const keepSlot = (slot: Element) => isEditable(slot) || cs(slot).display !== "contents";
  const childrenOf = (el: Element) => flatChildren(el, env, keepSlot);
  const pageBox = (r: { left: number; top: number; width: number; height: number }): Box => ({
    x: round2(r.left + scrollX),
    y: round2(r.top + scrollY),
    w: round2(r.width),
    h: round2(r.height),
  });
  const area = (r: { width: number; height: number }) => r.width * r.height;
  const boxArea = (b: Box) => b.w * b.h;

  const pseudoCtx: PseudoCtx = {
    win,
    cs: (el, pseudo) => win.getComputedStyle(el, pseudo),
    nextId: () => nextId(),
    warn: (code, nodeId, detail) => warn(code, nodeId, detail),
    warnStops: (nodeId) => warnStops(nodeId),
    pageBox: (el) => pageBox(el.getBoundingClientRect()),
    scroll: { x: scrollX, y: scrollY },
    viewport: { w: root.clientWidth, h: root.clientHeight },
    measure: (text, style) => measure(text, style),
    isSecret: isPrivate,
    text: (value, style, box, tag, up) => {
      const clipped = up.clipped || clipsToText(style);
      const node = boxedText(value, style, box, tag, false, clipped);
      const inside = {
        link: up.link,
        decoration: decorationInside(style, up.decoration),
        clipped,
      };
      if (node) for (const run of node.runs) inherit(run, inside);
      return node;
    },
    cache: new WeakMap(),
  };

  // ---------- Fonts

  function measureCtx(): CanvasRenderingContext2D | null {
    if (canvasCtx === undefined) {
      try {
        canvasCtx = doc.createElement("canvas").getContext("2d");
      } catch {
        canvasCtx = null;
      }
    }
    return canvasCtx;
  }

  function isInstalled(name: string): boolean {
    const hit = installedCache.get(name);
    if (hit !== undefined) return hit;
    const ctx = measureCtx();
    let found = false;
    if (ctx) {
      const sample = "mmmmmmmmmmlliWW 0123";
      for (const base of ["monospace", "serif"]) {
        ctx.font = `72px ${base}`;
        const baseline = ctx.measureText(sample).width;
        ctx.font = `72px "${name}", ${base}`;
        if (ctx.measureText(sample).width !== baseline) found = true;
      }
    }
    installedCache.set(name, found);
    return found;
  }

  const declaredFaces = (name: string): FontFace[] => {
    const out: FontFace[] = [];
    doc.fonts.forEach((face) => {
      if (face.family.replace(/^["']|["']$/g, "") === name) out.push(face);
    });
    return out;
  };

  /** The family that actually renders: first in the stack that is loaded or installed, else a generic map. */
  function renderedFamily(stack: string, weight: number, style: string) {
    const key = `${stack}|${weight}|${style}`;
    const cached = familyCache.get(key);
    if (cached) return cached;
    let family = "Arial";
    let web = false;
    for (const raw of stack.split(",")) {
      const name = raw.trim().replace(/^["']|["']$/g, "");
      if (!name) continue;
      const generic = GENERIC_FAMILIES[name.toLowerCase()];
      if (generic) {
        family = generic;
        break;
      }
      const faces = declaredFaces(name);
      if (faces.length > 0) {
        if (doc.fonts.check(`${style} ${weight} 16px "${name}"`)) {
          family = name;
          web = true;
          break;
        }
        continue;
      }
      if (isInstalled(name)) {
        family = name;
        break;
      }
    }
    familyCache.set(key, family);
    const id = `${family}|${weight}|${style}`;
    if (!fonts.has(id)) fonts.set(id, { family, weight, style, loadedAsWebFont: web });
    // Remember the web flag with the cache key's family so repeated runs agree.
    return family;
  }

  // ---------- Text

  /**
   * The colour text is painted in: `-webkit-text-fill-color` wins over `color` and defaults to it.
   * A clear fill shows only its outline, or the background of a clip, and Figma text has one colour.
   */
  function paintedColor(style: CSSStyleDeclaration, clipped: boolean): Rgba {
    const fill = colorOf(style.getPropertyValue("-webkit-text-fill-color") || style.color);
    if (fill.a > 0 || clipped) return fill;
    const stroked = px(style.getPropertyValue("-webkit-text-stroke-width")) > 0;
    const shown = colorOf(
      stroked ? style.getPropertyValue("-webkit-text-stroke-color") : style.color
    );
    if (shown.a > 0) {
      warn(
        "text-fill-transparent",
        undefined,
        "Text with a transparent fill was imported filled with its stroke or text colour"
      );
    }
    return shown;
  }

  function runOf(style: CSSStyleDeclaration, start: number, end: number, clipped: boolean): Run {
    const weight = Number.parseInt(style.fontWeight, 10) || 400;
    const align = style.textAlign;
    return {
      start,
      end,
      family: renderedFamily(style.fontFamily, weight, style.fontStyle),
      weight,
      style: style.fontStyle,
      size: px(style.fontSize),
      lineHeight: style.lineHeight === "normal" ? null : px(style.lineHeight),
      letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
      color: paintedColor(style, clipped),
      decoration: style.textDecorationLine || "none",
      transform: style.textTransform,
      align: align === "start" ? "left" : align === "end" ? "right" : align,
    };
  }

  /**
   * The link a node's text carries, passed down the walk so it follows the flattened tree: slotted
   * content takes the link of the slot's ancestors in the shadow root, and a shadow host's content
   * the link of the light anchor around the host. `undefined` is no link.
   */
  type Link = string | undefined;
  const anchorTargets = new WeakMap<Element, Link>();

  /** The stored target of an `<a href>`, only when it is a real http(s) page; cached per anchor. */
  function anchorTarget(a: Element): Link {
    if (anchorTargets.has(a)) return anchorTargets.get(a);
    let out: Link;
    const raw = (a.getAttribute("href") ?? "").trim();
    if (raw !== "" && !raw.startsWith("#")) {
      try {
        const u = new URL((a as HTMLAnchorElement).href);
        // A same-page `#anchor` has no target once the fragment is cleaned away.
        const samePage =
          u.hash &&
          u.href.slice(0, u.href.length - u.hash.length) ===
            new URL(doc.URL).href.replace(/#.*$/s, "");
        const web = u.protocol === "http:" || u.protocol === "https:";
        if (web && !samePage) out = cleanUrl(u.href);
        else if (!web && u.protocol !== "javascript:") {
          warn(
            "link-not-web",
            undefined,
            "Links that are not web pages, such as email or phone links, have no link in Figma"
          );
        }
      } catch {
        out = undefined;
      }
    }
    anchorTargets.set(a, out);
    return out;
  }

  /** The link in effect inside `el`: its own when it is an anchor, else the one it sits in. */
  const linkInside = (el: Element, inherited: Link): Link =>
    el.localName === "a" && el.namespaceURI === XHTML && el.hasAttribute("href")
      ? anchorTarget(el)
      : inherited;

  /** Two `text-decoration-line` values as one; decorations add up rather than replace. */
  function bothDecorations(a: string, b: string): string {
    if (a === "none" || a === b) return b;
    if (b === "none") return a;
    return [...new Set(`${a} ${b}`.split(" "))].join(" ");
  }

  /**
   * The decoration in effect inside a box. `text-decoration` does not inherit but propagates to
   * the text below, so a run's own computed value leaves out its ancestors'. CSS stops that at
   * atomic inlines, floats and absolutely positioned boxes.
   */
  function decorationInside(s: CSSStyleDeclaration, up: string): string {
    const own = s.textDecorationLine || "none";
    const stops =
      ATOMIC_INLINE.has(s.display) ||
      s.display === "inline-table" ||
      s.position === "absolute" ||
      s.position === "fixed" ||
      s.cssFloat !== "none";
    return stops ? own : bothDecorations(up, own);
  }

  const inside = (el: Element, s: CSSStyleDeclaration, up: Inherited): Inherited => ({
    link: linkInside(el, up.link),
    decoration: decorationInside(s, up.decoration),
    clipped: up.clipped || clipsToText(s),
  });

  const inherit = (run: Run, up: Inherited): Run => {
    run.decoration = bothDecorations(up.decoration, run.decoration);
    if (up.link !== undefined) run.href = up.link;
    return run;
  };

  const sameStyle = (a: Run, b: Run) => {
    const { start: _s1, end: _e1, ...x } = a;
    const { start: _s2, end: _e2, ...y } = b;
    return JSON.stringify(x) === JSON.stringify(y);
  };

  const ATOMIC_INLINE = new Set(["inline-block", "inline-flex", "inline-grid"]);

  /** Whether all these rects sit on one line. */
  function oneRow(rects: DOMRectList): boolean {
    let first: DOMRect | undefined;
    for (const r of rects) {
      if (area(r) <= 0) continue;
      first ??= r;
      const overlap = Math.min(first.bottom, r.bottom) - Math.max(first.top, r.top);
      if (overlap <= 0.5 * Math.min(first.height, r.height)) return false;
    }
    return true;
  }

  /** Whether something below `el` moves text along the line with padding or a margin. */
  function spacedInside(el: Element): boolean {
    for (const child of childrenOf(el)) {
      if (child.nodeType !== 1) continue;
      const s = cs(child as Element);
      const sides = [
        s.paddingInlineStart,
        s.paddingInlineEnd,
        s.marginInlineStart,
        s.marginInlineEnd,
      ];
      if (sides.some((v) => parseFloat(v) !== 0) || spacedInside(child as Element)) return true;
    }
    return false;
  }

  /**
   * An atomic inline that is only a wrapper around one line of text: static, no margin, padding or
   * overflow on it or below it, and a box no different from the text inside it. Merging such an
   * element into the sentence loses nothing but its own (invisible) box.
   */
  function actsAsText(el: Element, s: CSSStyleDeclaration): boolean {
    if (s.position !== "static" || s.overflowX !== "visible" || s.overflowY !== "visible") {
      return false;
    }
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const pad = (s as unknown as Record<string, string>)[`padding${side}`];
      const margin = (s as unknown as Record<string, string>)[`margin${side}`];
      if (parseFloat(pad) !== 0 || parseFloat(margin) !== 0) return false;
    }
    if (spacedInside(el)) return false;
    const range = doc.createRange();
    range.selectNodeContents(el);
    if (!oneRow(range.getClientRects())) return false;
    const inner = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // Text rects are as tall as the glyphs, boxes as tall as their line, so allow the leading.
    const size = parseFloat(s.fontSize) || 0;
    const line = parseFloat(s.lineHeight);
    const leading = Math.max(0, (Number.isNaN(line) ? size * 1.5 : line) - size);
    return (
      Math.abs(box.width - inner.width) <= 1 &&
      box.height >= inner.height - 1 &&
      box.height <= inner.height + leading + 1
    );
  }

  /** Inline elements that can merge into their block's text node. */
  function isMergeable(el: Element): boolean {
    const hit = mergeable.get(el);
    if (hit !== undefined) return hit;
    let ok = false;
    if (el.localName === "br" && el.namespaceURI === XHTML) {
      ok = true;
    } else if (
      el.namespaceURI === XHTML &&
      !isEditable(el) &&
      !NOT_TEXT.has(el.localName) &&
      !IGNORED_TAGS.has(el.localName)
    ) {
      const s = cs(el);
      ok =
        (s.display === "inline" || (ATOMIC_INLINE.has(s.display) && actsAsText(el, s))) &&
        s.transform === "none" &&
        s.opacity === "1" &&
        s.filter === "none" &&
        s.boxShadow === "none" &&
        s.backgroundImage === "none" &&
        colorOf(s.backgroundColor).a === 0 &&
        s.borderTopStyle === "none" &&
        s.borderRightStyle === "none" &&
        s.borderBottomStyle === "none" &&
        s.borderLeftStyle === "none" &&
        s.mixBlendMode === "normal";
      if (ok) {
        // A painted or positioned pseudo-element needs a node of its own, which a merged span cannot give.
        for (const which of ["before", "after"] as const) {
          if (readPseudo(el, which, pseudoCtx)?.mode === "box") ok = false;
        }
      }
      if (ok) {
        for (const child of childrenOf(el)) {
          if (child.nodeType !== 1) continue;
          if (IGNORED_TAGS.has((child as Element).localName)) continue;
          if (!isMergeable(child as Element)) {
            ok = false;
            break;
          }
        }
      }
    }
    mergeable.set(el, ok);
    return ok;
  }

  const isAtomic = (el: Element) => ATOMIC_INLINE.has(cs(el).display);

  /** Whether a text group item shows text outside any atomic inline. */
  function holdsText(item: Item): boolean {
    if (isPseudoItem(item)) return item.pseudo.text.trim() !== "";
    if (item.nodeType === 3) return (item.nodeValue ?? "").trim() !== "";
    if (item.nodeType !== 1 || isAtomic(item as Element)) return false;
    return inlineItems(item as Element).some(holdsText);
  }

  /** Whether a text group item is, or holds, an atomic inline. */
  function holdsAtomic(item: Item): boolean {
    if (isPseudoItem(item) || item.nodeType !== 1) return false;
    return isAtomic(item as Element) || childrenOf(item as Element).some(holdsAtomic);
  }

  /** Whether an item adds to the text of the block it sits in. */
  function showsText(item: Item): boolean {
    if (isPseudoItem(item) || item.nodeType === 3) return holdsText(item);
    if (item.nodeType !== 1 || !isMergeable(item as Element)) return false;
    return inlineItems(item as Element).some(showsText);
  }

  /** Whether any text shows inside an item, however deep and whatever kind of box holds it. */
  function holdsAnyText(item: Item): boolean {
    if (isPseudoItem(item) || item.nodeType === 3) return holdsText(item);
    if (item.nodeType !== 1) return false;
    const e = item as Element;
    if (IGNORED_TAGS.has(e.localName) || isPrivate(e) || cs(e).display === "none") return false;
    return inlineItems(e).some(holdsAnyText);
  }

  /** The element that holds all of `el`'s text, if one does. A box with no text, like an icon, may sit beside it. */
  function soleTextElement(el: Element): Element | null {
    const items = inlineItems(el);
    const inBox = (item: Item) =>
      !isPseudoItem(item) && item.nodeType === 1 && !isMergeable(item as Element);
    if (items.some((item) => inBox(item) && holdsAnyText(item))) return null;
    const shown = items.filter(showsText);
    const only = shown[0];
    return only && shown.length === 1 && !isPseudoItem(only) && only.nodeType === 1
      ? (only as Element)
      : null;
  }

  /** A repeated custom element would be a component, so it stays out of the text around it. */
  const staysElement = (el: Element, parent: Element) =>
    repeatedTags.has(el.localName) && soleTextElement(parent) === el;

  /**
   * A merged element has no node to keep a hover on, so one that is all of its parent's text hands
   * its colour and decoration to the parent, with the colour its own text rests at. What it does to
   * its own box would land on the parent's, so that is counted. The elements it read go in
   * `liftedHovers`; any other merged hover is lost, and counted.
   */
  function liftedHover(parent: Element): Hover | undefined {
    if (hovers.size === 0) return undefined;
    const merged = soleTextElement(parent);
    if (!merged || staysElement(merged, parent)) return undefined;
    const lifted: Hover = {};
    const own = hovers.get(merged);
    if (own) {
      liftedHovers.add(merged);
      const { color, decoration, restingColor: _rest, ...box } = own;
      if (color) {
        lifted.color = color;
        lifted.restingColor = colorOf(cs(merged).color);
      }
      if (decoration !== undefined) lifted.decoration = decoration;
      if (Object.keys(box).length > 0) reportHover("hover-partial", 1);
    }
    const all = { ...lifted, ...liftedHover(merged) };
    return Object.keys(all).length > 0 ? all : undefined;
  }

  /**
   * Gives generated rects a position from the real rects around them: `::before` ends where the
   * next real rect starts, `::after` starts where the previous one ends. With no real rect on the
   * needed side the nearest other side is used, and with none at all the parent's content edge.
   * A canvas cannot measure generated content, so none of these has a rect of its own.
   */
  function placeGenerated(rects: Rect[], parent: Element) {
    if (!rects.some((r) => r.gen)) return;
    const placed = new Set<Rect>();
    const at = (r: Rect, x: number, anchor: Box) => {
      r.x = round2(x);
      r.y = anchor.y;
      r.h = anchor.h;
      placed.add(r);
    };
    let prev: Rect | undefined;
    for (const r of rects) {
      if (!r.gen) prev = r;
      else if (r.gen === "after" && prev) {
        at(r, prev.x + prev.w, prev);
        prev = r;
      }
    }
    let next: Rect | undefined;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i] as Rect;
      if (!r.gen) next = r;
      else if (r.gen === "before" && next) {
        at(r, next.x - r.w, next);
        next = r;
      }
    }
    const real = rects.filter((r) => !r.gen);
    const first = real[0];
    const last = real[real.length - 1];
    let head = first?.x ?? 0;
    let tail = last ? last.x + last.w : 0;
    let fallback: Box | undefined;
    for (const r of rects) {
      if (!r.gen || placed.has(r)) continue;
      if (first && last) {
        if (r.gen === "before") {
          at(r, tail, last);
          tail += r.w;
        } else {
          head -= r.w;
          at(r, head, first);
        }
      } else {
        if (!fallback) {
          const ps = cs(parent);
          const b = pageBox(parent.getBoundingClientRect());
          fallback = {
            x: b.x + px(ps.borderLeftWidth) + px(ps.paddingLeft),
            y: b.y + px(ps.borderTopWidth) + px(ps.paddingTop),
            w: 0,
            h: r.h,
          };
        }
        at(r, fallback.x + fallback.w, fallback);
        fallback.w += r.w;
      }
    }
  }

  /** The items a text group sees inside an element: its inline `::before`, its children, its inline `::after`. */
  function inlineItems(el: Element): Item[] {
    const out: Item[] = [];
    const before = readPseudo(el, "before", pseudoCtx);
    if (before?.mode === "inline") out.push(new PseudoItem(before));
    out.push(...childrenOf(el));
    const after = readPseudo(el, "after", pseudoCtx);
    if (after?.mode === "inline") out.push(new PseudoItem(after));
    return out;
  }

  /** Width of `text` in the font of `style`; falls back to an average glyph when no canvas exists. */
  function measure(text: string, style: CSSStyleDeclaration): number {
    const ctx = measureCtx();
    const shown =
      style.textTransform === "uppercase"
        ? text.toUpperCase()
        : style.textTransform === "lowercase"
          ? text.toLowerCase()
          : text;
    const spacing = style.letterSpacing === "normal" ? 0 : px(style.letterSpacing);
    if (!ctx) return round2(shown.length * (px(style.fontSize) * 0.5 + spacing));
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return round2(ctx.measureText(shown).width + spacing * shown.length);
  }

  function buildText(group: Item[], parent: Element, inherited: Inherited): TextNode | null {
    let text = "";
    const runs: Run[] = [];
    const rects: Rect[] = [];
    const range = doc.createRange();

    const append = (piece: string, run: Run) => {
      const start = text.length;
      text += piece;
      const last = runs[runs.length - 1];
      if (last && last.end === start && sameStyle(last, run)) last.end = text.length;
      else runs.push({ ...run, start, end: text.length });
    };

    const addText = (node: Text, parentEl: Element, up: Inherited) => {
      // A slotted text node takes its style from the slot it is assigned to, not its light parent.
      const s = cs(node.assignedSlot ?? parentEl);
      if (s.visibility !== "visible") return;
      const raw = node.nodeValue ?? "";
      const ws = s.whiteSpace;
      let piece: string;
      if (ws === "pre" || ws === "pre-wrap" || ws === "break-spaces") piece = raw;
      else if (ws === "pre-line") piece = raw.replace(/[ \t\f\r]+/g, " ");
      else piece = raw.replace(/[ \t\n\r\f]+/g, " ");
      const collapses = ws !== "pre" && ws !== "pre-wrap" && ws !== "break-spaces";
      if (collapses && piece.startsWith(" ") && (text === "" || /[ \n]$/.test(text))) {
        piece = piece.slice(1);
      }
      if (!piece) return;
      range.selectNodeContents(node);
      let any = false;
      for (const r of range.getClientRects()) {
        if (area(r) <= 0) continue;
        any = true;
        rects.push(pageBox(r));
      }
      if (!any) return;
      append(piece, inherit(runOf(s, 0, 0, up.clipped), up));
    };

    const addPseudo = (p: Pseudo, up: Inherited) => {
      noteApproximations(p, undefined, pseudoCtx);
      const s = p.style;
      if (s.visibility !== "visible") return;
      const ws = s.whiteSpace;
      let piece = collapse(p.text, ws);
      const collapses = ws !== "pre" && ws !== "pre-wrap" && ws !== "break-spaces";
      if (collapses && piece.startsWith(" ") && (text === "" || /[ \n]$/.test(text))) {
        piece = piece.slice(1);
      }
      if (!piece) return;
      const lineH = px(s.lineHeight) || px(s.fontSize) * 1.2;
      rects.push({ x: 0, y: 0, w: measure(piece, s), h: round2(lineH), gen: p.which });
      append(piece, inherit(runOf(s, 0, 0, up.clipped || clipsToText(s)), up));
    };

    const addNodes = (nodes: Iterable<Item>, styleEl: Element, up: Inherited) => {
      for (const n of nodes) {
        if (isPseudoItem(n)) {
          addPseudo(n.pseudo, up);
        } else if (n.nodeType === 3) {
          addText(n as Text, styleEl, up);
        } else if (n.nodeType === 1) {
          const e = n as Element;
          if (IGNORED_TAGS.has(e.localName)) continue;
          if (e.localName === "br") {
            text = text.replace(/ +$/, "");
            // Earlier runs may extend over the spaces just removed.
            while (runs.length > 0) {
              const tail = runs[runs.length - 1] as Run;
              if (tail.start >= text.length) runs.pop();
              else {
                tail.end = Math.min(tail.end, text.length);
                break;
              }
            }
            append("\n", inherit(runOf(cs(e), 0, 0, up.clipped), up));
          } else {
            if (hovers.has(e) && !liftedHovers.has(e)) reportHover("hover-partial", 1);
            addNodes(inlineItems(e), e, inside(e, cs(e), up));
          }
        }
      }
    };
    addNodes(group, parent, inherited);
    placeGenerated(rects, parent);

    const trimmed = text.replace(/[ \n]+$/, "");
    if (!trimmed || rects.length === 0) return null;
    const finalRuns = runs
      .map((r) => ({ ...r, end: Math.min(r.end, trimmed.length) }))
      .filter((r) => r.end > r.start);

    // Rects in flow order; one line per run of rects that share a row.
    const lines: Box[] = [];
    for (const r of rects) {
      const line = lines[lines.length - 1];
      if (line) {
        const overlap = Math.min(line.y + line.h, r.y + r.h) - Math.max(line.y, r.y);
        if (overlap > 0.5 * Math.min(line.h, r.h)) {
          const x = Math.min(line.x, r.x);
          const y = Math.min(line.y, r.y);
          line.w = round2(Math.max(line.x + line.w, r.x + r.w) - x);
          line.h = round2(Math.max(line.y + line.h, r.y + r.h) - y);
          line.x = x;
          line.y = y;
          continue;
        }
      }
      lines.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
    const left = Math.min(...lines.map((l) => l.x));
    const top = Math.min(...lines.map((l) => l.y));
    const right = Math.max(...lines.map((l) => l.x + l.w));
    const bottom = Math.max(...lines.map((l) => l.y + l.h));
    const n = nextId();
    if (n === null) return null;
    return {
      id: `n${n}`,
      kind: "text",
      box: { x: left, y: top, w: round2(right - left), h: round2(bottom - top) },
      paintOrder: n,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag: parent.localName },
      text: trimmed,
      lines,
      runs: finalRuns,
    };
  }

  // ---------- Form controls

  /**
   * Text shown for a form control. The live value of an editable field is never read:
   * a text-like input or textarea yields its `placeholder` attribute only, so typed
   * secrets cannot leak through a toggled `type` or a missing `autocomplete`.
   */
  function controlText(el: Element): { value: string; placeholder: boolean } | null {
    if (el instanceof win.HTMLInputElement) {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (NO_TEXT_INPUTS.has(type)) return null;
      if (BUTTON_INPUTS.has(type)) return { value: el.value, placeholder: false };
      return el.placeholder ? { value: el.placeholder, placeholder: true } : null;
    }
    if (el instanceof win.HTMLTextAreaElement) {
      return el.placeholder ? { value: el.placeholder, placeholder: true } : null;
    }
    if (el instanceof win.HTMLSelectElement && !el.multiple) {
      const label = el.selectedOptions[0]?.text.trim();
      return label ? { value: label, placeholder: false } : null;
    }
    return null;
  }

  function controlNode(el: Element, s: CSSStyleDeclaration, box: Box): TextNode | null {
    const content = controlText(el);
    if (!content?.value.trim()) return null;
    const tag = el.localName;
    const bw = (side: string) => px(s.getPropertyValue(`border-${side}-width`));
    const pad = (side: string) => px(s.getPropertyValue(`padding-${side}`));
    const inner: Box = {
      x: round2(box.x + bw("left") + pad("left")),
      y: round2(box.y + bw("top") + pad("top")),
      w: round2(Math.max(0, box.w - bw("left") - bw("right") - pad("left") - pad("right"))),
      h: round2(Math.max(0, box.h - bw("top") - bw("bottom") - pad("top") - pad("bottom"))),
    };
    return boxedText(content.value, s, inner, tag, content.placeholder);
  }

  /**
   * A text node for a string the page does not hold in a text node (a control's label, generated
   * content), set in `inner`. A textarea starts at the top of its box rather than centring one line
   * in it, so its first line is one line tall and the mapper's leading correction leaves it there.
   */
  function boxedText(
    value: string,
    s: CSSStyleDeclaration,
    inner: Box,
    tag: string,
    dim = false,
    clipped = false
  ): TextNode | null {
    const run = runOf(s, 0, value.length, clipped);
    if (dim) run.color = { ...run.color, a: round2(run.color.a * 0.5) } as Rgba;
    const line =
      tag === "textarea" && run.lineHeight !== null ? { ...inner, h: run.lineHeight } : inner;
    const n = nextId();
    if (n === null) return null;
    return {
      id: `n${n}`,
      kind: "text",
      box: inner,
      paintOrder: n,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      semantic: { tag },
      text: value,
      lines: [line],
      runs: [run],
    };
  }

  // ---------- Elements

  /** An SVG's accessible name from `aria-labelledby` or a first-child `<title>`; text only. */
  function svgName(el: Element): string {
    const tree = el.getRootNode() as Partial<Document>;
    const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    const named = ids
      .map((id) => {
        const label = tree.getElementById?.(id);
        return label ? publicText(label).trim() : "";
      })
      .filter(Boolean)
      .join(" ");
    return named;
  }

  function svgTitle(el: Element): string {
    const first = el.firstElementChild;
    return first?.localName === "title" ? (first.textContent?.trim() ?? "") : "";
  }

  /**
   * The first class token, when it could be a name: plain word characters, at most 40 long, not
   * hashed (a digit with a letter, or a CSS-in-JS prefix). Anything with `=`, `:` or `/` is out.
   */
  function nameToken(raw: string): string | undefined {
    const token = raw.trim().split(/\s+/)[0] ?? "";
    if (token.length === 0 || token.length > 40 || !/^[A-Za-z][\w-]*$/.test(token))
      return undefined;
    if (/\d/.test(token) && /[a-z]/i.test(token)) return undefined;
    if (/^(?:css|sc|jsx|svelte|astro|emotion|styled|chakra|mui)[-_]/i.test(token)) return undefined;
    return token;
  }

  const classToken = (el: Element) => nameToken(el.getAttribute("class") ?? "");
  const idToken = (el: Element) => nameToken(el.getAttribute("id") ?? "");

  function semanticOf(el: Element): ElementNode["semantic"] {
    const tag = el.localName;
    const semantic: ElementNode["semantic"] = { tag };
    const role = el.getAttribute("role");
    if (role) semantic.role = role;
    const label = el.getAttribute("aria-label");
    // aria-labelledby wins over aria-label; for an SVG a first-child title is the last resort.
    const isSvg = tag === "svg" && el.namespaceURI === SVG_NS;
    const name = (isSvg && svgName(el)) || label || (isSvg && svgTitle(el)) || "";
    if (name) semantic.ariaLabel = name;
    if (/^h[1-6]$/.test(tag)) semantic.headingLevel = Number(tag[1]);
    const landmark = LANDMARK_TAGS[tag];
    if (landmark) semantic.landmark = landmark;
    if (tag === "a" && el.namespaceURI === XHTML && el.hasAttribute("href")) {
      const href = (el as HTMLAnchorElement).href;
      // The rest of a `mailto:`, `tel:` or app link is a person's address, not a page.
      if (STORED_LINK.test(href)) semantic.href = cleanUrl(href);
    }
    const alt = el.getAttribute("alt");
    if (alt !== null && alt !== "") semantic.alt = alt;
    const className = classToken(el);
    if (className) semantic.className = className;
    const idName = idToken(el);
    if (idName) semantic.id = idName;
    return semantic;
  }

  function boxOf(el: Element, s: CSSStyleDeclaration): Box {
    const r = el.getBoundingClientRect();
    // A transformed element's rect is the bounding box of the transformed shape,
    // so use its untransformed offset size, centred on the same point.
    if (s.transform !== "none" && el instanceof win.HTMLElement && el.offsetWidth > 0) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      return {
        x: round2(r.left + r.width / 2 - w / 2 + scrollX),
        y: round2(r.top + r.height / 2 - h / 2 + scrollY),
        w,
        h,
      };
    }
    return pageBox(r);
  }

  function warn(code: string, nodeId: string | undefined, detail: string) {
    const seen = warnings.get(code);
    if (seen) seen.count++;
    else warnings.set(code, { first: { code, ...(nodeId ? { nodeId } : {}), detail }, count: 1 });
  }

  const warnStops = (nodeId: string) =>
    warn("gradient-stops", nodeId, "A gradient was cut off at the limit on colour stops");

  /** `warn`, counted `count` times. */
  function warnEach(count: number, code: string, nodeId: string, detail: string) {
    for (let i = 0; i < count; i++) warn(code, nodeId, detail);
  }

  const warnEditable = () =>
    warn(
      "editable-skipped",
      undefined,
      "Editable elements were left empty, so nothing typed into them is in the file"
    );

  function placeholder(
    base: Omit<PlaceholderNode, "kind" | "placeholderKind" | "sourceUrl">,
    placeholderKind: PlaceholderNode["placeholderKind"],
    sourceUrl?: string
  ): PlaceholderNode {
    return {
      ...base,
      kind: "placeholder",
      placeholderKind,
      ...(sourceUrl ? { sourceUrl: cleanUrl(sourceUrl) } : {}),
    };
  }

  function imageNode(
    common: Omit<ImageNode, "kind" | "fit" | "objectPosition" | "borders" | "borderRadius">,
    sourceUrl: string | undefined,
    s: CSSStyleDeclaration,
    box: Box
  ): ImageNode {
    const fitRaw = s.objectFit;
    const fit: ImageNode["fit"] =
      fitRaw === "cover" || fitRaw === "contain" || fitRaw === "none" || fitRaw === "fill"
        ? fitRaw
        : fitRaw === "scale-down"
          ? "contain"
          : "fill";
    const node: ImageNode = {
      ...common,
      kind: "image",
      ...(sourceUrl ? { sourceUrl: cleanUrl(sourceUrl) } : {}),
      fit,
      objectPosition: s.objectPosition,
      borders: readBorders(s),
      borderRadius: readRadii(s, box.w, box.h),
    };
    if (sourceUrl) rememberUrl(node, sourceUrl);
    return node;
  }

  /** Computed layout, plus what only the element itself can still tell: auto margins and `fr` tracks. */
  function layoutOf(el: Element, s: CSSStyleDeclaration): ElementNode["layout"] {
    const layout = readLayout(s);
    if (layout.margin.some((m) => m > 0)) {
      const marginAuto = readMarginAuto(el);
      if (marginAuto) layout.marginAuto = marginAuto;
    }
    if (layout.gridTemplateColumns !== undefined) {
      const { columns, rows } = authoredTracks(el);
      if (columns) layout.authoredGridTemplateColumns = columns;
      if (rows) layout.authoredGridTemplateRows = rows;
    }
    return layout;
  }

  /** `inherited` is what is in effect inside `el`. */
  function visitChildren(el: Element, depth: number, inherited: Inherited): CaptureNode[] {
    const out: CaptureNode[] = [];
    let group: Item[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const items = group;
      group = [];
      // An atomic inline joins a sentence, not its neighbours: with no text to join it stays a box.
      if (!items.some(holdsText) && items.some(holdsAtomic)) {
        for (const item of items.filter(holdsAtomic)) {
          out.push(...visit(item as Element, depth + 1, false, inherited));
        }
        return;
      }
      const node = buildText(items, el, inherited);
      if (node) out.push(node);
    };
    const generated = (which: Which) => {
      const p = readPseudo(el, which, pseudoCtx);
      if (!p) return;
      // An inline pseudo-element is a text node below `el`; a box one is an element and its text.
      if (depth + (p.mode === "inline" ? 1 : 2) > MAX_DEPTH) {
        warn("depth-limit", undefined, `Subtree below depth ${MAX_DEPTH} was not captured`);
      } else if (p.mode === "inline") {
        group.push(new PseudoItem(p));
      } else {
        flush();
        out.push(...pseudoNodes(el, which, pseudoCtx, inherited));
      }
    };
    generated("before");
    for (const child of childrenOf(el)) {
      if (child.nodeType === 3) {
        group.push(child);
      } else if (child.nodeType === 1) {
        const e = child as Element;
        if (IGNORED_TAGS.has(e.localName)) continue;
        if (isMergeable(e) && !staysElement(e, el)) {
          group.push(e);
        } else {
          flush();
          out.push(...visit(e, depth + 1, false, inherited));
        }
      }
    }
    generated("after");
    flush();
    return out;
  }

  /** The one element a collapsible wrapper holds, or null when `el` is not such a wrapper. */
  function wrappedChild(el: Element, s: CSSStyleDeclaration): Element | null {
    if (el === root || el === doc.body || el.namespaceURI !== XHTML) return null;
    if (KEPT_WRAPPER_TAGS.has(el.localName) || isEditable(el) || hovers.has(el)) return null;
    if (!/^(block|flex|grid|flow-root)$/.test(s.display)) return null;
    if (s.position !== "static" || s.zIndex !== "auto" || s.visibility !== "visible") return null;
    if (s.transform !== "none" || s.filter !== "none" || s.mixBlendMode !== "normal") return null;
    if (s.opacity !== "1" || s.overflowX !== "visible" || s.overflowY !== "visible") return null;
    const backdrop = s.getPropertyValue("backdrop-filter");
    if (backdrop && backdrop !== "none") return null;
    if (s.getPropertyValue("clip-path") !== "none" || s.getPropertyValue("mask-image") !== "none") {
      return null;
    }
    const layout = readLayout(s);
    if (layout.padding.some((p) => p > 0) || layout.gap?.some((g) => g > 0)) return null;
    const style = readStyle(s, 0, 0);
    if (
      style.backgroundColor.a > 0 ||
      style.backgroundImages.length > 0 ||
      style.boxShadows.length > 0 ||
      style.borders.top.width > 0 ||
      style.borders.right.width > 0 ||
      style.borders.bottom.width > 0 ||
      style.borders.left.width > 0
    ) {
      return null;
    }
    const semantic = semanticOf(el);
    if (
      semantic.role ||
      semantic.ariaLabel ||
      semantic.headingLevel ||
      semantic.landmark ||
      semantic.href ||
      semantic.alt
    ) {
      return null;
    }
    if (readPseudo(el, "before", pseudoCtx) || readPseudo(el, "after", pseudoCtx)) return null;
    let only: Element | null = null;
    for (const child of childrenOf(el)) {
      if (child.nodeType === 3) {
        if ((child.nodeValue ?? "").trim() !== "") return null;
      } else if (child.nodeType === 1) {
        const e = child as Element;
        if (IGNORED_TAGS.has(e.localName) || cs(e).display === "none") continue;
        // A second child, or one that is inline and would join a line of text.
        if (only || isMergeable(e) || cs(e).display === "contents") return null;
        only = e;
      }
    }
    return only;
  }

  function visit(el: Element, depth: number, isRoot: boolean, up: Inherited): CaptureNode[] {
    if (IGNORED_TAGS.has(el.localName)) return [];
    if (el instanceof win.HTMLInputElement && el.type === "hidden") return [];
    const s = cs(el);
    if (s.display === "none") return [];
    const inherited = inside(el, s, up);
    if (s.display === "contents") {
      if (!isEditable(el)) return visitChildren(el, depth - 1, inherited);
      warnEditable();
      return [];
    }

    if (env.collapseWrappers) {
      const only = depth < MAX_DEPTH ? wrappedChild(el, s) : null;
      if (only) return visit(only, depth + 1, false, inherited);
    }

    const box = boxOf(el, s);
    const clipped = el !== doc.body && (s.overflowX !== "visible" || s.overflowY !== "visible");
    if (!isRoot && boxArea(box) <= 0 && clipped) return [];

    const n = nextId();
    if (n === null) return [];
    const id = `n${n}`;
    const common = {
      id,
      box,
      paintOrder: n,
      ...readZIndex(s, el.parentElement ? cs(el.parentElement).display : ""),
      visible: s.visibility !== "hidden",
      opacity: Math.min(1, Math.max(0, Number.parseFloat(s.opacity))) || 0,
      blendMode: s.mixBlendMode,
      ...(readTransform(s.transform) ? { transform: readTransform(s.transform) } : {}),
      semantic: semanticOf(el),
    };
    const leaf = { ...common, ...readFlow(el, s) };
    const tag = el.localName;

    // These nodes carry no style, so a filter on one cannot reach the plan.
    if ((tag === "img" || tag === "svg" || tag === "video") && s.filter !== "none") {
      const names = parseFilters(s.filter).map((f) => f.split("(")[0]);
      warn(
        "filter-on-leaf",
        id,
        `A filter (${names.join(", ")}) on an image, SVG or video was not imported`
      );
    }

    if (!isRoot && boxArea(box) <= 0 && ["img", "svg", "canvas", "video", "iframe"].includes(tag)) {
      return [];
    }

    if (el.namespaceURI === SVG_NS && tag === "svg") {
      const report = emptySvgReport();
      let markup = "";
      let why = "it could not be serialised";
      try {
        markup = serialiseSvg(el as SVGSVGElement, report);
        if (utf8Length(markup) > MAX_SVG_BYTES) {
          why = `it is over ${MAX_SVG_BYTES / 1024} KiB`;
          markup = "";
        }
      } catch (e) {
        if (e instanceof SvgTooLargeError) why = "it has too many elements";
      }
      if (markup === "") {
        warn("svg-too-large", id, `An inline SVG was left as a placeholder: ${why}`);
        return [placeholder(leaf, "blocked-image")];
      }
      warnEach(
        report.transform3d,
        "svg-3d-transform",
        id,
        "A 3D transform inside an inline SVG was left out"
      );
      warnEach(
        report.externalRefs,
        "svg-external-ref",
        id,
        "An inline SVG used an image or shape from another file, which was left out"
      );
      warnEach(
        report.foreignObjects,
        "svg-foreign-object",
        id,
        "HTML inside an inline SVG (foreignObject) was left out"
      );
      return [
        {
          ...leaf,
          kind: "svg",
          markup,
          overflow: s.overflowX === s.overflowY ? s.overflowX : `${s.overflowX} ${s.overflowY}`,
        },
      ];
    }
    if (el.namespaceURI === XHTML) {
      if (tag === "canvas") return [placeholder(leaf, "canvas")];
      if (tag === "video") {
        const v = el as HTMLVideoElement;
        // A poster is an image like any other: collectAssets fetches it, or turns it into a
        // placeholder when it cannot be read.
        if (v.poster) return [imageNode(leaf, v.poster, s, box)];
        return [placeholder(leaf, "video", v.currentSrc || undefined)];
      }
      if (tag === "iframe") {
        return [
          placeholder(leaf, "cross-origin-iframe", (el as HTMLIFrameElement).src || undefined),
        ];
      }
      if (tag === "img") {
        const img = el as HTMLImageElement;
        const sourceUrl = img.currentSrc || img.src || undefined;
        if (img.complete && img.naturalWidth === 0) {
          return [placeholder(leaf, "blocked-image", sourceUrl)];
        }
        return [imageNode(leaf, sourceUrl, s, box)];
      }
    }

    if (depth >= MAX_DEPTH && (el.firstChild || shadowRootOf(el, env))) {
      warn("depth-limit", id, `Subtree below depth ${MAX_DEPTH} was not captured`);
      return [placeholder(leaf, "blocked-image")];
    }

    const element: ElementNode = {
      ...common,
      kind: "element",
      style: readStyle(s, box.w, box.h, () => warnStops(id)),
      layout: layoutOf(el, s),
      children: [],
    };
    // Overflow on these two propagates to the viewport instead of clipping the element itself.
    if (el === root || el === doc.body) element.style.overflow = "visible";
    const stored = hovers.get(el);
    // What text inherits at rest, so the mapper can tell it from text with a colour of its own.
    const hover = stored?.color ? { ...stored, restingColor: colorOf(s.color) } : stored;
    const lifted = liftedHover(el);
    if (hover || lifted) element.hover = { ...hover, ...lifted };

    const leafControl = tag === "input" || tag === "textarea" || tag === "select";
    if (isEditable(el)) {
      // What a person typed: the box and style stay, and nothing inside is read.
      warnEditable();
    } else if (leafControl) {
      // A secret field keeps its box and style; nothing inside it is read.
      if (depth < MAX_DEPTH && !isSecretField(el)) {
        const t = controlNode(el, s, box);
        if (t) element.children.push(t);
      }
    } else {
      element.children = visitChildren(el, depth, inherited);
    }

    if (isRoot) {
      if (element.style.backgroundColor.a === 0 && doc.body) {
        element.style.backgroundColor = colorOf(cs(doc.body).backgroundColor);
      }
      element.box.w = Math.max(element.box.w, root.scrollWidth);
      element.box.h = Math.max(element.box.h, root.scrollHeight);
    } else if (boxArea(box) <= 0 && element.children.length === 0) {
      return [];
    }
    return [element];
  }

  // Hover differences are read once, up front, from the stylesheets; the walk only looks them up.
  let hovers = new Map<Element, Hover>();
  let repeatedTags = new Set<string>();
  const liftedHovers = new WeakSet<Element>();
  const reportHover: HoverDeps["report"] = (code, count) =>
    warnEach(
      count,
      code,
      "",
      code === "hover-unreadable"
        ? "A stylesheet could not be read, so its :hover rules were left out"
        : code === "hover-stopped"
          ? "Reading :hover rules stopped at its time or rule limit, so later ones were left out"
          : "A :hover rule was only partly read, so part of it was left out"
    );
  try {
    const found = hoverCandidates(doc, env);
    repeatedTags = found.repeatedTags;
    hovers = readHover(found.roots, found.candidates, {
      win,
      computed: cs,
      now: () => win.performance.now(),
      report: reportHover,
    });
  } catch {
    warn("hover-unreadable", undefined, "Hover styles could not be read");
  }

  const [tree] = visit(root, 1, true, {
    link: undefined,
    decoration: "none",
    clipped: false,
  });
  if (tree?.kind !== "element") throw new Error("The document has no root element");

  // ---------- Tokens

  const cssCustomProperties: Record<string, string> = {};
  try {
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof win.CSSStyleRule)) continue;
        if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) continue;
        for (const name of Array.from(rule.style)) {
          if (!name.startsWith("--")) continue;
          const value = rule.style.getPropertyValue(name).trim();
          if (isTokenValue(value, (v) => win.CSS.supports("color", v))) {
            cssCustomProperties[name] = value;
          }
        }
      }
    }
  } catch {
    // tokens are best effort
  }
  const sortedTokens = Object.fromEntries(
    Object.entries(cssCustomProperties).sort(([a], [b]) => (a < b ? -1 : 1))
  );

  const dark = win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return {
    schemaVersion: 1,
    capturedAt: env.now(),
    tool: { name: "frottage", version: env.toolVersion },
    source: {
      url: cleanUrl(win.location.href),
      title: doc.title,
      viewport: { w: root.clientWidth, h: root.clientHeight },
      scrollSize: { w: root.scrollWidth, h: root.scrollHeight },
      devicePixelRatio: win.devicePixelRatio,
      colorScheme: dark ? "dark" : "light",
    },
    tokens: { cssCustomProperties: sortedTokens },
    fonts: [...fonts.values()],
    assets: [],
    warnings: [...warnings.values()].map(({ first, count }) =>
      count > 1 ? { ...first, detail: `${first.detail} (${count} times)` } : first
    ),
    root: tree,
  };
}
