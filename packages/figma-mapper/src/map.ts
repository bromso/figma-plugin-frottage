import type { Capture, CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { matchFont } from "./fonts";
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

function mapFills(style: ElementNode["style"], hashes: Set<string>): PlanPaint[] {
  const fills: PlanPaint[] = [];
  const bg = style.backgroundColor;
  if (bg.a > 0) fills.push({ type: "SOLID", color: rgb(bg), opacity: bg.a });
  // CSS lists the top layer first and Figma lists it last.
  for (let i = style.backgroundImages.length - 1; i >= 0; i--) {
    const img = style.backgroundImages[i];
    if (img?.type === "image" && img.assetHash) {
      hashes.add(img.assetHash);
      fills.push({
        type: "IMAGE",
        hash: img.assetHash,
        fit: backgroundFit(img.size, img.repeat),
      });
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

function mapEffects(style: ElementNode["style"]): PlanEffect[] {
  return style.boxShadows.map((s) => ({
    type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { ...rgb(s.color), a: s.color.a },
    offset: { x: s.x, y: s.y },
    radius: s.blur,
    spread: s.spread,
  }));
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
    peers: CaptureNode[]
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
        color: rgb(r.color),
        opacity: r.color.a,
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
      color: seed ? rgb(seed.color) : { r: 0, g: 0, b: 0 },
      opacity: seed?.color.a ?? 1,
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
  };
  const stack: Item[] = [
    {
      node: capture.root,
      outer: capture.root,
      parent: null,
      parentId: null,
      parentLayout: null,
      siblings: undefined,
      peers: [],
    },
  ];
  while (stack.length > 0) {
    const { node, outer, parent, parentId, parentLayout, siblings, peers } = stack.pop() as Item;
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
        const inferred = inferLayout(
          node,
          node.children,
          parentLayout ? { parent: parentLayout } : {}
        );
        const layout: PlanLayout = options.autoLayout
          ? settle(inferred, childLayout)
          : { mode: "NONE" };
        op = {
          op: "frame",
          id: node.id,
          parent: parentId,
          name: nameFor(node, peers),
          x,
          y,
          w: node.box.w,
          h: node.box.h,
          fills: hidden ? [] : mapFills(s, hashes),
          strokes: hidden ? null : mapStroke(s.borders),
          // [topLeft, topRight, bottomRight, bottomLeft], as the walker emits.
          radius: [...s.borderRadius] as [number, number, number, number],
          opacity: node.opacity,
          effects: hidden ? [] : mapEffects(s),
          clips: s.overflow.split(/\s+/).some((o) => o !== "" && o !== "visible"),
          layout,
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
          });
        }
        break;
      }
      case "text":
        op = mapText(node, parentId as string, x, y, peers);
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
  return { ops, tokens, fonts: [...fonts.values()], assetHashes: [...hashes], report };
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
