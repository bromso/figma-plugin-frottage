import type {
  Capture,
  CaptureNode,
  ElementNode,
  ImageNode,
  PlaceholderNode,
  TextNode,
} from "@repo/capture-schema";
import type { Rgba } from "./color";
import {
  colorOf,
  px,
  readBorders,
  readLayout,
  readRadii,
  readStyle,
  readTransform,
} from "./styles";
import { cleanCss, cleanUrl, rememberUrl } from "./urls";

export type CaptureEnv = {
  now: () => string;
  toolVersion: string;
  /** Reserved for Phase 3 (shadow DOM); the Phase 1 walker does not traverse shadow roots. */
  getShadowRoot?: (el: Element) => ShadowRoot | null;
};

type Box = { x: number; y: number; w: number; h: number };
type Run = TextNode["runs"][number];
type Font = Capture["fonts"][number];
type Warning = Capture["warnings"][number];

/** Matches `LIMITS.depth` in @repo/capture-schema; the root counts as depth 1. */
const MAX_DEPTH = 256;
/** Matches `LIMITS.nodes` in @repo/capture-schema; kept local so the walker stays type-only. */
const MAX_NODES = 20_000;
const XHTML = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

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

const GENERIC_FAMILIES: Record<string, string> = {
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
};

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whether a field must never be read. Looks at attributes only, never at `value`.
 * Password inputs are skipped outright, as are fields that declare a password,
 * one-time-code or card secret through `autocomplete`.
 */
function isSecretField(el: Element): boolean {
  const tag = el.localName;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
  if ((el.getAttribute("type") ?? "").trim().toLowerCase() === "password") return true;
  return SECRET_AUTOCOMPLETE.test((el.getAttribute("autocomplete") ?? "").toLowerCase());
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
  const pageBox = (r: { left: number; top: number; width: number; height: number }): Box => ({
    x: round2(r.left + scrollX),
    y: round2(r.top + scrollY),
    w: round2(r.width),
    h: round2(r.height),
  });
  const area = (r: { width: number; height: number }) => r.width * r.height;
  const boxArea = (b: Box) => b.w * b.h;

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

  function runOf(style: CSSStyleDeclaration, start: number, end: number): Run {
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
      color: colorOf(style.color),
      decoration: style.textDecorationLine || "none",
      transform: style.textTransform,
      align: align === "start" ? "left" : align === "end" ? "right" : align,
    };
  }

  const sameStyle = (a: Run, b: Run) => {
    const { start: _s1, end: _e1, ...x } = a;
    const { start: _s2, end: _e2, ...y } = b;
    return JSON.stringify(x) === JSON.stringify(y);
  };

  /** Inline elements that can merge into their block's text node. */
  function isMergeable(el: Element): boolean {
    const hit = mergeable.get(el);
    if (hit !== undefined) return hit;
    let ok = false;
    if (el.localName === "br" && el.namespaceURI === XHTML) {
      ok = true;
    } else if (
      el.namespaceURI === XHTML &&
      !NOT_TEXT.has(el.localName) &&
      !IGNORED_TAGS.has(el.localName)
    ) {
      const s = cs(el);
      ok =
        s.display === "inline" &&
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
        for (const child of el.children) {
          if (IGNORED_TAGS.has(child.localName)) continue;
          if (!isMergeable(child)) {
            ok = false;
            break;
          }
        }
      }
    }
    mergeable.set(el, ok);
    return ok;
  }

  function buildText(group: Node[], parent: Element): TextNode | null {
    let text = "";
    const runs: Run[] = [];
    const rects: Box[] = [];
    const range = doc.createRange();

    const append = (piece: string, run: Run) => {
      const start = text.length;
      text += piece;
      const last = runs[runs.length - 1];
      if (last && last.end === start && sameStyle(last, run)) last.end = text.length;
      else runs.push({ ...run, start, end: text.length });
    };

    const addText = (node: Text, styleEl: Element) => {
      const s = cs(styleEl);
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
      append(piece, runOf(s, 0, 0));
    };

    const addNodes = (nodes: Iterable<Node>, styleEl: Element) => {
      for (const n of nodes) {
        if (n.nodeType === 3) {
          addText(n as Text, styleEl);
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
            append("\n", runOf(cs(e), 0, 0));
          } else {
            addNodes(e.childNodes, e);
          }
        }
      }
    };
    addNodes(group, parent);

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
      lines.push({ ...r });
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
    const run = runOf(s, 0, content.value.length);
    if (content.placeholder) run.color = { ...run.color, a: round2(run.color.a * 0.5) } as Rgba;
    // A textarea starts at the top of its box rather than centring one line in it, so its first
    // line is one line tall and the mapper's leading correction leaves it there.
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
      semantic: { tag: el.localName },
      text: content.value,
      lines: [line],
      runs: [run],
    };
  }

  // ---------- Elements

  function semanticOf(el: Element): ElementNode["semantic"] {
    const tag = el.localName;
    const semantic: ElementNode["semantic"] = { tag };
    const role = el.getAttribute("role");
    if (role) semantic.role = role;
    const label = el.getAttribute("aria-label");
    if (label) semantic.ariaLabel = label;
    if (/^h[1-6]$/.test(tag)) semantic.headingLevel = Number(tag[1]);
    const landmarks: Record<string, string> = {
      header: "banner",
      nav: "navigation",
      main: "main",
      footer: "contentinfo",
      aside: "complementary",
      form: "form",
    };
    const landmark = landmarks[tag];
    if (landmark) semantic.landmark = landmark;
    if (tag === "a" && el.hasAttribute("href")) {
      semantic.href = cleanUrl((el as HTMLAnchorElement).href);
    }
    const alt = el.getAttribute("alt");
    if (alt !== null && alt !== "") semantic.alt = alt;
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

  function visitChildren(el: Element, depth: number): CaptureNode[] {
    const out: CaptureNode[] = [];
    let group: Node[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const node = buildText(group, el);
      if (node) out.push(node);
      group = [];
    };
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        group.push(child);
      } else if (child.nodeType === 1) {
        const e = child as Element;
        if (IGNORED_TAGS.has(e.localName)) continue;
        if (isMergeable(e)) {
          group.push(e);
        } else {
          flush();
          out.push(...visit(e, depth + 1, false));
        }
      }
    }
    flush();
    return out;
  }

  function visit(el: Element, depth: number, isRoot: boolean): CaptureNode[] {
    if (IGNORED_TAGS.has(el.localName)) return [];
    if (isSecretField(el)) return []; // never read, never emitted
    if (el instanceof win.HTMLInputElement && el.type === "hidden") return [];
    const s = cs(el);
    if (s.display === "none") return [];
    if (s.display === "contents") return visitChildren(el, depth - 1);

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
      visible: s.visibility !== "hidden",
      opacity: Math.min(1, Math.max(0, Number.parseFloat(s.opacity))) || 0,
      blendMode: s.mixBlendMode,
      ...(readTransform(s.transform) ? { transform: readTransform(s.transform) } : {}),
      semantic: semanticOf(el),
    };
    const tag = el.localName;

    if (!isRoot && boxArea(box) <= 0 && ["img", "svg", "canvas", "video", "iframe"].includes(tag)) {
      return [];
    }

    if (el.namespaceURI === SVG_NS && tag === "svg") {
      warn("svg-placeholder", id, "Inline SVG is emitted as a placeholder in Phase 1");
      return [placeholder(common, "blocked-image")];
    }
    if (el.namespaceURI === XHTML) {
      if (tag === "canvas") return [placeholder(common, "canvas")];
      if (tag === "video") {
        const v = el as HTMLVideoElement;
        return [placeholder(common, "video", v.poster || v.currentSrc || undefined)];
      }
      if (tag === "iframe") {
        return [
          placeholder(common, "cross-origin-iframe", (el as HTMLIFrameElement).src || undefined),
        ];
      }
      if (tag === "img") {
        const img = el as HTMLImageElement;
        const sourceUrl = img.currentSrc || img.src || undefined;
        if (img.complete && img.naturalWidth === 0) {
          return [placeholder(common, "blocked-image", sourceUrl)];
        }
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
        return [node];
      }
    }

    if (depth >= MAX_DEPTH && el.firstChild) {
      warn("depth-limit", id, `Subtree below depth ${MAX_DEPTH} was not captured`);
      return [placeholder(common, "blocked-image")];
    }

    const element: ElementNode = {
      ...common,
      kind: "element",
      style: readStyle(s, box.w, box.h),
      layout: readLayout(s),
      children: [],
    };
    // Overflow on these two propagates to the viewport instead of clipping the element itself.
    if (el === root || el === doc.body) element.style.overflow = "visible";

    const leafControl = tag === "input" || tag === "textarea" || tag === "select";
    if (leafControl) {
      if (depth < MAX_DEPTH) {
        const t = controlNode(el, s, box);
        if (t) element.children.push(t);
      }
    } else {
      element.children = visitChildren(el, depth);
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

  const [tree] = visit(root, 1, true);
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
          if (name.startsWith("--")) {
            cssCustomProperties[name] = cleanCss(rule.style.getPropertyValue(name).trim());
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
