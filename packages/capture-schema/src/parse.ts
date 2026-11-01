import {
  type Capture,
  type CaptureNode,
  MAX_GRADIENT_STOPS,
  parts,
  SCHEMA_VERSION,
} from "./schema";

export const LIMITS = {
  totalBytes: 268_435_456,
  captureJsonBytes: 67_108_864,
  nodes: 20_000,
  depth: 256,
};

export type ParseResult =
  | { ok: true; capture: Capture }
  | {
      ok: false;
      reason: "invalid" | "newer-version" | "too-many-nodes" | "too-deep";
      detail: string;
    };

class Reject extends Error {
  reason: "invalid" | "newer-version" | "too-many-nodes" | "too-deep";
  constructor(reason: Reject["reason"], detail: string) {
    super(detail);
    this.reason = reason;
  }
}

type Schema = { safeParse(input: unknown): { success: boolean; data?: unknown; error?: unknown } };

/** Validate one object. Only the first issue is read, and only its path and message. */
function check<T>(schema: Schema, input: unknown, where: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data as T;
  const issue = (result.error as { issues: Array<{ path: PropertyKey[]; message: string }> })
    .issues[0];
  const path = [where, ...(issue?.path ?? [])].filter((p) => p !== "").join(".");
  throw new Reject("invalid", `${path}: ${issue?.message ?? "invalid"}`.slice(0, 300));
}

function checkList<T>(
  schema: Schema,
  input: unknown,
  where: string,
  max = Number.POSITIVE_INFINITY
): T[] {
  if (!Array.isArray(input)) throw new Reject("invalid", `${where}: expected an array`);
  if (input.length > max) throw new Reject("invalid", `${where}: more than ${max} items`);
  const out: T[] = [];
  for (let i = 0; i < input.length; i++) out.push(check<T>(schema, input[i], `${where}.${i}`));
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rest(raw: Record<string, unknown>, ...omit: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    // An own "__proto__" key from JSON.parse must not reach the setter, or it
    // could supply required fields through the prototype.
    if (key === "__proto__" || omit.includes(key)) continue;
    Object.defineProperty(copy, key, {
      value: raw[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

function checkNode(raw: Record<string, unknown>, where: string): Record<string, unknown> {
  switch (raw.kind) {
    case "element": {
      const style = isRecord(raw.style) ? raw.style : undefined;
      // A hover that is not an object stays as it is, for the schema to refuse.
      const hover = isRecord(raw.hover) ? raw.hover : undefined;
      const out = check<Record<string, unknown>>(
        parts.element,
        {
          ...rest(raw, "children", "hover"),
          style: style && rest(style, "backgroundImages", "boxShadows", "filters"),
          ...(raw.hover === undefined
            ? {}
            : { hover: hover ? rest(hover, "boxShadows") : raw.hover }),
        },
        where
      );
      if (hover?.boxShadows !== undefined) {
        const list = hover.boxShadows;
        if (!Array.isArray(list) || list.length > parts.maxHoverShadows) {
          throw new Reject("invalid", `${where}.hover.boxShadows: expected a short array`);
        }
        (out.hover as Record<string, unknown>).boxShadows = checkList(
          parts.boxShadow,
          list,
          `${where}.hover.boxShadows`
        );
      }
      const styleOut = out.style as Record<string, unknown>;
      styleOut.backgroundImages = checkBackgrounds(
        style?.backgroundImages,
        `${where}.style.backgroundImages`
      );
      styleOut.boxShadows = checkList(
        parts.boxShadow,
        style?.boxShadows,
        `${where}.style.boxShadows`
      );
      styleOut.filters = checkList(parts.string, style?.filters, `${where}.style.filters`);
      return out;
    }
    case "text": {
      const out = check<Record<string, unknown>>(parts.text, rest(raw, "lines", "runs"), where);
      out.lines = checkList(parts.box, raw.lines, `${where}.lines`);
      out.runs = checkList(parts.textRun, raw.runs, `${where}.runs`);
      return out;
    }
    case "image":
      return check(parts.image, raw, where);
    case "svg":
      return check(parts.svg, raw, where);
    case "placeholder":
      return check(parts.placeholder, raw, where);
    default:
      throw new Reject("invalid", `${where}.kind: unknown node kind`);
  }
}

function checkBackgrounds(input: unknown, where: string): unknown[] {
  if (!Array.isArray(input)) throw new Reject("invalid", `${where}: expected an array`);
  return input.map((item, i) => {
    const at = `${where}.${i}`;
    if (!isRecord(item)) throw new Reject("invalid", `${at}: expected an object`);
    const out = check<Record<string, unknown>>(parts.backgroundImage, rest(item, "stops"), at);
    if (item.stops !== undefined) {
      out.stops = checkList(parts.stop, item.stops, `${at}.stops`, MAX_GRADIENT_STOPS);
    }
    return out;
  });
}

type Pending = { raw: Record<string, unknown>; out: Record<string, unknown>; depth: number };

/**
 * Validate and copy the node tree with an explicit stack: no recursion, depth
 * and node count enforced before anything is queued, each node checked on its
 * own.
 */
function checkTree(
  rootRaw: unknown,
  limits: { nodes: number; depth: number }
): Record<string, unknown> {
  if (!isRecord(rootRaw)) throw new Reject("invalid", "root: expected an object");
  const root: Record<string, unknown> = {};
  const stack: Pending[] = [{ raw: rootRaw, out: root, depth: 1 }];
  let nodes = 1;
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    Object.assign(
      item.out,
      checkNode(
        item.raw,
        typeof item.raw.id === "string" ? `node ${item.raw.id.slice(0, 40)}` : "root"
      )
    );
    if (item.raw.kind !== "element") continue;
    const children = item.raw.children;
    if (!Array.isArray(children)) {
      throw new Reject("invalid", "children: expected an array");
    }
    const outChildren: unknown[] = [];
    item.out.children = outChildren;
    if (children.length > 0 && item.depth + 1 > limits.depth) {
      throw new Reject("too-deep", "The capture is nested too deeply");
    }
    for (const child of children) {
      if (!isRecord(child)) throw new Reject("invalid", "children: expected objects");
      if (nodes + 1 > limits.nodes) {
        throw new Reject("too-many-nodes", "The capture has too many nodes");
      }
      nodes++;
      const out: Record<string, unknown> = {};
      outChildren.push(out);
      stack.push({ raw: child, out, depth: item.depth + 1 });
    }
  }
  return root;
}

export function parseCapture(
  input: unknown,
  limits: { nodes: number; depth: number } = LIMITS
): ParseResult {
  try {
    if (!isRecord(input)) {
      return { ok: false, reason: "invalid", detail: "Capture must be an object" };
    }
    const version = input.schemaVersion;
    if (typeof version === "number" && version > SCHEMA_VERSION) {
      return {
        ok: false,
        reason: "newer-version",
        detail: `Capture uses schema version ${version}; this plugin reads up to ${SCHEMA_VERSION}`,
      };
    }
    const shell = check<Record<string, unknown>>(
      parts.captureShell,
      rest(input, "fonts", "assets", "warnings", "tokens", "root"),
      ""
    );
    const tokens = checkTokens(input.tokens);
    const fonts = checkList(parts.font, input.fonts, "fonts");
    const assets = checkList(parts.asset, input.assets, "assets");
    const warnings = checkList(parts.warning, input.warnings, "warnings");
    const root = checkTree(input.root, limits);
    return {
      ok: true,
      capture: { ...shell, tokens, fonts, assets, warnings, root } as unknown as Capture,
    };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.reason, detail: e.message };
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      return { ok: false, reason: "too-deep", detail: "The capture is nested too deeply" };
    }
    if (e instanceof RangeError) {
      return { ok: false, reason: "invalid", detail: "The capture is too large to read" };
    }
    throw e;
  }
}

function checkTokens(input: unknown): { cssCustomProperties: Record<string, string> } {
  if (!isRecord(input) || !isRecord(input.cssCustomProperties)) {
    throw new Reject("invalid", "tokens.cssCustomProperties: expected an object");
  }
  const out: Record<string, string> = {};
  for (const key of Object.keys(input.cssCustomProperties)) {
    if (key === "__proto__") continue; // z.record skips it too
    const value = input.cssCustomProperties[key];
    if (typeof value !== "string") {
      throw new Reject(
        "invalid",
        `tokens.cssCustomProperties.${key.slice(0, 80)}: expected a string`
      );
    }
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { cssCustomProperties: out };
}

export function countNodes(root: CaptureNode): number {
  let n = 0;
  const stack: CaptureNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    n++;
    if (node.kind === "element") stack.push(...node.children);
  }
  return n;
}
