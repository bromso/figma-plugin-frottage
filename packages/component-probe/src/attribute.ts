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

export function clearComponents(doc: Document): void {
  for (const el of doc.querySelectorAll(`[${ATTRIBUTE}]`)) el.removeAttribute(ATTRIBUTE);
}
