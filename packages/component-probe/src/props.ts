// The privacy rule: a prop reaches the file only when it can't hold what a person typed or a
// page's own text. Labels come from the captured text, never from props.

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
    !key.startsWith("data-")
  );
}

export function keepValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && PLAIN.test(value);
}

export function keepProps(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const kept: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count === MAX_PROPS) break;
    if (!keepKey(key)) continue;
    const value = raw[key];
    if (!keepValue(value)) continue;
    kept[key] = value;
    count++;
  }
  return kept;
}
