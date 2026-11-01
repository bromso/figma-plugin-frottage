import { expect, test } from "bun:test";
import { captureJsonSchema } from "../json-schema";

test("committed JSON Schema matches the Zod schema", async () => {
  expect(await Bun.file("schema/capture-v1.json").json()).toEqual(captureJsonSchema());
});

test("the JSON Schema bounds gradient stops", () => {
  expect(JSON.stringify(captureJsonSchema())).toContain('"maxItems":256');
});
