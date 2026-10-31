import type { CaptureNode, ElementNode } from "@repo/capture-schema";

const MAX = 40;
/** How many nodes are looked at below an element when reading its text. */
const SCAN = 40;

const LANDMARKS: Record<string, string> = {
  banner: "Header",
  navigation: "Navigation",
  main: "Main",
  contentinfo: "Footer",
  complementary: "Aside",
  form: "Form",
  search: "Search",
  region: "Region",
};

const ROLES: Record<string, string> = {
  ...LANDMARKS,
  dialog: "Dialog",
  alertdialog: "Dialog",
  alert: "Alert",
  button: "Button",
  link: "Link",
  list: "List",
  listitem: "Item",
  tab: "Tab",
  tablist: "Tabs",
  tabpanel: "Tab panel",
  menu: "Menu",
  menuitem: "Menu item",
  menubar: "Menu",
  tooltip: "Tooltip",
  table: "Table",
  row: "Row",
  cell: "Cell",
  img: "Image",
  figure: "Figure",
  heading: "Heading",
  checkbox: "Checkbox",
  switch: "Switch",
  radio: "Radio",
  textbox: "Input",
  combobox: "Select",
  listbox: "List",
  option: "Option",
  progressbar: "Progress",
};

const TAGS: Record<string, string> = {
  ul: "List",
  ol: "List",
  li: "Item",
  p: "Paragraph",
  section: "Section",
  article: "Article",
  aside: "Aside",
  header: "Header",
  footer: "Footer",
  nav: "Navigation",
  main: "Main",
  a: "Link",
  button: "Button",
  form: "Form",
  table: "Table",
  thead: "Table head",
  tbody: "Table body",
  tr: "Row",
  td: "Cell",
  th: "Cell",
  label: "Label",
  input: "Input",
  textarea: "Input",
  select: "Select",
  figure: "Figure",
  figcaption: "Caption",
  blockquote: "Quote",
  pre: "Code",
  code: "Code",
  fieldset: "Group",
  legend: "Legend",
  dialog: "Dialog",
  details: "Details",
  summary: "Summary",
  picture: "Image",
  video: "Video",
  canvas: "Canvas",
  iframe: "Embed",
  hr: "Divider",
  svg: "Icon",
  img: "Image",
  dl: "Definitions",
  dt: "Term",
  dd: "Definition",
  body: "Page",
  html: "Page",
};

const PLACEHOLDERS: Record<string, string> = {
  canvas: "Canvas",
  video: "Video",
  "cross-origin-iframe": "Embed",
  "blocked-image": "Image",
};

const INTERACTIVE = new Set(["a", "button", "summary"]);
const CLASS_STOP = new Set([
  "flex",
  "grid",
  "row",
  "col",
  "cols",
  "column",
  "container",
  "wrapper",
  "wrap",
  "inner",
  "outer",
  "block",
  "inline",
  "hidden",
  "show",
  "hide",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "clearfix",
  "active",
  "open",
  "closed",
  "disabled",
  "selected",
  "visible",
  "left",
  "right",
  "center",
  "centered",
  "first",
  "last",
  "item",
  "items",
  "box",
  "group",
  "stack",
  "full",
  "auto",
  "static",
  "bold",
  "root",
  "app",
  "layout",
  "page",
  "provider",
  "truncate",
  "shrink",
  "grow",
  "underline",
  "uppercase",
  "lowercase",
  "capitalize",
  "rounded",
  "antialiased",
  "transform",
  "table",
  "contents",
  "italic",
  "border",
  "shadow",
  "ring",
  "outline",
  "transition",
  "invisible",
  "collapse",
  "isolate",
  "btn",
]);
const UTILITY =
  /^-?(?:inline|block|sr|no|not|pointer|select|whitespace|break|line|outline|decoration|list|divide|place|aspect|columns|fill|stroke|backdrop|filter|blur|mix|animate|will|appearance|resize|snap|touch|transform|table|truncate|underline|uppercase|rounded|antialiased)(?:[-_]|$)|^-?(?:m|p|w|h|gap|text|bg|border|rounded|flex|grid|col|row|items|justify|self|space|font|leading|tracking|min|max|top|left|right|bottom|z|order|opacity|shadow|overflow|ring|inset|basis|grow|shrink|display|d|align|float|object|cursor|transition|duration|translate|rotate|scale|sm|md|lg|xl|container|is|has|u|js)[xytrbl]?[-_]/i;
const HASH_PREFIX = /^(?:css|sc|jsx|svelte|astro|emotion|styled|chakra|mui)[-_]/i;

/** A class token that looks generated: it mixes digits and letters, or carries a CSS-in-JS prefix. */
function looksHashed(token: string): boolean {
  return (/\d/.test(token) && /[a-z]/i.test(token)) || HASH_PREFIX.test(token) || /^_/.test(token);
}

/** The words of a readable class, or null for hashed, utility or layout-only classes. */
function classWords(raw: string | undefined): string | null {
  if (!raw || raw.length > MAX || !/^[A-Za-z][\w-]*$/.test(raw)) return null;
  if (looksHashed(raw) || CLASS_STOP.has(raw.toLowerCase()) || UTILITY.test(raw)) return null;
  // Abbreviations such as `btn`, `wrp` or `hdr` are not names.
  if (/^[^aeiouy]+$/i.test(raw)) return null;
  const words = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.length >= 3 ? sentence(words) : null;
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function strip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const head = flat.replace(/^[^\p{L}\p{N}"'“$€£(+#@]+/u, "");
  // An emoji-only label stays as it is.
  const body = head === "" ? flat : head;
  return body.replace(/[\s\-–—.,:;!?|/\\…]+$/, "") || body;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const graphemes = (s: string): string[] =>
  segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);

/** Whitespace collapsed, trailing punctuation gone, cut on a word at 40 characters, no ellipsis. */
function clip(raw: string): string {
  const s = strip(raw);
  if (s.length <= MAX) return s;
  const parts = graphemes(s);
  if (parts.length <= MAX) return s;
  const head = parts.slice(0, MAX);
  let cut = head;
  if (!/^\s$/.test(parts[MAX] as string)) {
    const space = head.lastIndexOf(" ");
    if (space > 0) cut = head.slice(0, space);
  }
  return strip(cut.join(""));
}

type Found = { texts: string[]; heading: string | undefined; complete: boolean };

/** Reads the first pieces of text below an element, bounded so a huge subtree stays cheap. */
function scan(node: CaptureNode): Found {
  const found: Found = { texts: [], heading: undefined, complete: true };
  let seen = 0;
  const stack: CaptureNode[] = node.kind === "element" ? [...node.children].reverse() : [];
  while (stack.length > 0) {
    const n = stack.pop() as CaptureNode;
    if (++seen > SCAN) {
      found.complete = false;
      break;
    }
    if (n.kind === "text") {
      const t = strip(n.text);
      if (t) {
        found.texts.push(t);
        if (found.heading === undefined && /^h[1-6]$/.test(n.semantic.tag)) found.heading = t;
      }
    } else if (n.kind === "element") {
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as CaptureNode);
    }
  }
  return found;
}

const numbering = new WeakMap<CaptureNode[], Map<string, number>>();

/** Position among same-tag siblings, for tags that occur more than once; built once per array. */
function repeatIndex(node: CaptureNode, siblings: CaptureNode[]): number | null {
  let map = numbering.get(siblings);
  if (!map) {
    const total = new Map<string, number>();
    for (const n of siblings) total.set(n.semantic.tag, (total.get(n.semantic.tag) ?? 0) + 1);
    const seen = new Map<string, number>();
    map = new Map();
    for (const n of siblings) {
      const tag = n.semantic.tag;
      const k = (seen.get(tag) ?? 0) + 1;
      seen.set(tag, k);
      if ((total.get(tag) ?? 0) > 1) map.set(n.id, k);
    }
    numbering.set(siblings, map);
  }
  return map.get(node.id) ?? null;
}

const MEANINGLESS = new Set(["provider", "wrapper", "root", "app", "container", "layout"]);

/** The words of a custom element, or null for a plain tag; `meaningless` for providers and the like. */
function customName(tag: string): { name: string; meaningless: boolean } | null {
  if (!tag.includes("-") || tag.startsWith("::")) return null;
  const parts = tag.split("-").filter(Boolean);
  const rest = parts.length > 1 && (parts[0] as string).length <= 5 ? parts.slice(1) : parts;
  return {
    name: sentence(rest.join(" ").toLowerCase()),
    meaningless: rest.some((w) => MEANINGLESS.has(w.toLowerCase())),
  };
}

const join = (prefix: string, text: string | undefined): string =>
  text ? clip(`${prefix} - ${text}`) : prefix;

function tagWord(tag: string): string {
  const known = TAGS[tag];
  if (known) return known;
  if (/^h[1-6]$/.test(tag)) return tag.toUpperCase();
  if (customName(tag)?.meaningless) return "Frame";
  const bare = tag.replace(/^[^a-zA-Z0-9]+/, "");
  return bare ? sentence(bare) : "Frame";
}

/** The heading this element opens with: its first meaningful child is, or holds, the heading. */
function leadingHeading(node: ElementNode): string | undefined {
  for (const child of node.children) {
    if (child.kind === "text") {
      const t = strip(child.text);
      if (!t) continue;
      return /^h[1-6]$/.test(child.semantic.tag) ? t : undefined;
    }
    if (child.kind !== "element") continue;
    if (/^h[1-6]$/.test(child.semantic.tag)) return scan(child).texts[0];
    return undefined;
  }
  return undefined;
}

function elementName(node: ElementNode, siblings: CaptureNode[]): string {
  const s = node.semantic;
  const tag = s.tag;
  const label = s.ariaLabel ? clip(s.ariaLabel) : "";
  const landmark = s.landmark ? LANDMARKS[s.landmark] : undefined;
  const role = s.role ? ROLES[s.role.toLowerCase()] : undefined;

  if (landmark) return join(landmark, label);
  if (/^h[1-6]$/.test(tag)) return join(tag.toUpperCase(), label || scan(node).texts[0]);
  if (INTERACTIVE.has(tag)) {
    const found = scan(node);
    return join(TAGS[tag] as string, label || found.heading || found.texts[0]);
  }
  if (label) return role && role !== "Heading" ? join(role, label) : label;
  if (role) return role;
  const custom = customName(tag);
  if (custom && !custom.meaningless) {
    const found = scan(node);
    return join(
      custom.name,
      found.complete && found.texts.length === 1 ? found.texts[0] : undefined
    );
  }
  const cls = classWords(s.className) ?? classWords(s.id);
  if (cls) return cls;
  if (tag === "li") {
    const n = repeatIndex(node, siblings);
    return n === null ? "Item" : `Item ${n}`;
  }
  const found = scan(node);
  const heading = leadingHeading(node);
  if (heading) {
    const kind =
      tag === "section"
        ? "Section"
        : tag === "article"
          ? "Article"
          : node.box.w < 480
            ? "Card"
            : "Section";
    return join(kind, heading);
  }
  if (
    found.texts.length === 1 &&
    found.complete &&
    !found.heading &&
    !TAGS[tag] &&
    !customName(tag)?.meaningless
  )
    return clip(found.texts[0] as string);
  const n = TAGS[tag] ? null : repeatIndex(node, siblings);
  if (n !== null) return `Item ${n}`;
  return tagWord(tag);
}

/**
 * The layer name for a captured node. `siblings` are the nodes it sits among (as the mapper walks
 * them), so repeated items can be numbered. With `htmlNames` an element is `tag.class`, or `tag`.
 */
export function layerName(
  node: CaptureNode,
  siblings: CaptureNode[],
  options: { htmlNames: boolean }
): string {
  const s = node.semantic;
  switch (node.kind) {
    case "text":
      if (/^h[1-6]$/.test(s.tag)) return "Heading";
      return clip(node.text) || "Text";
    case "image":
      return join("Image", s.alt ? clip(s.alt) : undefined);
    case "svg":
      return join(node.box.w <= 64 && node.box.h <= 64 ? "Icon" : "Graphic", s.ariaLabel);
    case "placeholder":
      return join(
        PLACEHOLDERS[node.placeholderKind] ?? "Placeholder",
        s.alt ? clip(s.alt) : undefined
      );
    case "element": {
      if (options.htmlNames) {
        const tag = s.tag.replace(/^[^a-zA-Z0-9]+/, "") || s.tag;
        const cls =
          s.className && /^[A-Za-z][\w-]*$/.test(s.className) && !looksHashed(s.className);
        return cls ? `${tag}.${s.className}` : tag;
      }
      return elementName(node, siblings) || "Frame";
    }
  }
}

const BARE = new Set([
  "div",
  "span",
  "frame",
  "group",
  "text",
  "svg",
  "rectangle",
  "placeholder",
  "before",
  "after",
  "graphic",
]);

/** Readable means a person could tell the layer apart: not a bare tag, a tag.class or `Component 5`. */
export function isReadableName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === "" || BARE.has(n)) return false;
  if (/^[^aeiouy\s]{1,5}$/i.test(n)) return false;
  // A number alone tells nothing: `Item 3` says where, not what.
  if (/^(?:component|item|frame|group) \d+$/.test(n)) return false;
  if (/^[a-z][a-z0-9-]*\.[\w-]+$/.test(n)) return false;
  return true;
}
