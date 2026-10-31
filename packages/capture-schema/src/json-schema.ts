import { z } from "zod";
import { captureSchema } from "./schema";

export function captureJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(captureSchema, { unrepresentable: "any" }) as Record<string, unknown>;
}

if (import.meta.main && process.argv.includes("--write")) {
  await Bun.write(
    new URL("../schema/capture-v1.json", import.meta.url),
    `${JSON.stringify(captureJsonSchema(), null, 2)}\n`
  );
}
