// Which code names count. Pass-through wrappers (Radix `Primitive.*`, Next's `__next_*`
// boundaries, `Slot`) are never components: the walk goes on to the component they wrap.

const MINIFIED = /^[A-Za-z_$][\w$]?$/;

export function isMinified(name: string): boolean {
  return MINIFIED.test(name);
}

export function isPassThrough(name: string): boolean {
  return (
    name.startsWith("Primitive.") ||
    name.startsWith("__next_") ||
    name === "Slot" ||
    name === "SlotClone"
  );
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
