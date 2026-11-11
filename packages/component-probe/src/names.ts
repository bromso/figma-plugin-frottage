// Which code names count. Pass-through wrappers (Radix's `Primitive.*`, slots, providers,
// presences, portals and collections, Next's `__next_*` boundaries) are never components: the
// walk goes on to the component they wrap.

const MINIFIED = /^[A-Za-z_$][\w$]?$/;

export function isMinified(name: string): boolean {
  return MINIFIED.test(name);
}

const PASS_EXACT = new Set(["Slot", "SlotClone", "Slottable", "Presence", "Portal"]);
const PASS_PREFIX = ["Primitive.", "__next_"];
const PASS_SUFFIX = [
  ".Slot",
  ".SlotClone",
  ".Slottable",
  "Provider",
  "Impl",
  "Context",
  "Consumer",
];

export function isPassThrough(name: string): boolean {
  return (
    PASS_EXACT.has(name) ||
    PASS_PREFIX.some((prefix) => name.startsWith(prefix)) ||
    PASS_SUFFIX.some((suffix) => name.endsWith(suffix)) ||
    name.includes("Collection")
  );
}

// Whether a code name may name the element: a minified one only when the element's `data-slot`
// can rename it.
export function namesElement(name: string, el: Element): boolean {
  return !isPassThrough(name) && (!isMinified(name) || el.hasAttribute("data-slot"));
}

// A name the file can hold, or null for an anonymous or overlong one.
export function usableName(name: unknown): string | null {
  return typeof name === "string" && name.length > 0 && name.length <= 40 ? name : null;
}

// What the probe found in one element's code, before the markers are merged in.
export type CodeComponent = {
  source: "react" | "vue";
  name: string;
  props: Record<string, unknown>;
};
