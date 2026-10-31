import type { ElementNode } from "@repo/capture-schema";
import { parseComputedColor, type Rgba } from "./color";
import { cleanCss, firstUrlInCss, rememberUrl, shortenDataUrls } from "./urls";

type Style = ElementNode["style"];
type Layout = ElementNode["layout"];
type Border = Style["borders"]["top"];
type BackgroundImage = Style["backgroundImages"][number];
type Shadow = Style["boxShadows"][number];

const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export const colorOf = (value: string): Rgba => parseComputedColor(value) ?? CLEAR;

export const px = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** Split on commas (or whitespace) that are not inside parentheses. */
export function splitTop(value: string, separator: "," | " " = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    const isSep = depth === 0 && (separator === "," ? ch === "," : /\s/.test(ch));
    if (isSep) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const DIRECTIONS: Record<string, number> = {
  "to top": 0,
  "to right": 90,
  "to bottom": 180,
  "to left": 270,
  "to top right": 45,
  "to right top": 45,
  "to bottom right": 135,
  "to right bottom": 135,
  "to bottom left": 225,
  "to left bottom": 225,
  "to top left": 315,
  "to left top": 315,
};

function parseStops(args: string[]): BackgroundImage["stops"] {
  const stops: { color: Rgba; position: number | null }[] = [];
  for (const arg of args) {
    const tokens = splitTop(arg, " ");
    const color = parseComputedColor(tokens[0] ?? "");
    if (!color) continue;
    const pos = tokens[1];
    stops.push({
      color,
      position: pos?.endsWith("%") ? Number.parseFloat(pos) / 100 : null,
    });
  }
  if (stops.length === 0) return undefined;
  // Positions given in lengths, or omitted, are spread evenly between known ones.
  const last = stops.length - 1;
  if (stops[0] && stops[0].position === null) stops[0].position = 0;
  const lastStop = stops[last];
  if (lastStop && lastStop.position === null) lastStop.position = 1;
  let i = 0;
  while (i <= last) {
    if (stops[i]?.position !== null) {
      i++;
      continue;
    }
    let j = i;
    while (stops[j]?.position === null) j++;
    const from = stops[i - 1]?.position ?? 0;
    const to = stops[j]?.position ?? 1;
    for (let k = i; k < j; k++) {
      const s = stops[k];
      if (s) s.position = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  return stops.map((s) => ({ color: s.color, position: s.position ?? 0 }));
}

export function parseBackgroundImages(cs: CSSStyleDeclaration): BackgroundImage[] {
  const value = cs.backgroundImage;
  if (!value || value === "none") return [];
  const sizes = splitTop(cs.backgroundSize);
  const positions = splitTop(cs.backgroundPosition);
  const repeats = splitTop(cs.backgroundRepeat);
  const out: BackgroundImage[] = [];
  // Data URLs are swapped for short tokens first: they can be megabytes and must not be kept
  // in `css` (repeated per element) nor split character by character. Only the image layer's
  // cleaned form is stored; `collectAssets` reads the whole URL from memory.
  const shortened = shortenDataUrls(value);
  splitTop(shortened.text).forEach((rawLayer, i) => {
    const pick = (list: string[]) => list[i % Math.max(list.length, 1)];
    const { css: layer, full } = shortened.restore(rawLayer);
    const base = {
      css: layer,
      size: pick(sizes),
      position: pick(positions),
      repeat: pick(repeats),
    };
    const grad = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(layer);
    if (grad) {
      const type = `${grad[2]}-gradient` as BackgroundImage["type"];
      const args = splitTop(grad[3] as string);
      let angle: number | undefined;
      let colorArgs = args;
      const first = args[0] ?? "";
      if (type === "linear-gradient" || type === "conic-gradient") {
        const deg = /^(?:from\s+)?(-?[\d.]+)(deg|turn|rad)$/.exec(first);
        if (deg) {
          const n = Number.parseFloat(deg[1] as string);
          angle = deg[2] === "turn" ? n * 360 : deg[2] === "rad" ? (n * 180) / Math.PI : n;
          colorArgs = args.slice(1);
        } else if (first in DIRECTIONS) {
          angle = DIRECTIONS[first];
          colorArgs = args.slice(1);
        } else if (type === "linear-gradient") {
          angle = 180;
        }
      } else if (!parseComputedColor(splitTop(first, " ")[0] ?? "")) {
        colorArgs = args.slice(1); // radial shape and position
      }
      const stops = parseStops(colorArgs);
      out.push({
        type,
        ...base,
        ...(angle === undefined ? {} : { angle }),
        ...(stops ? { stops } : {}),
      });
    } else if (layer.startsWith("url(") || layer.startsWith("image-set(")) {
      const entry: BackgroundImage = { type: "image", ...base, css: cleanCss(layer) };
      const url = full ?? firstUrlInCss(layer);
      if (url) rememberUrl(entry, url);
      out.push(entry);
    }
  });
  return out;
}

export function parseBoxShadows(value: string): Shadow[] {
  if (!value || value === "none") return [];
  return splitTop(value).flatMap((layer) => {
    const tokens = splitTop(layer, " ");
    const inset = tokens.includes("inset");
    const colorToken = tokens.find((t) => /^[a-z-]+\(/.test(t) || t === "transparent");
    const nums = tokens.filter((t) => /^-?[\d.]/.test(t)).map(px);
    if (nums.length < 2) return [];
    return [
      {
        inset,
        x: nums[0] ?? 0,
        y: nums[1] ?? 0,
        blur: nums[2] ?? 0,
        spread: nums[3] ?? 0,
        color: colorToken ? colorOf(colorToken) : BLACK,
      },
    ];
  });
}

export function parseFilters(value: string): string[] {
  if (!value || value === "none") return [];
  return splitTop(value, " ").map(cleanCss);
}

function border(cs: CSSStyleDeclaration, side: "Top" | "Right" | "Bottom" | "Left"): Border {
  const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
  const width =
    style === "none" || style === "hidden"
      ? 0
      : px(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
  return {
    width,
    color: colorOf(cs.getPropertyValue(`border-${side.toLowerCase()}-color`)),
    style,
  };
}

/** Corner radii in px, order TL, TR, BR, BL. Percentages resolve against the box. */
export function readRadii(cs: CSSStyleDeclaration, w: number, h: number): Style["borderRadius"] {
  const one = (prop: string) => {
    const first = (cs.getPropertyValue(prop).split(/\s+/)[0] ?? "0").trim();
    const n = px(first);
    return first.endsWith("%") ? (n / 100) * Math.min(w, h) : n;
  };
  return [
    one("border-top-left-radius"),
    one("border-top-right-radius"),
    one("border-bottom-right-radius"),
    one("border-bottom-left-radius"),
  ];
}

export const readBorders = (cs: CSSStyleDeclaration): Style["borders"] => ({
  top: border(cs, "Top"),
  right: border(cs, "Right"),
  bottom: border(cs, "Bottom"),
  left: border(cs, "Left"),
});

export function readStyle(cs: CSSStyleDeclaration, w: number, h: number): Style {
  const overflowX = cs.overflowX;
  const overflowY = cs.overflowY;
  const style: Style = {
    backgroundColor: colorOf(cs.backgroundColor),
    backgroundImages: parseBackgroundImages(cs),
    borders: readBorders(cs),
    borderRadius: readRadii(cs, w, h),
    boxShadows: parseBoxShadows(cs.boxShadow),
    filters: parseFilters(cs.filter),
    overflow: overflowX === overflowY ? overflowX : `${overflowX} ${overflowY}`,
  };
  const backdrop = cs.getPropertyValue("backdrop-filter");
  if (backdrop && backdrop !== "none") style.backdropFilter = cleanCss(backdrop);
  return style;
}

const four = (cs: CSSStyleDeclaration, prefix: "padding" | "margin"): Layout["padding"] => [
  px(cs.getPropertyValue(`${prefix}-top`)),
  px(cs.getPropertyValue(`${prefix}-right`)),
  px(cs.getPropertyValue(`${prefix}-bottom`)),
  px(cs.getPropertyValue(`${prefix}-left`)),
];

export function readLayout(cs: CSSStyleDeclaration): Layout {
  const display = cs.display;
  const layout: Layout = {
    display,
    position: cs.position,
    padding: four(cs, "padding"),
    margin: four(cs, "margin"),
    order: Number.parseInt(cs.getPropertyValue("order"), 10) || 0,
    grow: px(cs.getPropertyValue("flex-grow")),
    shrink: Number.parseFloat(cs.getPropertyValue("flex-shrink")) || 0,
  };
  if (/flex|grid/.test(display)) {
    if (display.includes("flex")) {
      layout.flexDirection = cs.flexDirection;
      layout.flexWrap = cs.flexWrap;
    }
    layout.justifyContent = cs.justifyContent;
    layout.alignItems = cs.alignItems;
    layout.gap = [px(cs.rowGap), px(cs.columnGap)];
  }
  if (display.includes("grid")) {
    layout.gridTemplateColumns = cs.gridTemplateColumns;
    layout.gridTemplateRows = cs.gridTemplateRows;
    layout.rowGap = px(cs.rowGap);
    layout.columnGap = px(cs.columnGap);
  }
  if (cs.alignSelf && cs.alignSelf !== "auto") layout.alignSelf = cs.alignSelf;
  if (cs.gridColumn && cs.gridColumn !== "auto") layout.gridColumn = cs.gridColumn;
  if (cs.gridRow && cs.gridRow !== "auto") layout.gridRow = cs.gridRow;
  return layout;
}

/**
 * Which margins are `auto`. Computed style gives their used pixels, which look like any other
 * margin; only the typed style map still says `auto`. Undefined when none is.
 */
export function readMarginAuto(el: Element): Layout["marginAuto"] {
  const map = el.computedStyleMap?.();
  if (!map) return undefined;
  const auto = (side: string) => String(map.get(`margin-${side}`)) === "auto";
  const sides: Layout["marginAuto"] = [auto("top"), auto("right"), auto("bottom"), auto("left")];
  return sides.some(Boolean) ? sides : undefined;
}

/** A leaf node's place in the flow, leaving out the defaults. */
export function readFlow(
  el: Element,
  cs: CSSStyleDeclaration
): { position?: string; margin?: Layout["margin"]; marginAuto?: Layout["marginAuto"] } {
  const margin = four(cs, "margin");
  const marginAuto = margin.some((m) => m > 0) ? readMarginAuto(el) : undefined;
  return {
    ...(cs.position && cs.position !== "static" ? { position: cs.position } : {}),
    ...(margin.some((m) => m !== 0) ? { margin } : {}),
    ...(marginAuto ? { marginAuto } : {}),
  };
}

/** A 2D matrix from a computed transform, or undefined for none or 3D. */
export function readTransform(value: string): ElementNode["transform"] {
  const m = /^matrix\(([^)]+)\)$/.exec(value);
  if (!m) return undefined;
  const n = (m[1] as string).split(",").map((s) => Number.parseFloat(s));
  if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return undefined;
  return n as [number, number, number, number, number, number];
}
