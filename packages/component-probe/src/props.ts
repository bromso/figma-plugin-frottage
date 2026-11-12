// Which of a component's props reach the file; the rule itself is in `attribute.ts`. Labels come
// from the captured text, never from props.

import { keepKey, keepValue, MAX_PROPS } from "./attribute";

export { keepKey, keepValue } from "./attribute";

// `fill` (the markers' props) adds only keys the code's props lack, up to the same limit.
export function keepProps(
  raw: Record<string, unknown>,
  fill: Record<string, string | number | boolean> = {}
): Record<string, string | number | boolean> {
  const kept: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count === MAX_PROPS) return kept;
    if (!keepKey(key)) continue;
    const value = raw[key];
    if (!keepValue(value)) continue;
    kept[key] = value;
    count++;
  }
  for (const key of Object.keys(fill)) {
    if (count === MAX_PROPS) break;
    if (Object.hasOwn(kept, key)) continue;
    kept[key] = fill[key];
    count++;
  }
  return kept;
}
