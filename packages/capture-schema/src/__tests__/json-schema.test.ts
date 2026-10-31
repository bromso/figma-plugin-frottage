import { expect, test } from "bun:test";
import { captureJsonSchema } from "../index";

test("committed JSON Schema matches the Zod schema", async () => {
  expect(await Bun.file("schema/capture-v1.json").json()).toEqual(captureJsonSchema());
});
