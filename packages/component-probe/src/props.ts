// The privacy rule: a prop reaches the file only when it can't hold what a person typed, a page's
// own text or a generated id (`contentId: "radix-_R_mddbrlb_"`). Labels come from the captured
// text, never from props.

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
const MAX_PROPS = 16;
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
