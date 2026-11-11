// shadcn-style markers, readable without any framework: `data-slot` names the component and
// `data-variant`, `data-size` and `data-state` are its props.
import { keepValue } from "./props";

const MARKER_PROPS = [
  ["data-variant", "variant"],
  ["data-size", "size"],
  ["data-state", "state"],
] as const;

// `button` → `Button`, `card-content` → `Card content`.
export function slotName(slot: string): string {
  const words = slot.trim().replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function markerProps(el: Element): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [attribute, key] of MARKER_PROPS) {
    const value = el.getAttribute(attribute);
    if (value !== null && keepValue(value)) props[key] = value;
  }
  return props;
}

// The element's name from its `data-slot`, or null without one.
export function markerName(el: Element): string | null {
  const slot = el.getAttribute("data-slot");
  if (!slot) return null;
  const name = slotName(slot);
  return name.length > 0 && name.length <= 40 ? name : null;
}
