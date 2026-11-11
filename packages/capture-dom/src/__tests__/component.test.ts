import { describe, expect, test } from "bun:test";
import { ATTRIBUTE } from "@repo/component-probe/attribute";
import { Window } from "happy-dom";
import { componentOf } from "../component";

function tagged(value: string | null): Element {
  const doc = new Window().document as unknown as Document;
  const el = doc.createElement("button");
  if (value !== null) el.setAttribute(ATTRIBUTE, value);
  return el;
}
const BUTTON = { source: "react", name: "Button", props: { variant: "outline", size: "icon" } };
const props = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]));

describe("componentOf", () => {
  test("reads the probe's attribute into the node's component", () => {
    expect(componentOf(tagged(JSON.stringify(BUTTON)))).toEqual(BUTTON as never);
    const renamed = { ...BUTTON, codeName: "o", props: { disabled: true, level: 2 } };
    expect(componentOf(tagged(JSON.stringify(renamed)))).toEqual(renamed as never);
  });
  test("an element without it has none", () => {
    expect(componentOf(tagged(null))).toBeUndefined();
  });
  test("keeps only the known fields", () => {
    const extra = { ...BUTTON, label: "Jane Doe" };
    expect(componentOf(tagged(JSON.stringify(extra)))).toEqual(BUTTON as never);
  });
  test.each([
    ["malformed JSON", "{"],
    ["not an object", '"Button"'],
    ["null", "null"],
    ["an array", "[]"],
    ["a bad source", JSON.stringify({ ...BUTTON, source: "svelte" })],
    ["an empty name", JSON.stringify({ ...BUTTON, name: "" })],
    ["a 41-character name", JSON.stringify({ ...BUTTON, name: "B".repeat(41) })],
    ["a 41-character code name", JSON.stringify({ ...BUTTON, codeName: "o".repeat(41) })],
    ["17 props", JSON.stringify({ ...BUTTON, props: props(17) })],
    ["props as an array", JSON.stringify({ ...BUTTON, props: [] })],
    ["no props", JSON.stringify({ source: "react", name: "Button" })],
    ["a value with a space", JSON.stringify({ ...BUTTON, props: { label: "Jane Doe" } })],
    ["a value with an @", JSON.stringify({ ...BUTTON, props: { v: "a@b" } })],
    ["a 25-character value", JSON.stringify({ ...BUTTON, props: { v: "a".repeat(25) } })],
    ["a null value", JSON.stringify({ ...BUTTON, props: { v: null } })],
    ["a 41-character key", JSON.stringify({ ...BUTTON, props: { ["k".repeat(41)]: 1 } })],
    ["a __proto__ key", `{"source":"react","name":"Button","props":{"__proto__":{"x":1}}}`],
  ])("ignores the whole value for %s", (_, value) => {
    expect(componentOf(tagged(value))).toBeUndefined();
  });
  test("16 props are kept", () => {
    expect(componentOf(tagged(JSON.stringify({ ...BUTTON, props: props(16) })))?.props).toEqual(
      props(16)
    );
  });
});
