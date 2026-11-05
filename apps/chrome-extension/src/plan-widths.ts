import { breakpointName } from "@repo/capture-schema/css-values";
import { DEVICE_HEIGHTS, type DeviceId, WIDTH_MAX, WIDTH_MIN } from "./page";

/** One capture of a run: a ticked device, or an extra capture for a breakpoint no device covers. */
export type RunWidth = {
  width: number;
  device?: { id: DeviceId; name: string; height: number };
  breakpoint?: string;
};

/** Where the range below the first boundary is captured, unless that boundary is narrower. */
const BASE_WIDTH = 390;

/** The highest width the page's breakpoints can name. */
const BREAKPOINT_MAX = 10_000;

/**
 * The run's captures: one per ticked device, named and with its nominal height, then one per
 * breakpoint range with no device width inside it, captured at the range's minimum width (the
 * `base` range below the first boundary at 390, or just under that boundary). A range no window
 * can reach is left out, and so is one named in `skip`. `ranges` lists every reachable range, with
 * the widest ticked device inside it when there is one. A repeated device width is captured once, under the first device.
 */
export function planWidths(
  devices: { width: number; id: DeviceId; name: string }[],
  breakpoints: number[],
  skip: string[] = []
): {
  widths: RunWidth[];
  extras: { width: number; breakpoint: string }[];
  ranges: { name: string; at: number; coveredBy?: string }[];
} {
  const widths: RunWidth[] = [];
  for (const { width, id, name } of devices) {
    if (widths.some((w) => w.width === width)) continue;
    widths.push({ width, device: { id, name, height: DEVICE_HEIGHTS[id] } });
  }
  const extras: { width: number; breakpoint: string }[] = [];

  const bounds = [...new Set(breakpoints)]
    .filter((b) => Number.isInteger(b) && b >= 1 && b <= BREAKPOINT_MAX)
    .sort((a, b) => a - b);
  const ranges = bounds.map((min, i) => {
    const max = bounds[i + 1] ?? Number.POSITIVE_INFINITY;
    // A range starting under the narrowest window is captured at that window, if it reaches it.
    return {
      min,
      max,
      name: breakpointName(min),
      at: min < WIDTH_MIN && WIDTH_MIN < max ? WIDTH_MIN : min,
    };
  });
  if (bounds.length > 0) {
    ranges.unshift({
      min: 0,
      max: bounds[0],
      name: "base",
      at: Math.min(BASE_WIDTH, bounds[0] - 1),
    });
  }
  const listed: { name: string; at: number; coveredBy?: string }[] = [];
  for (const range of ranges) {
    if (range.at < WIDTH_MIN || range.at > WIDTH_MAX) continue;
    const inside = widths.filter((w) => w.width >= range.min && w.width < range.max);
    const widest = inside.reduce<RunWidth | undefined>(
      (a, w) => (a && a.width >= w.width ? a : w),
      undefined
    );
    listed.push({
      name: range.name,
      at: range.at,
      ...(widest?.device ? { coveredBy: widest.device.name } : {}),
    });
    if (widths.length > 0 && inside.length === 0 && !skip.includes(range.name)) {
      extras.push({ width: range.at, breakpoint: range.name });
    }
  }
  return { widths: [...widths, ...extras.map((e) => ({ ...e }))], extras, ranges: listed };
}
