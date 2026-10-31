import { parseComputedColor } from "./color";

/**
 * Serialises an inline `<svg>` so it can be rebuilt in Figma without the page around it.
 *
 * The result is built, not cloned: every element is created fresh from the original's name and a
 * filtered copy of its attributes, so nothing the filter does not know about can come along, and
 * nothing is read from a form control. Computed `fill`, `stroke`, `opacity`, `color` and friends
 * are written as attributes, `currentColor` is resolved, and `<use>` is inlined from the same tree
 * (so it works inside shadow roots). Scripts, event handlers, styles, animation, `foreignObject`
 * and any reference that leaves the document are dropped. References to `#id` stay; they are not
 * URLs to a page.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Largest markup a capture keeps for one SVG; larger ones stay placeholders. */
export const MAX_SVG_BYTES = 256 * 1024;
/** Elements one SVG may grow to, counting what `<use>` expands; stops reference bombs early. */
const MAX_ELEMENTS = 4000;
const MAX_USE_DEPTH = 6;

/** Thrown when an SVG outgrows its element budget before it is serialised. */
export class SvgTooLargeError extends Error {}

const DROP_TAGS = new Set([
  "script",
  "style",
  "foreignobject",
  "set",
  "animate",
  "animatetransform",
  "animatemotion",
  "discard",
  "title",
  "desc",
  "metadata",
]);
/** Containers whose children are definitions, not drawing; their `display` does not apply. */
const DEFINITIONS = new Set([
  "defs",
  "symbol",
  "clippath",
  "mask",
  "marker",
  "pattern",
  "lineargradient",
  "radialgradient",
  "filter",
]);
const LEAVES = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textpath",
]);
const TEXTY = new Set(["text", "tspan", "textpath"]);
/** Properties a child takes from its parent; the leaves carry the computed value, containers do not. */
const INHERITED = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "clip-rule",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
];
const REFERENCING = ["clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"];

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;
const EXTERNAL_URL = /url\(\s*(['"]?)\s*(?!#)/i;
const LOCAL_URL = /url\(\s*['"]?\s*(#[^'")\s]+)\s*['"]?\s*\)/i;

const round3 = (n: number) => String(Math.round(n * 1000) / 1000);
const hex2 = (n: number) =>
  Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, "0");

type State = {
  doc: Document;
  win: Window & typeof globalThis;
  tree: Node;
  elements: number;
  /** Ids referenced by what was copied. */
  refs: Set<string>;
  /** Ids present in the copy. */
  have: Set<string>;
  tried: Set<string>;
};

type Flags = {
  /** Properties some ancestor inside the current `<use>` target declares itself. */
  explicit: Set<string>;
  /** The `<use>` whose style the target inherits, or null outside an instance. */
  from: Element | null;
  inDefs: boolean;
  depth: number;
  stack: Element[];
};

function colorValue(value: string): { value: string; alpha: number } | null {
  const v = value.trim();
  if (v === "") return null;
  if (v === "none") return { value: "none", alpha: 1 };
  const local = LOCAL_URL.exec(v);
  if (local) return { value: `url(${local[1]})`, alpha: 1 };
  if (/url\(/i.test(v)) return { value: "none", alpha: 1 };
  const c = parseComputedColor(v);
  if (!c) return null;
  return { value: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`, alpha: c.a };
}

function idOf(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

function lookup(st: State, id: string): Element | null {
  const root = st.tree as Partial<Document>;
  const hit = typeof root.getElementById === "function" ? root.getElementById(id) : null;
  return hit && hit.namespaceURI === SVG_NS ? hit : null;
}

function declares(el: Element, prop: string): boolean {
  return el.hasAttribute(prop) || ((el as SVGElement).style?.getPropertyValue(prop) ?? "") !== "";
}

function copyAttributes(st: State, orig: Element, clone: Element, color: string) {
  for (const a of Array.from(orig.attributes)) {
    const name = a.name;
    const lower = name.toLowerCase();
    if (
      lower.startsWith("on") ||
      lower.startsWith("xmlns") ||
      lower.startsWith("data-") ||
      lower === "style" ||
      lower === "class" ||
      lower === "color" ||
      lower === "xml:base"
    ) {
      continue;
    }
    let value = a.value;
    if (lower === "href" || lower === "xlink:href") {
      const target = value.trim();
      if (target.startsWith("#")) st.refs.add(idOf(target.slice(1)));
      else if (!DATA_IMAGE.test(target)) continue;
      if (a.namespaceURI === XLINK_NS) clone.setAttributeNS(XLINK_NS, "xlink:href", target);
      else clone.setAttribute("href", target);
      continue;
    }
    if (/javascript:/i.test(value) || EXTERNAL_URL.test(value)) continue;
    const local = LOCAL_URL.exec(value);
    if (local) st.refs.add(idOf((local[1] as string).slice(1)));
    value = value.replace(/currentcolor/gi, color);
    clone.setAttribute(name, value);
  }
}

function inlineStyle(st: State, orig: Element, clone: Element, s: CSSStyleDeclaration, f: Flags) {
  const tag = orig.localName.toLowerCase();
  const set = (name: string, value: string) => clone.setAttribute(name, value);
  const ref = (value: string) => {
    const m = LOCAL_URL.exec(value);
    if (m) st.refs.add(idOf((m[1] as string).slice(1)));
  };
  // Inside a <use> instance, what the target does not declare itself comes from the <use>.
  const own = (prop: string) =>
    f.from && !f.explicit.has(prop)
      ? f.from.ownerDocument.defaultView?.getComputedStyle(f.from)
      : s;
  const read = (prop: string) => (own(prop) ?? s).getPropertyValue(prop);

  for (const prop of REFERENCING) {
    const v = s.getPropertyValue(prop);
    const m = LOCAL_URL.exec(v);
    if (m) {
      set(prop, `url(${m[1]})`);
      ref(v);
    }
  }
  if (tag === "stop") {
    const c = colorValue(s.getPropertyValue("stop-color"));
    if (c?.value.startsWith("#")) set("stop-color", c.value);
    const o = Number.parseFloat(s.getPropertyValue("stop-opacity"));
    const alpha = (Number.isFinite(o) ? o : 1) * (c?.alpha ?? 1);
    if (alpha !== 1) set("stop-opacity", round3(alpha));
  }
  if (!LEAVES.has(tag)) return;

  // `fill="currentColor"` written on the target reads the <use>'s colour, not the sprite's.
  const colorOfSource = () => f.from?.ownerDocument.defaultView?.getComputedStyle(f.from).color;
  const paint = (prop: "fill" | "stroke") => {
    let raw = read(prop);
    if (f.from && /^currentcolor$/i.test((orig.getAttribute(prop) ?? "").trim())) {
      raw = colorOfSource() ?? raw;
    }
    const c = colorValue(raw);
    if (!c) return null;
    ref(c.value);
    // A default stroke is left out; every other value is written, so no ancestor decides it.
    if (prop === "fill" || c.value !== "none") set(prop, c.value);
    return c;
  };
  const fill = paint("fill");
  const stroke = paint("stroke");
  const opacityOf = (prop: string, base: number) => {
    const n = Number.parseFloat(read(prop));
    const v = (Number.isFinite(n) ? n : 1) * base;
    if (v !== 1) set(prop, round3(v));
  };
  if (fill && fill.value !== "none") opacityOf("fill-opacity", fill.alpha);
  if (stroke && stroke.value !== "none") {
    opacityOf("stroke-opacity", stroke.alpha);
    const width = Number.parseFloat(read("stroke-width"));
    if (Number.isFinite(width)) set("stroke-width", round3(width));
    const cap = read("stroke-linecap");
    if (cap && cap !== "butt") set("stroke-linecap", cap);
    const join = read("stroke-linejoin");
    if (join && join !== "miter") set("stroke-linejoin", join);
    const miter = Number.parseFloat(read("stroke-miterlimit"));
    if (Number.isFinite(miter) && miter !== 4) set("stroke-miterlimit", round3(miter));
    const dash = read("stroke-dasharray");
    if (dash && dash !== "none") {
      set("stroke-dasharray", dash.replace(/px/g, ""));
      const offset = Number.parseFloat(read("stroke-dashoffset"));
      if (Number.isFinite(offset) && offset !== 0) set("stroke-dashoffset", round3(offset));
    }
  }
  const rule = read("fill-rule");
  if (rule && rule !== "nonzero") set("fill-rule", rule);
  const clip = read("clip-rule");
  if (clip && clip !== "nonzero") set("clip-rule", clip);
  const visibility = read("visibility");
  if (visibility && visibility !== "visible") set("visibility", "hidden");
  if (TEXTY.has(tag)) {
    for (const prop of ["font-family", "font-size", "font-weight", "font-style", "text-anchor"]) {
      const v = read(prop);
      if (v) set(prop, v.replace(/"/g, "'"));
    }
    const spacing = read("letter-spacing");
    if (spacing && spacing !== "normal") set("letter-spacing", spacing.replace(/px/g, ""));
  }
}

function copyElement(
  st: State,
  orig: Element,
  parent: Element | null,
  f: Flags,
  isRoot = false
): Element | null {
  if (orig.namespaceURI !== SVG_NS) return null;
  const tag = orig.localName.toLowerCase();
  if (DROP_TAGS.has(tag)) return null;
  if (tag === "use") {
    inlineUse(st, orig, parent as Element, f);
    return null;
  }
  const s = st.win.getComputedStyle(orig);
  const inDefs = f.inDefs || DEFINITIONS.has(tag);
  if (!isRoot && !inDefs && s.display === "none") return null;
  if (++st.elements > MAX_ELEMENTS) throw new SvgTooLargeError("too many elements");

  const clone = st.doc.createElementNS(SVG_NS, orig.localName);
  copyAttributes(st, orig, clone, colorValue(s.color)?.value ?? "#000000");
  // An image whose external source was dropped has nothing left to draw.
  if (tag === "image" && !clone.hasAttribute("href") && !clone.hasAttributeNS(XLINK_NS, "href")) {
    return null;
  }
  const id = clone.getAttribute("id");
  // A <use> instance would repeat its target's ids, and ids must stay unique.
  if (id && f.from) clone.removeAttribute("id");
  else if (id) st.have.add(id);
  // Containers carry no paint of their own: every leaf below holds its computed value.
  if (!LEAVES.has(tag)) {
    for (const prop of INHERITED) clone.removeAttribute(prop);
  }
  if (!isRoot) {
    const opacity = Number.parseFloat(s.opacity);
    if (Number.isFinite(opacity) && opacity !== 1) clone.setAttribute("opacity", round3(opacity));
    inlineStyle(st, orig, clone, s, f);
  }
  parent?.appendChild(clone);

  const explicit = new Set(f.explicit);
  for (const prop of INHERITED) if (declares(orig, prop)) explicit.add(prop);
  const childFlags: Flags = { ...f, explicit, inDefs };
  for (const child of Array.from(orig.childNodes)) {
    if (child.nodeType === 1) copyElement(st, child as Element, clone, childFlags);
    else if (child.nodeType === 3 && TEXTY.has(tag)) {
      clone.appendChild(st.doc.createTextNode(child.nodeValue ?? ""));
    }
  }
  return clone;
}

function inlineUse(st: State, use: Element, parent: Element, f: Flags) {
  const href = (use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "").trim();
  if (!href.startsWith("#") || f.depth >= MAX_USE_DEPTH) return;
  const target = lookup(st, idOf(href.slice(1)));
  if (!target || f.stack.includes(target)) return;
  const tag = target.localName.toLowerCase();
  if (DROP_TAGS.has(tag)) return;
  if (++st.elements > MAX_ELEMENTS) throw new SvgTooLargeError("too many elements");

  const s = st.win.getComputedStyle(use);
  if (s.display === "none") return;
  const wrapper = st.doc.createElementNS(SVG_NS, "g");
  const opacity = Number.parseFloat(s.opacity);
  if (Number.isFinite(opacity) && opacity !== 1) wrapper.setAttribute("opacity", round3(opacity));
  const x = Number.parseFloat(use.getAttribute("x") ?? "") || 0;
  const y = Number.parseFloat(use.getAttribute("y") ?? "") || 0;
  const transform = (use.getAttribute("transform") ?? "").trim();
  const flags: Flags = {
    explicit: new Set(),
    from: use,
    inDefs: false,
    depth: f.depth + 1,
    stack: [...f.stack, target],
  };

  if (tag === "symbol" || tag === "svg") {
    const inner = st.doc.createElementNS(SVG_NS, "svg");
    for (const name of ["viewBox", "preserveAspectRatio"]) {
      const v = target.getAttribute(name);
      if (v && !EXTERNAL_URL.test(v)) inner.setAttribute(name, v);
    }
    if (x) inner.setAttribute("x", round3(x));
    if (y) inner.setAttribute("y", round3(y));
    inner.setAttribute(
      "width",
      use.getAttribute("width") || target.getAttribute("width") || "100%"
    );
    inner.setAttribute(
      "height",
      use.getAttribute("height") || target.getAttribute("height") || "100%"
    );
    if (transform && !EXTERNAL_URL.test(transform)) wrapper.setAttribute("transform", transform);
    wrapper.appendChild(inner);
    parent.appendChild(wrapper);
    for (const prop of INHERITED) if (declares(target, prop)) flags.explicit.add(prop);
    for (const child of Array.from(target.childNodes)) {
      if (child.nodeType === 1) copyElement(st, child as Element, inner, flags);
    }
    return;
  }

  const moved = [transform, x || y ? `translate(${round3(x)} ${round3(y)})` : ""]
    .filter(Boolean)
    .join(" ");
  if (moved && !EXTERNAL_URL.test(moved)) wrapper.setAttribute("transform", moved);
  parent.appendChild(wrapper);
  copyElement(st, target, wrapper, flags);
}

export function serialiseSvg(el: SVGSVGElement): string {
  const doc = el.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const st: State = {
    doc,
    win,
    tree: el.getRootNode(),
    elements: 0,
    refs: new Set(),
    have: new Set(),
    tried: new Set(),
  };
  const flags: Flags = { explicit: new Set(), from: null, inDefs: false, depth: 0, stack: [] };
  const root = copyElement(st, el, null, flags, true);
  if (!root) throw new Error("not an svg element");

  // The rendered size, so a viewBox-only icon keeps the size the page gave it.
  const size = win.getComputedStyle(el);
  const w = Number.parseFloat(size.width);
  const h = Number.parseFloat(size.height);
  if (w > 0 && h > 0) {
    root.setAttribute("width", round3(w));
    root.setAttribute("height", round3(h));
  }

  // Paint servers, clip paths and the like that live elsewhere in the same tree (a sprite).
  let defs: Element | null = null;
  for (;;) {
    const missing = [...st.refs].filter((id) => !st.have.has(id) && !st.tried.has(id));
    if (missing.length === 0) break;
    for (const id of missing) {
      st.tried.add(id);
      const target = lookup(st, id);
      if (!target) continue;
      if (!defs) {
        defs = doc.createElementNS(SVG_NS, "defs");
        root.insertBefore(defs, root.firstChild);
      }
      copyElement(st, target, defs, { ...flags, inDefs: true });
    }
  }

  return new win.XMLSerializer().serializeToString(root);
}
