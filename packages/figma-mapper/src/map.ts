import type { Capture, CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { extractComponents, MAX_HOVER_PATCHES } from "./components";
import { mapFilters } from "./filters";
import { matchFont } from "./fonts";
import { hoverPatches } from "./hover";
import {
  collapseTarget,
  inferChildLayout,
  inferLayout,
  repeatedItems,
  type Siblings,
  siblingsOf,
  textLeading,
  visualOrder,
} from "./layout";
import { layerName } from "./names";
import { DEFAULT_IMPORT_OPTIONS, type ImportOptions } from "./options";
import type {
  FontRef,
  ImportReport,
  LayerPlan,
  PlanChildLayout,
  PlanEffect,
  PlanLayout,
  PlanOp,
  PlanPaint,
  PlanRgb,
  PlanRun,
  PlanStroke,
} from "./plan";
import { extractTokens } from "./tokens";
import { readMotion } from "./transform";
import { unrotateTree } from "./unrotate";

type Fit = "FILL" | "FIT" | "CROP" | "TILE";
type Color = { r: number; g: number; b: number; a: number };

const rgb = (c: Color): PlanRgb => ({ r: c.r, g: c.g, b: c.b });

// Phase 3: CSS `object-fit: fill` stretches, while Figma's FILL crops to keep the aspect ratio.
function imageFit(fit: "cover" | "contain" | "fill" | "none" | "tile"): Fit {
  switch (fit) {
    case "contain":
      return "FIT";
    case "none":
      return "CROP";
    case "tile":
      return "TILE";
    default:
      return "FILL";
  }
}

// Cover and contain come first: `repeat` is the CSS default, so it only means tiling when the
// image does not already span the box. Phase 3 approximation: any other repeat (including
// repeat-x and repeat-y, which Figma cannot express as a paint) is treated as TILE.
function backgroundFit(size: string | undefined, repeat: string | undefined): Fit {
  const fit = size?.trim();
  if (fit === "cover") return "FILL";
  if (fit === "contain") return "FIT";
  if (repeat && repeat !== "no-repeat" && !/^no-repeat/.test(repeat)) return "TILE";
  return "FILL";
}

type Background = ElementNode["style"]["backgroundImages"][number];
type GradientPaint = Extract<PlanPaint, { transform: unknown }>;
type Transform = GradientPaint["transform"];

const GRADIENT_TYPES = {
  "linear-gradient": "GRADIENT_LINEAR",
  "radial-gradient": "GRADIENT_RADIAL",
  "conic-gradient": "GRADIENT_ANGULAR",
} as const;

// CSS angles run clockwise from "up"; Figma's gradient space is the unit square, so the line's
// length is the box's extent along it (`L`), which makes 0% and 100% touch the corners.
function linearTransform(angle: number, w: number, h: number): Transform {
  const rad = (angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const length = Math.abs(w * sin) + Math.abs(h * cos);
  if (!(length > 0)) {
    return [
      [1, 0, 0],
      [0, 1, 0],
    ];
  }
  const a = (w * sin) / length;
  const b = (-h * cos) / length;
  return [
    [a, b, 0.5 - a / 2 - b / 2],
    [-b, a, 0.5 + b / 2 - a / 2],
  ];
}

const RADIAL_FARTHEST_CORNER: Transform = (() => {
  const s = 1 / Math.SQRT2;
  return [
    [s, 0, 0.5 - s / 2],
    [0, s, 0.5 - s / 2],
  ];
})();

// Only a centred ellipse sized to the farthest corner, which is CSS's default, is exact.
function isDefaultRadial(css: string): boolean {
  const head = css.slice(css.indexOf("(") + 1).trimStart();
  // A colour first means the browser wrote no shape, size or position.
  if (!/^(ellipse|circle|closest|farthest|at\b|[\d.])/i.test(head)) return true;
  const spec = head.split(/,(?![^(]*\))/)[0]?.trim() ?? "";
  return /^(ellipse|farthest-corner|ellipse farthest-corner)(\s+at\s+(center|50%\s+50%))?$/i.test(
    spec
  );
}

// A conic gradient's start direction is checked in real Figma (Task 11). The transform is the
// inverse of a clockwise turn by `angle` about the box centre.
function angularTransform(angle: number): Transform {
  const rad = (angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ];
}

type Stop = GradientPaint["stops"][number];

/** Whether a `background-size` makes the layer smaller than the box, so it is a pattern. */
function isPattern(size: string | undefined, w: number, h: number): boolean {
  const tokens = (size ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === "cover" || tokens[0] === "contain") return false;
  return tokens.slice(0, 2).some((t, i) => {
    const n = Number.parseFloat(t);
    if (Number.isNaN(n)) return false; // auto
    if (t.endsWith("%")) return n < 100;
    return n < (i === 0 ? w : h) - 0.5;
  });
}

/**
 * CSS blends premultiplied and Figma straight, so a clear stop would fade through black. A clear
 * stop takes the colour of its nearest visible neighbour; between two different colours it takes
 * the previous one and a twin at the same position takes the next.
 */
function unpremultiply(stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  stops.forEach((stop, i) => {
    if (stop.color.a > 0) {
      out.push(stop);
      return;
    }
    const before = stops
      .slice(0, i)
      .reverse()
      .find((o) => o.color.a > 0);
    const after = stops.slice(i + 1).find((o) => o.color.a > 0);
    const from = before ?? after;
    if (!from) {
      out.push(stop);
      return;
    }
    out.push({ position: stop.position, color: { ...from.color, a: 0 } });
    const same =
      after &&
      after.color.r === from.color.r &&
      after.color.g === from.color.g &&
      after.color.b === from.color.b;
    if (before && after && !same) {
      out.push({ position: stop.position, color: { ...after.color, a: 0 } });
    }
  });
  return out;
}

function mapGradient(
  img: Background,
  w: number,
  h: number,
  warn: (message: string) => void
): GradientPaint | null {
  const kind = img.type as keyof typeof GRADIENT_TYPES;
  if (!img.stops || img.stops.length === 0) {
    warn(`A ${kind} with no readable colour stops was left out.`);
    return null;
  }
  if (isPattern(img.size, w, h)) {
    warn(`A ${kind} sized as a repeating pattern (background-size) was left out.`);
    return null;
  }
  let stops: Stop[] = img.stops
    .map((s) => ({
      position: s.position,
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
    }))
    .sort((p, q) => p.position - q.position);
  if (/^repeating-/.test(img.css)) {
    // Positions are 0 to 1 of the gradient line; the first cycle ends at the last stop.
    const end = stops[stops.length - 1]?.position ?? 0;
    if (end > 0) stops = stops.map((s) => ({ ...s, position: s.position / end }));
    warn(`A repeating ${kind} was imported as its first cycle only.`);
  }
  if (stops.some((s) => s.position < 0 || s.position > 1)) {
    warn(`A ${kind} had colour stops outside 0% to 100%; they were moved to the edge.`);
    stops = stops.map((s) => ({ ...s, position: Math.min(1, Math.max(0, s.position)) }));
  }
  stops = unpremultiply(stops);
  let transform: Transform;
  if (kind === "linear-gradient") {
    transform = linearTransform(img.angle ?? 180, w, h);
  } else if (kind === "radial-gradient") {
    transform = RADIAL_FARTHEST_CORNER;
    if (!isDefaultRadial(img.css)) {
      warn(
        "A radial-gradient with its own shape, size or position was imported as approximate: centred, farthest corner."
      );
    }
  } else {
    transform = angularTransform(img.angle ?? 0);
  }
  return { type: GRADIENT_TYPES[kind], transform, stops };
}

/** `background-clip: text` paints the background through the glyphs, not on the box. */
const clipsToText = (style: ElementNode["style"]): boolean =>
  (style.backgroundClip ?? "").split(/[\s,]+/).includes("text");

/** The colour clipped text takes: the first stop of the top gradient, which is all Figma text can hold. */
function clippedTextColor(style: ElementNode["style"]): PlanRgb | undefined {
  for (const layer of style.backgroundImages) {
    const first = layer.stops?.[0];
    if (layer.type !== "image" && first) return rgb(first.color);
  }
  return undefined;
}

function mapFills(
  style: ElementNode["style"],
  box: { w: number; h: number },
  hashes: Set<string>,
  warn: (message: string) => void
): PlanPaint[] {
  const fills: PlanPaint[] = [];
  if (clipsToText(style)) return fills;
  const bg = style.backgroundColor;
  if (bg.a > 0) fills.push({ type: "SOLID", color: rgb(bg), opacity: bg.a });
  // CSS lists the top layer first and Figma lists it last.
  for (let i = style.backgroundImages.length - 1; i >= 0; i--) {
    const img = style.backgroundImages[i];
    if (!img) continue;
    if (img.type === "image") {
      if (!img.assetHash) continue;
      hashes.add(img.assetHash);
      fills.push({
        type: "IMAGE",
        hash: img.assetHash,
        fit: backgroundFit(img.size, img.repeat),
      });
    } else {
      const paint = mapGradient(img, box.w, box.h, warn);
      if (paint) fills.push(paint);
    }
  }
  return fills;
}

function mapStroke(borders: ElementNode["style"]["borders"]): PlanStroke | null {
  const sides = ["top", "right", "bottom", "left"] as const;
  const weights = { top: 0, right: 0, bottom: 0, left: 0 };
  const tally = new Map<string, { color: Color; n: number }>();
  for (const s of sides) {
    const b = borders[s];
    if (b.width > 0 && b.style !== "none" && b.style !== "hidden" && b.color.a > 0) {
      weights[s] = b.width;
      const key = `${b.color.r},${b.color.g},${b.color.b},${b.color.a}`;
      const t = tally.get(key);
      if (t) t.n++;
      else tally.set(key, { color: b.color, n: 1 });
    }
  }
  let best: { color: Color; n: number } | undefined;
  for (const t of tally.values()) if (!best || t.n > best.n) best = t;
  if (!best) return null;
  return { color: rgb(best.color), opacity: best.color.a, weights };
}

/** Box shadows first, then filter effects. Filters with no Figma equivalent are counted in `ignored`. */
function mapEffects(style: ElementNode["style"], ignored: Map<string, number>): PlanEffect[] {
  const shadows = style.boxShadows.map(
    (s): PlanEffect => ({
      type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: { ...rgb(s.color), a: s.color.a },
      offset: { x: s.x, y: s.y },
      radius: s.blur,
      spread: s.spread,
    })
  );
  const filtered = mapFilters(style);
  for (const name of filtered.ignored) ignored.set(name, (ignored.get(name) ?? 0) + 1);
  return [...shadows, ...filtered.effects];
}

const ALIGN = {
  left: "LEFT",
  start: "LEFT",
  center: "CENTER",
  right: "RIGHT",
  end: "RIGHT",
  justify: "JUSTIFIED",
} as const;

function mapAlign(align: string | undefined): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  return align !== undefined && Object.hasOwn(ALIGN, align)
    ? ALIGN[align as keyof typeof ALIGN]
    : "LEFT";
}

/** Only web pages get a Figma link; the capture has already dropped query, fragment and userinfo. */
function linkTarget(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return href;
  } catch {
    return undefined;
  }
}

function mapDecoration(d: string): PlanRun["decoration"] {
  if (d.includes("underline")) return "UNDERLINE";
  if (d.includes("line-through")) return "STRIKETHROUGH";
  return "NONE";
}

function mapCase(t: string): PlanRun["textCase"] {
  if (t === "uppercase") return "UPPER";
  if (t === "lowercase") return "LOWER";
  if (t === "capitalize") return "TITLE";
  return "ORIGINAL";
}

function dominantAlign(runs: TextNode["runs"]): string | undefined {
  let best: TextNode["runs"][number] | undefined;
  for (const r of runs) {
    if (!best || r.end - r.start > best.end - best.start) best = r;
  }
  return best?.align;
}

/** A frame that fills its parent is not also hugging its content: Figma has one sizing per axis. */
function settle(layout: PlanLayout, childLayout: PlanChildLayout | undefined): PlanLayout {
  if (!childLayout || (layout.mode !== "HORIZONTAL" && layout.mode !== "VERTICAL")) return layout;
  return {
    ...layout,
    sizingH: childLayout.sizingH === "FILL" ? "FIXED" : layout.sizingH,
    sizingV: childLayout.sizingV === "FILL" ? "FIXED" : layout.sizingV,
  };
}

/** Each element's tag by node id; iterative, like the walk, so depth is no limit. */
function tagsOf(root: CaptureNode): Map<string, string> {
  const tags = new Map<string, string>();
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    tags.set(node.id, node.semantic.tag);
    if (node.kind === "element") stack.push(...node.children);
  }
  return tags;
}

export function mapCapture(
  capture: Capture,
  available: FontRef[],
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
  /** Missing family to the available family the user chose for it. */
  fontOverrides: Readonly<Record<string, string>> = {}
): LayerPlan {
  const ops: PlanOp[] = [];
  const fonts = new Map<string, FontRef>();
  const hashes = new Set<string>();
  const substituted = new Map<string, string>();
  const matches = new Map<string, ReturnType<typeof matchFont>>();
  const report = {
    nodes: 0,
    texts: 0,
    images: 0,
    placeholders: 0,
    downscaledImages: capture.assets.filter((a) => a.downscaledFrom).length,
    substitutedFonts: [] as { from: string; to: string }[],
    warnings: capture.warnings.map((w) => w.detail),
    components: 0,
    instances: 0,
  };

  const warned = new Set<string>();
  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    report.warnings.push(message);
  };

  const ignoredFilters = new Map<string, number>();
  // Boxes inside a rotated element are turned back first, so everything below reads local space.
  const pageRoot = unrotateTree(capture.root, warn);
  let scaledLayers = 0;
  let skewedLayers = 0;
  /** The rotation to apply to a layer, counting the scale and skew of its transform that are left out. */
  const rotationOf = (
    node: CaptureNode,
    keep = true
  ): { rotation: number } | Record<string, never> => {
    const motion = readMotion(node.transform);
    if (motion.scaled) scaledLayers++;
    if (motion.skewed) skewedLayers++;
    if (motion.rotation !== undefined && !keep) {
      warn("A rotation on the page's root layer was left out.");
      return {};
    }
    return motion.rotation === undefined ? {} : { rotation: motion.rotation };
  };

  const font = (family: string, weight: number, style: string): FontRef => {
    const italic = /italic|oblique/i.test(style);
    const key = `${family}\u0000${weight}\u0000${italic}`;
    let m = matches.get(key);
    if (!m) {
      m = matchFont(family, weight, italic, available);
      const chosen = Object.hasOwn(fontOverrides, family) ? fontOverrides[family] : undefined;
      if (m.substituted && chosen) {
        const o = matchFont(chosen, weight, italic, available);
        if (!o.substituted) m = o;
      }
      matches.set(key, m);
    }
    fonts.set(`${m.font.family}\u0000${m.font.style}`, m.font);
    const replaced = m.font.family.trim().toLowerCase() !== family.trim().toLowerCase();
    if ((m.substituted || replaced) && !substituted.has(family)) {
      substituted.set(family, `${m.font.family} ${m.font.style}`);
    }
    return m.font;
  };

  let fallbackFont: FontRef | undefined;
  const defaultFont = (): FontRef => {
    if (!fallbackFont) {
      const m = matchFont("Inter", 400, false, available);
      let chosen = m.font;
      if (m.substituted && available[0]) {
        chosen = { family: available[0].family, style: available[0].style };
        if (!substituted.has("Inter")) {
          substituted.set("Inter", `${chosen.family} ${chosen.style}`);
        }
      }
      fonts.set(`${chosen.family}\u0000${chosen.style}`, chosen);
      fallbackFont = chosen;
    }
    return fallbackFont;
  };

  const nameFor = (node: CaptureNode, peers: CaptureNode[]): string =>
    layerName(node, peers, { htmlNames: options.htmlNames });

  const mapText = (
    node: TextNode,
    parent: string,
    x: number,
    y: number,
    peers: CaptureNode[],
    clip?: PlanRgb
  ): PlanOp | null => {
    const len = node.text.length;
    if (len === 0) return null;
    const valid: PlanRun[] = [];
    for (const r of node.runs) {
      const start = Math.max(0, Math.min(r.start, len));
      const end = Math.max(0, Math.min(r.end, len));
      if (!(end > start)) continue;
      const href = options.hyperlinks ? linkTarget(r.href) : undefined;
      valid.push({
        start,
        end,
        fontName: font(r.family, r.weight, r.style),
        fontSize: r.size,
        lineHeight: r.lineHeight,
        letterSpacing: r.letterSpacing,
        // Text clipped to a background is transparent; it takes the gradient's first colour.
        color: clip && r.color.a === 0 ? clip : rgb(r.color),
        opacity: clip && r.color.a === 0 ? 1 : r.color.a,
        decoration: mapDecoration(r.decoration),
        textCase: mapCase(r.transform),
        ...(href ? { href } : {}),
      });
    }
    // Cover the whole string with no gaps or overlaps: the applier sets every
    // range, so uncovered text would have no listed font.
    valid.sort((a, b) => a.start - b.start);
    const seed = node.runs[0];
    const filler = (start: number, end: number): PlanRun => ({
      start,
      end,
      fontName: defaultFont(),
      fontSize: seed?.size ?? 16,
      lineHeight: seed?.lineHeight ?? null,
      letterSpacing: seed?.letterSpacing ?? 0,
      color: seed ? (clip && seed.color.a === 0 ? clip : rgb(seed.color)) : { r: 0, g: 0, b: 0 },
      opacity: seed ? (clip && seed.color.a === 0 ? 1 : seed.color.a) : 1,
      decoration: seed ? mapDecoration(seed.decoration) : "NONE",
      textCase: seed ? mapCase(seed.transform) : "ORIGINAL",
    });
    const runs: PlanRun[] = [];
    let cursor = 0;
    for (const r of valid) {
      const start = Math.max(r.start, cursor);
      if (r.end <= start) continue;
      if (start > cursor) runs.push(filler(cursor, start));
      runs.push({ ...r, start });
      cursor = r.end;
    }
    if (cursor < len) runs.push(filler(cursor, len));
    report.texts++;
    // The captured box is the glyph box; a fixed Figma line height starts at the top of the line
    // box, half the leading higher, and the line box is what auto layout stacks.
    const leading = textLeading(node);
    return {
      op: "text",
      id: node.id,
      parent,
      name: nameFor(node, peers),
      x,
      y: y - leading,
      w: node.box.w,
      h: node.box.h + 2 * leading,
      text: node.text,
      runs,
      align: mapAlign(dominantAlign(node.runs)),
      wrap: node.lines.length > 1,
      lineCount: Math.max(node.lines.length, 1),
    };
  };

  const placeholder = (
    node: CaptureNode,
    parent: string,
    x: number,
    y: number,
    label: string,
    peers: CaptureNode[]
  ): PlanOp => {
    report.placeholders++;
    return {
      op: "placeholder",
      id: node.id,
      parent,
      name: nameFor(node, peers),
      x,
      y,
      w: node.box.w,
      h: node.box.h,
      opacity: node.opacity,
      label,
    };
  };

  // Iterative pre-order walk: parents always come before their children, and
  // no recursion limit applies however deep the capture is.
  // `outer` differs from `node` when wrappers collapsed: it is what the parent laid out.
  type Item = {
    node: CaptureNode;
    outer: CaptureNode;
    parent: ElementNode | null;
    parentId: string | null;
    parentLayout: PlanLayout | null;
    siblings: Siblings | undefined;
    /** What the parent's children turned into, for numbering repeated items. */
    peers: CaptureNode[];
    /** The colour for transparent text, from an ancestor with `background-clip: text`. */
    clip?: PlanRgb;
  };
  const stack: Item[] = [
    {
      node: pageRoot,
      outer: pageRoot,
      parent: null,
      parentId: null,
      parentLayout: null,
      siblings: undefined,
      peers: [],
    },
  ];
  while (stack.length > 0) {
    const { node, outer, parent, parentId, parentLayout, siblings, peers, clip } =
      stack.pop() as Item;
    // visibility:hidden on a parent does not hide visible children, so an
    // invisible element with children stays as an unpainted frame.
    const hidden = !node.visible;
    if (hidden && !(node.kind === "element" && node.children.length > 0)) continue;
    const x = node.box.x - (parent?.box.x ?? 0);
    const y = node.box.y - (parent?.box.y ?? 0);
    let op: PlanOp | null = null;
    const childLayout =
      parent && parentLayout && parentLayout.mode !== "NONE"
        ? inferChildLayout(outer, parentLayout, parent, node, siblings)
        : undefined;

    switch (node.kind) {
      case "element": {
        const s = node.style;
        let childClip = clip;
        if (clipsToText(s)) {
          childClip = clippedTextColor(s) ?? clip;
          warn("Text with a background clip was imported with the first colour of its gradient.");
        }
        const inferred = inferLayout(
          node,
          node.children,
          parentLayout ? { parent: parentLayout } : {}
        );
        const layout: PlanLayout = options.autoLayout
          ? settle(inferred, childLayout)
          : { mode: "NONE" };
        // The import root is not turned: Figma places the import.
        const turn = rotationOf(node, parent !== null);
        op = {
          op: "frame",
          id: node.id,
          parent: parentId,
          name: nameFor(node, peers),
          x,
          y,
          w: node.box.w,
          h: node.box.h,
          fills: hidden ? [] : mapFills(s, node.box, hashes, warn),
          strokes: hidden ? null : mapStroke(s.borders),
          // [topLeft, topRight, bottomRight, bottomLeft], as the walker emits.
          radius: [...s.borderRadius] as [number, number, number, number],
          opacity: node.opacity,
          effects: hidden ? [] : mapEffects(s, ignoredFilters),
          clips: s.overflow.split(/\s+/).some((o) => o !== "" && o !== "visible"),
          layout,
          ...turn,
          childCount: 0, // known once the walk has seen what the children turn into
        };
        const children = visualOrder(node, node.children, layout);
        const repeated = repeatedItems(children);
        const around =
          layout.mode === "HORIZONTAL" || layout.mode === "VERTICAL"
            ? siblingsOf(node.children, layout.mode === "HORIZONTAL")
            : undefined;
        const targets = children.map((child) => collapseTarget(child, repeated));
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i] as CaptureNode;
          stack.push({
            node: targets[i] as CaptureNode,
            outer: child,
            parent: node,
            parentId: node.id,
            parentLayout: layout,
            siblings: around,
            peers: targets,
            clip: childClip,
          });
        }
        break;
      }
      case "text":
        op = mapText(node, parentId as string, x, y, peers, clip);
        break;
      case "image":
        if (node.assetHash) {
          hashes.add(node.assetHash);
          report.images++;
          op = {
            op: "image",
            id: node.id,
            parent: parentId as string,
            name: nameFor(node, peers),
            x,
            y,
            w: node.box.w,
            h: node.box.h,
            hash: node.assetHash,
            fit: imageFit(node.fit),
            opacity: node.opacity,
            radius: [...node.borderRadius] as [number, number, number, number],
            strokes: mapStroke(node.borders),
            ...rotationOf(node),
          };
        } else {
          op = placeholder(
            node,
            parentId as string,
            x,
            y,
            node.sourceUrl ?? node.semantic.alt ?? "Image",
            peers
          );
        }
        break;
      case "svg":
        // Markup that was left out of the capture has nothing to rebuild.
        op =
          node.markup === ""
            ? placeholder(node, parentId as string, x, y, "SVG", peers)
            : {
                op: "svg",
                id: node.id,
                parent: parentId as string,
                name: nameFor(node, peers),
                x,
                y,
                w: node.box.w,
                h: node.box.h,
                markup: node.markup,
                opacity: node.opacity,
                clips:
                  node.overflow === undefined ||
                  node.overflow.split(/\s+/).some((o) => o !== "" && o !== "visible"),
                ...rotationOf(node),
              };
        break;
      case "placeholder":
        op = placeholder(
          node,
          parentId as string,
          x,
          y,
          node.sourceUrl ? `${node.placeholderKind}: ${node.sourceUrl}` : node.placeholderKind,
          peers
        );
        break;
    }
    if (op) ops.push(childLayout ? { ...op, childLayout } : op);
  }

  const childCounts = new Map<string, number>();
  for (const { parent } of ops) {
    if (parent !== null) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
  }
  for (const op of ops) {
    if (op.op === "frame") op.childCount = childCounts.get(op.id) ?? 0;
  }

  report.nodes = ops.length;
  report.substitutedFonts = [...substituted].map(([from, to]) => ({ from, to }));
  const tokens = extractTokens(capture, ops, options);
  if (ignoredFilters.size > 0) {
    const names = [...ignoredFilters].map(([name, n]) => `${name} (${n})`).join(", ");
    report.warnings.push(`These filters have no Figma equivalent and were left out: ${names}.`);
  }
  if (scaledLayers > 0) {
    warn(
      `Scale in a CSS transform was left out on ${scaledLayers} layer${scaledLayers === 1 ? "" : "s"}.`
    );
  }
  if (skewedLayers > 0) {
    warn(
      `Skew in a CSS transform was left out on ${skewedLayers} layer${skewedLayers === 1 ? "" : "s"}; any rotation was kept.`
    );
  }
  let finished = ops;
  if (options.components) {
    const found = extractComponents(
      ops,
      tagsOf(pageRoot),
      options.hoverComponents ? hoverPatches(pageRoot, ops) : undefined
    );
    finished = found.ops;
    report.components = found.components;
    report.instances = found.instances;
    if (found.hoverCapped) {
      warn(
        `Hover changes on ${found.hoverCapped} component${found.hoverCapped === 1 ? "" : "s"} were cut off at ${MAX_HOVER_PATCHES} layers each.`
      );
    }
  }
  return { ops: finished, tokens, fonts: [...fonts.values()], assetHashes: [...hashes], report };
}

export function batchOps(ops: PlanOp[], size = 50): PlanOp[][] {
  const n = Number.isInteger(size) && size > 0 ? size : 50;
  const out: PlanOp[][] = [];
  for (let i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n));
  return out;
}

export type MissingFont = { family: string; nearest: string };

/** The families a plan had to replace, each with the family it was replaced by. */
export function missingFonts(report: ImportReport, available: FontRef[]): MissingFont[] {
  return report.substitutedFonts.map(({ from, to }) => ({
    family: from,
    nearest: available.find((f) => `${f.family} ${f.style}` === to)?.family ?? to,
  }));
}
