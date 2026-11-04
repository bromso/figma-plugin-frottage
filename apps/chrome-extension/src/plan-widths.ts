import { breakpointName } from "@repo/capture-schema/css-values";
import { DEVICE_HEIGHTS, type DeviceId, joinList, WIDTH_MAX, WIDTH_MIN } from "./page";

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
 * can reach is left out. A repeated device width is captured once, under the first device.
 */
export function planWidths(
  devices: { width: number; id: DeviceId; name: string }[],
  breakpoints: number[]
): { widths: RunWidth[]; extras: { width: number; breakpoint: string }[] } {
  const widths: RunWidth[] = [];
  for (const { width, id, name } of devices) {
    if (widths.some((w) => w.width === width)) continue;
    widths.push({ width, device: { id, name, height: DEVICE_HEIGHTS[id] } });
  }
  const extras: { width: number; breakpoint: string }[] = [];
  if (widths.length === 0) return { widths, extras };

  const bounds = [...new Set(breakpoints)]
    .filter((b) => Number.isInteger(b) && b >= 1 && b <= BREAKPOINT_MAX)
    .sort((a, b) => a - b);
  const ranges = bounds.map((min, i) => ({
    min,
    max: bounds[i + 1] ?? Number.POSITIVE_INFINITY,
    name: breakpointName(min),
    at: min,
  }));
  if (bounds.length > 0) {
    ranges.unshift({
      min: 0,
      max: bounds[0],
      name: "base",
      at: Math.min(BASE_WIDTH, bounds[0] - 1),
    });
  }
  for (const range of ranges) {
    if (widths.some((w) => w.width >= range.min && w.width < range.max)) continue;
    if (range.at < WIDTH_MIN || range.at > WIDTH_MAX) continue;
    extras.push({ width: range.at, breakpoint: range.name });
  }
  return { widths: [...widths, ...extras.map((e) => ({ ...e }))], extras };
}

/** The popup's line about extra captures, or null when there are none. */
export function extrasLine(extras: { width: number; breakpoint: string }[]): string | null {
  if (extras.length === 0) return null;
  const widths = joinList(extras.map((e) => e.width));
  const names = joinList(extras.map((e) => e.breakpoint));
  return `Also captures ${widths} for the ${names} breakpoint${extras.length === 1 ? "" : "s"}`;
}
