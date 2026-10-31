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

function viaCanvas(value: string): Rgba | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.createElement !== "function") return null;
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = value;
    if (ctx.fillStyle === "#010203" && value.replace(/\s/g, "").toLowerCase() !== "#010203") {
      return null; // rejected by the parser
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return {
      r: (d[0] ?? 0) / 255,
      g: (d[1] ?? 0) / 255,
      b: (d[2] ?? 0) / 255,
      a: (d[3] ?? 0) / 255,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a computed CSS colour into unit-range sRGB. rgb, hsl, hwb, lab, lch,
 * oklab, oklch and color(srgb | srgb-linear | display-p3) are converted
 * arithmetically; anything else is drawn to a 1x1 canvas when one exists.
 */
export function parseComputedColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
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
  return viaCanvas(text);
}
