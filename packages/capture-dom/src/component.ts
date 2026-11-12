// Reads the component probe's attribute off the page's elements. The page's own scripts can write
// the attribute too, so the value is held by hand (Zod stays out of the page script) to the
// schema's bounds and the probe's privacy rule, and a value that fails anywhere is ignored whole.
import type { CaptureComponent } from "@repo/capture-schema";
import { ATTRIBUTE, keepKey, keepValue, MAX_PROPS } from "@repo/component-probe/attribute";

const SOURCES = new Set(["react", "vue", "marker"]);
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
    // keepKey refuses an own `__proto__` from JSON.parse, which would reach the setter.
    const value = raw[key];
    if (!keepKey(key) || !keepValue(value)) return undefined;
    props[key] = value;
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

/**
 * Every valid component in the document, read once before the walk, and which of them can become
 * a set: those whose name occurs at least twice in this capture.
 */
export function readComponents(doc: Document): {
  of: (el: Element) => CaptureComponent | undefined;
  repeats: (el: Element) => boolean;
} {
  const found = new Map<Element, CaptureComponent>();
  const counts = new Map<string, number>();
  for (const el of doc.querySelectorAll(`[${ATTRIBUTE}]`)) {
    const component = componentOf(el);
    if (!component) continue;
    found.set(el, component);
    counts.set(component.name, (counts.get(component.name) ?? 0) + 1);
  }
  return {
    of: (el) => found.get(el),
    repeats: (el) => {
      const name = found.get(el)?.name;
      return name !== undefined && (counts.get(name) ?? 0) >= 2;
    },
  };
}
