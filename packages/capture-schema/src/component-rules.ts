// The privacy rule for a component's props: a prop reaches the file only when it can't hold what a
// person typed, a page's own text or a generated id (`contentId: "radix-_R_mddbrlb_"`). Zod-free,
// so the component probe, which runs in the page's own world, bundles it as it is; the schema holds
// a file to the same rule.

/** Past this many props a component is refused; the probe keeps no more. */
export const MAX_PROPS = 16;
const MAX_KEY = 40;
/** A number past this either way could be a date, a phone number or a count of someone's. */
export const MAX_NUMBER = 10_000;

const PLAIN = /^[A-Za-z0-9_-]{1,24}$/;
// `=`, `,` and `|` would break the Figma variant name a prop becomes part of.
const BREAKS_NAME = /[=,|]/;
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
  // Keys that hold a person's or the page's words, even as one plain word.
  "label",
  "defaultValue",
  "text",
  "content",
  "description",
  "email",
  "query",
  "search",
  "initials",
  "username",
]);

export function keepKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_KEY &&
    !NEVER.has(key) &&
    !BREAKS_NAME.test(key) &&
    !key.startsWith("on") &&
    !key.startsWith("aria-") &&
    !key.startsWith("data-") &&
    !key.startsWith("user") &&
    !key.endsWith("Id") &&
    !key.endsWith("ID") &&
    !key.endsWith("Name") &&
    !key.endsWith("name")
  );
}

export function keepValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER;
  return typeof value === "string" && PLAIN.test(value);
}
