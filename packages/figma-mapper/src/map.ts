import type { Capture, CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { matchFont } from "./fonts";
import type {
  FontRef,
  LayerPlan,
  PlanEffect,
  PlanOp,
  PlanPaint,
  PlanRgb,
  PlanRun,
  PlanStroke,
} from "./plan";

type Fit = "FILL" | "FIT" | "CROP" | "TILE";
type Color = { r: number; g: number; b: number; a: number };

const rgb = (c: Color): PlanRgb => ({ r: c.r, g: c.g, b: c.b });

function nameOf(node: CaptureNode, fallback: string): string {
  const tag = node.semantic.tag.replace(/^[^a-zA-Z0-9]+/, "");
  return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : fallback;
}

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

function backgroundFit(size: string | undefined, repeat: string | undefined): Fit {
  if (repeat && repeat !== "no-repeat" && !/^no-repeat/.test(repeat)) return "TILE";
  return size?.trim() === "contain" ? "FIT" : "FILL";
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

function mapStroke(style: ElementNode["style"]): PlanStroke | null {
  const sides = ["top", "right", "bottom", "left"] as const;
  const weights = { top: 0, right: 0, bottom: 0, left: 0 };
  const tally = new Map<string, { color: Color; n: number }>();
  for (const s of sides) {
    const b = style.borders[s];
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
  return ALIGN[(align ?? "left") as keyof typeof ALIGN] ?? "LEFT";
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

export function mapCapture(capture: Capture, available: FontRef[]): LayerPlan {
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
    substitutedFonts: [] as { from: string; to: string }[],
    warnings: capture.warnings.map((w) => w.detail),
  };

  const font = (family: string, weight: number, style: string): FontRef => {
    const italic = /italic|oblique/i.test(style);
    const key = `${family}\u0000${weight}\u0000${italic}`;
    let m = matches.get(key);
    if (!m) {
      m = matchFont(family, weight, italic, available);
      matches.set(key, m);
    }
    fonts.set(`${m.font.family}\u0000${m.font.style}`, m.font);
    if (m.substituted && !substituted.has(family)) {
      substituted.set(family, `${m.font.family} ${m.font.style}`);
    }
    return m.font;
  };

  const mapText = (node: TextNode, parent: string, x: number, y: number): PlanOp | null => {
    const len = node.text.length;
    if (len === 0) return null;
    const runs: PlanRun[] = [];
    for (const r of node.runs) {
      const start = Math.max(0, Math.min(r.start, len));
      const end = Math.max(0, Math.min(r.end, len));
      if (!(end > start)) continue;
      runs.push({
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
      });
    }
    report.texts++;
    return {
      op: "text",
      id: node.id,
      parent,
      name: nameOf(node, "Text"),
      x,
      y,
      w: node.box.w,
      h: node.box.h,
      text: node.text,
      runs,
      align: mapAlign(node.runs[0]?.align),
      wrap: node.lines.length > 1,
    };
  };

  const placeholder = (
    node: CaptureNode,
    parent: string,
    x: number,
    y: number,
    label: string
  ): PlanOp => {
    report.placeholders++;
    return {
      op: "placeholder",
      id: node.id,
      parent,
      name: nameOf(node, "Placeholder"),
      x,
      y,
      w: node.box.w,
      h: node.box.h,
      label,
    };
  };

  // Iterative pre-order walk: parents always come before their children, and
  // no recursion limit applies however deep the capture is.
  type Item = { node: CaptureNode; parent: ElementNode | null; parentId: string | null };
  const stack: Item[] = [{ node: capture.root, parent: null, parentId: null }];
  while (stack.length > 0) {
    const { node, parent, parentId } = stack.pop() as Item;
    if (!node.visible) continue;
    const x = node.box.x - (parent?.box.x ?? 0);
    const y = node.box.y - (parent?.box.y ?? 0);
    let op: PlanOp | null = null;

    switch (node.kind) {
      case "element": {
        const s = node.style;
        op = {
          op: "frame",
          id: node.id,
          parent: parentId,
          name: nameOf(node, "Frame"),
          x,
          y,
          w: node.box.w,
          h: node.box.h,
          fills: mapFills(s, hashes),
          strokes: mapStroke(s),
          radius: [...s.borderRadius] as [number, number, number, number],
          opacity: node.opacity,
          effects: mapEffects(s),
          clips: s.overflow.split(/\s+/).some((o) => o !== "" && o !== "visible"),
        };
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push({ node: node.children[i] as CaptureNode, parent: node, parentId: node.id });
        }
        break;
      }
      case "text":
        op = mapText(node, parentId as string, x, y);
        break;
      case "image":
        if (node.assetHash) {
          hashes.add(node.assetHash);
          report.images++;
          op = {
            op: "image",
            id: node.id,
            parent: parentId as string,
            name: nameOf(node, "Image"),
            x,
            y,
            w: node.box.w,
            h: node.box.h,
            hash: node.assetHash,
            fit: imageFit(node.fit),
          };
        } else {
          op = placeholder(
            node,
            parentId as string,
            x,
            y,
            node.sourceUrl ?? node.semantic.alt ?? "Image"
          );
        }
        break;
      case "svg":
        op = placeholder(node, parentId as string, x, y, "SVG");
        break;
      case "placeholder":
        op = placeholder(
          node,
          parentId as string,
          x,
          y,
          node.sourceUrl ? `${node.placeholderKind}: ${node.sourceUrl}` : node.placeholderKind
        );
        break;
    }
    if (op) ops.push(op);
  }

  report.nodes = ops.length;
  report.substitutedFonts = [...substituted].map(([from, to]) => ({ from, to }));
  return { ops, fonts: [...fonts.values()], assetHashes: [...hashes], report };
}

export function batchOps(ops: PlanOp[], size = 50): PlanOp[][] {
  const n = Number.isInteger(size) && size > 0 ? size : 50;
  const out: PlanOp[][] = [];
  for (let i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n));
  return out;
}
