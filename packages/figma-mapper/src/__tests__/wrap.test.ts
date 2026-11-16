import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode, ElementNode } from "@repo/capture-schema";
import { type DeviceEntry, mergeDevices } from "../devices";
import { mapCaptureParts } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

const ON = { ...DEFAULT_IMPORT_OPTIONS, components: true, layers: true };
const SIZES = { Laptop: [1512, 982], Phone: [390, 844] } as const;

type InstanceOp = Extract<PlanOp, { op: "instance" }>;

function on(name: keyof typeof SIZES, children: CaptureNode[]): DeviceEntry {
  const [width, height] = SIZES[name];
  const capture = cap(el("root", [0, 0], children, { semantic: { tag: "body" } }));
  capture.source.url = "https://mainline.example.com/";
  capture.source.viewport.w = width;
  capture.version = {
    label: name,
    kind: "viewport",
    device: { id: name.toLowerCase(), name, height },
  };
  capture.breakpoints = { widths: [640, 768, 1024, 1280, 1400], unreadable: 0 };
  capture.tokens = { cssCustomProperties: {} };
  return { capture, ...mapCaptureParts(capture, inter, ON) };
}

const QUESTION = "How do I update my account without breaking my laptop?";

/**
 * A coded trigger: a row as wide as `width`, its question on the left and a box on the right.
 * Where the row is too narrow, the question wraps onto two lines in the room left of the box.
 */
function trigger(id: string, width: number): ElementNode {
  const base = el(id, [0, 0]);
  const room = width - 16;
  const lines = room < 384 ? 2 : 1;
  const lineW = lines === 2 ? 245 : 384;
  const label = textNode(`${id}-t`, {
    text: QUESTION,
    box: { x: 0, y: 16, w: lineW, h: 20 * lines },
    lines: Array.from({ length: lines }, (_, i) => ({ x: 0, y: 16 + 20 * i, w: lineW, h: 20 })),
    runs: [run({ end: QUESTION.length })],
  });
  const box = el(`${id}-b`, [width - 16, 16 + (20 * lines - 16) / 2], [], {}, [16, 16]);
  return el(
    id,
    [0, 0],
    [label, box],
    {
      layout: {
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        justifyContent: "space-between",
        alignItems: "center",
        gap: [0, 0],
        position: "static",
        padding: [16, 0, 16, 0],
        margin: [0, 0, 0, 0],
        order: 0,
        grow: 0,
        shrink: 1,
      },
      style: base.style,
      component: { source: "react", name: "Trigger", props: {} },
    },
    [width, 32 + 20 * lines]
  );
}

const instancesOf = (plan: LayerPlan) =>
  plan.ops.filter((o): o is InstanceOp => o.op === "instance");

describe("a row's label that wraps", () => {
  test("a label that wraps on the Phone is the same component, wrapped again", () => {
    const merge = mergeDevices([
      on("Laptop", [trigger("la", 456), trigger("lb", 456)]),
      on("Phone", [trigger("pa", 322), trigger("pb", 322)]),
    ]);
    expect(merge.report.some((line) => line.includes("look different"))).toBe(false);
    const [laptop, phone] = merge.plans.map((plan) => instancesOf(plan));
    expect(phone?.map((o) => o.key)).toEqual(["component:Trigger", "component:Trigger"]);
    for (const o of phone ?? []) {
      expect(o.overrides).toContainEqual({ path: [0], kind: "wrap", wraps: true });
    }
    for (const o of laptop ?? []) expect(o.overrides.some((v) => v.kind === "wrap")).toBe(false);
  });

  test("a label on one line where its main's wraps goes back to one line", () => {
    const merge = mergeDevices([on("Laptop", [trigger("la", 322), trigger("lb", 456)])]);
    const [, b] = instancesOf(merge.plans[0] as LayerPlan);
    expect(b?.overrides).toContainEqual({ path: [0], kind: "wrap", wraps: false });
  });
});
