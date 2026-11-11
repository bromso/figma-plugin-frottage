// The attribute the probe leaves on each component's root element, for the capture to read. Kept
// apart from the adapters so the capture script, in the extension's isolated world, can import it
// without bundling them.

export type FoundComponent = {
  source: "react" | "vue" | "marker";
  name: string;
  props: Record<string, string | number | boolean>;
  // The minified code name a `data-slot` name replaced (`o` for a Button), only then.
  codeName?: string;
};

export const ATTRIBUTE = "data-frottage-component";

// The privacy rule: a prop reaches the file only when it can't hold what a person typed, a page's
// own text or a generated id (`contentId: "radix-_R_mddbrlb_"`). Here, apart from the adapters,
// so the capture can hold a value it reads back to the same rule.
const PLAIN = /^[A-Za-z0-9_-]{1,24}$/;
const NEVER = new Set([
  "children",
  "className",
  "class",
  "style",
  "key",
  "ref",
  "id",
  "href",
  "src",
  "alt",
  "title",
  "value",
  "placeholder",
  "name",
  "for",
  "htmlFor",
  "form",
  "target",
  "rel",
  "type",
  "__proto__",
  // How a component renders, not how it looks.
  "asChild",
]);
export const MAX_PROPS = 16;
const MAX_KEY = 40;

export function keepKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_KEY &&
    !NEVER.has(key) &&
    !key.startsWith("on") &&
    !key.startsWith("aria-") &&
    !key.startsWith("data-") &&
    !key.endsWith("Id") &&
    !key.endsWith("ID")
  );
}

export function keepValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && PLAIN.test(value);
}

export function clearComponents(doc: Document): void {
  for (const el of doc.querySelectorAll(`[${ATTRIBUTE}]`)) el.removeAttribute(ATTRIBUTE);
}
