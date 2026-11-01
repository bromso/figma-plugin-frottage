import type { ElementNode } from "@repo/capture-schema";

type Matrix = NonNullable<ElementNode["transform"]>;

/** What a 2D matrix means for a layer: a clockwise rotation, plus what Figma cannot take. */
export type Motion = {
  /** Clockwise degrees as in CSS; absent when the matrix does not rotate. */
  rotation?: number;
  /** The matrix scales (or mirrors) the layer, which is left out. */
  scaled: boolean;
  /** The matrix skews the layer, which is left out. */
  skewed: boolean;
};

const SKEW = 0.001;
const SCALE = 0.001;
/** Below this many degrees a rotation is rounding noise. */
const MIN_DEGREES = 0.01;

/** Splits `[a, b, c, d, e, f]` into rotation, scale and skew; translation is already in the box. */
export function readMotion(matrix: Matrix | undefined): Motion {
  if (!matrix) return { scaled: false, skewed: false };
  const [a, b, c, d] = matrix;
  const sx = Math.hypot(a, b);
  if (sx < 1e-9) return { scaled: true, skewed: false };
  const det = a * d - b * c;
  const sy = det / sx;
  const skewed = sy !== 0 && Math.abs(a * c + b * d) / (sx * Math.abs(sy)) > SKEW;
  const scaled = Math.abs(sx - 1) > SCALE || Math.abs(sy - 1) > SCALE;
  // A mirror (negative determinant) has no rotation that draws it, so it counts as scale.
  if (det < 0) return { scaled, skewed };
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  if (Math.abs(degrees) < MIN_DEGREES) return { scaled, skewed };
  return { rotation: Math.round(degrees * 1e4) / 1e4, scaled, skewed };
}
