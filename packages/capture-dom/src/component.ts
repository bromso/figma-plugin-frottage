// Reads the component probe's attribute off an element. The page's own scripts can write the
// attribute too, so the value is held to the schema's bounds by hand (Zod stays out of the page
// script), and a value that fails anywhere is ignored whole.
import type { CaptureComponent } from "@repo/capture-schema";
import { ATTRIBUTE } from "@repo/component-probe/attribute";

const SOURCES = new Set(["react", "vue", "marker"]);
const PLAIN = /^[A-Za-z0-9_-]{1,24}$/;
const MAX_PROPS = 16;
const MAX_NAME = 40;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_NAME;

function propsOf(raw: unknown): CaptureComponent["props"] | undefined {
  if (!isRecord(raw)) return undefined;
  const keys = Object.keys(raw);
  if (keys.length > MAX_PROPS) return undefined;
  const props: CaptureComponent["props"] = {};
  for (const key of keys) {
    // An own `__proto__` from JSON.parse would reach the setter.
    if (!isName(key) || key === "__proto__") return undefined;
    const value = raw[key];
    const kept =
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && PLAIN.test(value));
    if (!kept) return undefined;
    props[key] = value as string | number | boolean;
  }
  return props;
}

export function componentOf(el: Element): CaptureComponent | undefined {
  const value = el.getAttribute(ATTRIBUTE);
  if (value === null) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !SOURCES.has(raw.source as string) || !isName(raw.name)) return undefined;
  const props = propsOf(raw.props);
  if (!props) return undefined;
  if (raw.codeName !== undefined && !isName(raw.codeName)) return undefined;
  return {
    source: raw.source as CaptureComponent["source"],
    name: raw.name,
    props,
    ...(raw.codeName === undefined ? {} : { codeName: raw.codeName }),
  };
}
