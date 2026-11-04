export type Rgba = { r: number; g: number; b: number; a: number };

const clamp01 = (n: number) => (Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n)));

/** A component as a number: "50%" scales against `full`, "none" is 0. */
function component(token: string, full: number): number | null {
  if (token === "none") return 0;
  if (token.endsWith("%")) {
    const n = Number.parseFloat(token);
    return Number.isNaN(n) ? null : (n / 100) * full;
  }
  const n = Number(token);
  return Number.isNaN(n) ? null : n;
}

function hue(token: string): number | null {
  if (token === "none") return 0;
  const n = Number.parseFloat(token);
  if (Number.isNaN(n)) return null;
  if (token.endsWith("turn")) return n * 360;
  if (token.endsWith("grad")) return n * 0.9;
  if (token.endsWith("rad")) return (n * 180) / Math.PI;
  return n;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = component(token, 1);
  return a === null ? null : clamp01(a);
}

const toSrgb = (c: number) => {
  const s = Math.abs(c);
  const v = s <= 0.0031308 ? 12.92 * s : 1.055 * s ** (1 / 2.4) - 0.055;
  return clamp01(c < 0 ? -v : v);
};

function linearToRgba(lr: number, lg: number, lb: number, a: number): Rgba {
  return { r: toSrgb(lr), g: toSrgb(lg), b: toSrgb(lb), a };
}

function oklabToRgba(L: number, A: number, B: number, a: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return linearToRgba(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    a
  );
}

function labToRgba(L: number, A: number, B: number, a: number): Rgba {
  // CIE Lab with the D50 white point, then Bradford-adapted to D65 linear sRGB.
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const e = 216 / 24389;
  const k = 24389 / 27;
  const f = (t: number) => (t ** 3 > e ? t ** 3 : (116 * t - 16) / k);
  const X = (f(fx) * 0.3457) / 0.3585;
  const Y = L > 8 ? fy ** 3 : L / k;
  const Z = (f(fz) * (1 - 0.3457 - 0.3585)) / 0.3585;
  const x = 0.9554734527042182 * X - 0.023098536874261423 * Y + 0.0632593086610217 * Z;
  const y = -0.028369706963208136 * X + 1.0099954580058226 * Y + 0.021041398966943008 * Z;
  const z = 0.012314001688319899 * X - 0.020507696433477912 * Y + 1.3303659366080753 * Z;
  return linearToRgba(
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
    a
  );
}

function hslToRgba(h: number, s: number, l: number, a: number): Rgba {
  const hh = (((h % 360) + 360) % 360) / 30;
  const ss = clamp01(s);
  const ll = clamp01(l);
  const k = (n: number) => (n + hh) % 12;
  const q = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - q * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: clamp01(f(0)), g: clamp01(f(8)), b: clamp01(f(4)), a };
}

function polar(L: number, C: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

const toLinear = (c: number) => {
  const s = Math.abs(c);
  const v = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  return c < 0 ? -v : v;
};

function fromFunction(name: string, args: string[], alpha: number): Rgba | null {
  const [t0, t1, t2] = args;
  if (t0 === undefined || t1 === undefined || t2 === undefined) return null;
  if (name === "rgb" || name === "rgba") {
    const r = component(t0, 255);
    const g = component(t1, 255);
    const b = component(t2, 255);
    if (r === null || g === null || b === null) return null;
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: alpha };
  }
  if (name === "hsl" || name === "hsla") {
    const h = hue(t0);
    const s = component(t1, 1);
    const l = component(t2, 1);
    if (h === null || s === null || l === null) return null;
    return hslToRgba(h, s / (t1.endsWith("%") ? 1 : 100), l / (t2.endsWith("%") ? 1 : 100), alpha);
  }
  if (name === "hwb") {
    const h = hue(t0);
    const w = component(t1, 1);
    const bl = component(t2, 1);
    if (h === null || w === null || bl === null) return null;
    const ww = w / (t1.endsWith("%") ? 1 : 100);
    const bb = bl / (t2.endsWith("%") ? 1 : 100);
    if (ww + bb >= 1) {
      const g = ww / (ww + bb);
      return { r: g, g, b: g, a: alpha };
    }
    const base = hslToRgba(h, 1, 0.5, alpha);
    const mix = (c: number) => clamp01(c * (1 - ww - bb) + ww);
    return { r: mix(base.r), g: mix(base.g), b: mix(base.b), a: alpha };
  }
  if (name === "oklab" || name === "oklch") {
    const L = component(t0, 1);
    if (L === null) return null;
    if (name === "oklab") {
      const A = component(t1, 0.4);
      const B = component(t2, 0.4);
      return A === null || B === null ? null : oklabToRgba(L, A, B, alpha);
    }
    const C = component(t1, 0.4);
    const h = hue(t2);
    if (C === null || h === null) return null;
    const [l, a, b] = polar(L, C, h);
    return oklabToRgba(l, a, b, alpha);
  }
  if (name === "lab" || name === "lch") {
    const L = component(t0, 100);
    if (L === null) return null;
    if (name === "lab") {
      const A = component(t1, 125);
      const B = component(t2, 125);
      return A === null || B === null ? null : labToRgba(L, A, B, alpha);
    }
    const C = component(t1, 150);
    const h = hue(t2);
    if (C === null || h === null) return null;
    const [l, a, b] = polar(L, C, h);
    return labToRgba(l, a, b, alpha);
  }
  return null;
}

function fromColorFunction(args: string[], alpha: number): Rgba | null {
  const [space, c0, c1, c2] = args;
  if (!space || c0 === undefined || c1 === undefined || c2 === undefined) return null;
  const r = component(c0, 1);
  const g = component(c1, 1);
  const b = component(c2, 1);
  if (r === null || g === null || b === null) return null;
  if (space === "srgb") return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: alpha };
  if (space === "srgb-linear") return linearToRgba(r, g, b, alpha);
  if (space === "display-p3") {
    const lr = toLinear(r);
    const lg = toLinear(g);
    const lb = toLinear(b);
    return linearToRgba(
      1.2249401762805598 * lr - 0.22494017628055996 * lg,
      -0.04205695470968816 * lr + 1.0420569547096881 * lg,
      -0.019637554590334432 * lr - 0.07863604555063188 * lg + 1.0982736001409663 * lb,
      alpha
    );
  }
  return null;
}

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, as authored in a stylesheet. */
function fromHex(text: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (!m) return null;
  const h = m[1] as string;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const at = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) : 1 };
}

/**
 * Parse a CSS color into unit-range sRGB. rgb, hsl, hwb, lab, lch, oklab, oklch,
 * color(srgb | srgb-linear | display-p3), hex and transparent are converted arithmetically; anything
 * else is null.
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text.startsWith("#")) return fromHex(text);
  const m = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (m) {
    const name = m[1] as string;
    const [main = "", alphaToken] = (m[2] as string).split("/").map((s) => s.trim());
    const parts = main.split(/[\s,]+/).filter(Boolean);
    let alpha = alphaOf(alphaToken);
    // Legacy comma syntax carries alpha as the fourth argument.
    if (alphaToken === undefined && (name === "rgba" || name === "hsla" || parts.length === 4)) {
      if (name !== "color" && parts.length === 4) alpha = alphaOf(parts.pop());
    }
    if (alpha === null) return null;
    const rgba =
      name === "color" ? fromColorFunction(parts, alpha) : fromFunction(name, parts, alpha);
    if (rgba) return rgba;
  }
  return null;
}

// ---------- Lengths

const MAX_VAR_DEPTH = 16;
/** Total `var()` expansions and the longest expanded text, so a crafted fan-out can't run away. */
const MAX_SUBSTITUTIONS = 256;
const MAX_EXPANDED_LENGTH = 2048;

/** The index of the `)` that closes the `(` at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Replaces every `var()` with the property's value, or its fallback. Null if one has neither. */
function substituteVars(
  value: string,
  props: Record<string, string>,
  depth: number,
  budget = { left: MAX_SUBSTITUTIONS }
): string | null {
  if (depth > MAX_VAR_DEPTH || value.length > MAX_EXPANDED_LENGTH) return null;
  let out = "";
  let at = 0;
  for (;;) {
    const start = value.indexOf("var(", at);
    if (start === -1) return out + value.slice(at);
    const end = closing(value, start + 3);
    if (end === -1) return null;
    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(",");
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1);
    if (--budget.left < 0) return null;
    const raw = Object.hasOwn(props, name) ? props[name] : fallback;
    if (raw === undefined) return null;
    const resolved = substituteVars(raw, props, depth + 1, budget);
    if (resolved === null) return null;
    out += `${value.slice(at, start)}(${resolved})`;
    if (out.length > MAX_EXPANDED_LENGTH) return null;
    at = end + 1;
  }
}

/** A length in pixels, or a plain number when `px` is false. */
type Quantity = { n: number; px: boolean };

const TOKEN = /\s*(?:(-?(?:\d+\.?\d*|\.\d+)(?:px|rem)?)|([-+*/()])|(calc\())/iy;

function evalExpression(text: string, rootPx: number): Quantity | null {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < text.length && text.slice(pos).trim() !== "") {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) return null;
    const tok = m[3] ? "(" : ((m[1] ?? m[2]) as string);
    tokens.push(tok);
    pos = TOKEN.lastIndex;
  }
  let i = 0;
  const atom = (): Quantity | null => {
    const t = tokens[i++];
    if (t === undefined) return null;
    if (t === "(") {
      const inner = sum();
      return tokens[i++] === ")" ? inner : null;
    }
    const m = /^(-?[\d.]+)(px|rem)?$/i.exec(t);
    if (!m) return null;
    const n = Number.parseFloat(m[1] as string);
    if (Number.isNaN(n)) return null;
    const unit = m[2]?.toLowerCase();
    return unit === "rem" ? { n: n * rootPx, px: true } : { n, px: unit === "px" };
  };
  const product = (): Quantity | null => {
    let left = atom();
    while (left && (tokens[i] === "*" || tokens[i] === "/")) {
      const op = tokens[i++];
      const right = atom();
      if (!right) return null;
      if (op === "*") {
        if (left.px && right.px) return null;
        left = { n: left.n * right.n, px: left.px || right.px };
      } else {
        if (right.px || right.n === 0) return null;
        left = { n: left.n / right.n, px: left.px };
      }
    }
    return left;
  };
  const sum = (): Quantity | null => {
    let left = product();
    while (left && (tokens[i] === "+" || tokens[i] === "-")) {
      const op = tokens[i++];
      const right = product();
      if (!right || right.px !== left.px) return null;
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, px: left.px };
    }
    return left;
  };
  const result = sum();
  return result && i === tokens.length && Number.isFinite(result.n) ? result : null;
}

/**
 * A length in pixels. Follows `var()` chains (16 deep) and evaluates `calc()` over `+ - * /` with
 * `px`, `rem` and plain numbers. Null for `em`, `%`, viewport units or anything else.
 */
export function evalLength(
  value: string,
  props: Record<string, string>,
  rootPx = 16
): number | null {
  const text = substituteVars(value.trim(), props, 0);
  if (text === null) return null;
  const flat = text.replace(/\bcalc\(/gi, "(");
  return evalExpression(flat, rootPx)?.n ?? null;
}

/** Tailwind's default `min-width` boundaries, by width. */
const TAILWIND_BREAKPOINTS: Record<number, string> = {
  640: "sm",
  768: "md",
  1024: "lg",
  1280: "xl",
  1536: "2xl",
};

/**
 * The Breakpoint mode name for the range that starts at `min`: Tailwind's name when the boundary
 * is its default, otherwise `min <width>`. The range below the first boundary is `base`, which
 * callers name themselves.
 */
export function breakpointName(min: number): string {
  return TAILWIND_BREAKPOINTS[min] ?? `min ${min}`;
}
