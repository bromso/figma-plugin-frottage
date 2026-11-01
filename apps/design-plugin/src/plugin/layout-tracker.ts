import type { PlanChildLayout, PlanOp } from "@repo/figma-mapper";
import { type ExpectedChild, type ExpectedLayout, TOL, verifyFrame } from "./verify-layout";

/**
 * Follows frames in auto layout from creation to verification, and takes back to absolute the ones
 * that do not match the capture. Works out when a frame's size is final, as that decides when it can
 * be judged. Runs in the plugin sandbox, so this module too only takes types from @repo/figma-mapper.
 */

type FrameOp = Extract<PlanOp, { op: "frame" }>;
type Sizing = PlanChildLayout["sizingH"];

const LENGTH_FIELDS = new Set([
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gridRowGap",
  "gridColumnGap",
]);

/** The kinds of node an op makes. */
export type Built = FrameNode | ComponentNode | InstanceNode | TextNode | RectangleNode;

/** What wrapped text must fit: the captured width, and the height that means its line count. */
/** `max` is the widest the text may go, where a clipping parent would cut its line ends off. */
export type TextFit = { w: number; limit: number; max?: number };

/** What a fallback needs beyond what verification reads. `fit` marks wrapped text set to FILL. */
type Child = ExpectedChild & { node: Built; align: string; fit?: TextFit };

/** A frame in auto layout, from its creation until it has been verified. */
type LaidFrame = {
  id: string;
  frame: FrameNode;
  op: FrameOp;
  sizingH: Sizing;
  sizingV: Sizing;
  /** Its entry among its parent's children. */
  child: Child | null;
  /** Null when the parent is not in auto layout: nothing about this frame affects it then. */
  parent: LaidFrame | null;
  children: Child[];
  /** Whether to turn the frame once its size is final: a rotated frame that auto layout sizes. */
  turn: boolean;
  /** FILL text, whose lines can only be judged once this frame's size is final. */
  fillTexts: Child[];
  containsText: boolean;
  /** Direct children still to arrive, or whose own content is still to arrive. */
  waiting: number;
  /** Finished FILL children, whose size this frame's other children still decide. */
  deferred: LaidFrame[];
};

const MIN_SIZE = 0.01;
const MAX_WIDEN_STEPS = 8;
/** Reads are quick, but a fallback writes, so the applier's time limit is not the only one. */
const MAX_VERIFIES_PER_SLICE = 200;

/**
 * Turns a placed node about the centre its op gave it, using the size it has now. Sets the whole
 * transform, so its x and y become where the unturned corner went.
 */
export function turnAbout(
  node: SceneNode,
  box: { x: number; y: number; w: number; h: number },
  degrees: number
) {
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const { width, height } = node;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  node.relativeTransform = [
    [cos, -sin, cx - ((width / 2) * cos - (height / 2) * sin)],
    [sin, cos, cy - ((width / 2) * sin + (height / 2) * cos)],
  ];
}

export const clampSize = (n: number) => Math.max(n, MIN_SIZE);

/** x for a text box of `actual` width that must stay anchored inside the captured `w`. */
export function alignedX(align: string, x: number, w: number, actual: number): number {
  if (align === "CENTER") return x + (w - actual) / 2;
  if (align === "RIGHT") return x + w - actual;
  return x;
}

/**
 * Sets wrapped text to its captured width, widening it until it is back to its line count. False
 * if it never gets there.
 */
export function widenToLines(node: TextNode, fit: TextFit): boolean {
  // Keep the current height: a different one switches HEIGHT mode to NONE.
  node.resize(clampSize(fit.w), clampSize(node.height));
  for (let step = 1; node.height > fit.limit && step <= MAX_WIDEN_STEPS; step++) {
    const w = fit.w + (fit.w * step) / 100;
    if (fit.max !== undefined && w > fit.max) break;
    node.resize(clampSize(w), clampSize(node.height));
  }
  return node.height <= fit.limit;
}

export function createLayoutTracker() {
  let rewrappedTexts = 0;
  let autoLayoutFrames = 0;
  let fallbackFrames = 0;
  let textDriftCount = 0;
  const fallbackReasons: Record<string, number> = {};
  /** Frames with children to come, in creation order, so parents come before their children. */
  let open = new Map<string, LaidFrame>();
  /** Finished frames to verify, children before parents. */
  let ready: LaidFrame[] = [];
  /** Definitions in auto layout, by key, which say whether an instance of one holds text. */
  const mains = new Map<string, LaidFrame>();

  function noteReason(reason: string) {
    fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
  }

  function countFallback(reason: string) {
    fallbackFrames++;
    noteReason(reason);
  }

  /** One failed step must not stop the rest: a frame half put back is worse than one bad child. */
  function attempt(step: () => void) {
    try {
      step();
    } catch {
      noteReason("error");
    }
  }

  function passTextUp({ containsText, child, parent }: LaidFrame) {
    if (child) child.containsText = containsText;
    if (parent && containsText) parent.containsText = true;
  }

  /** Counts one child in. True when that was the last one. */
  function arrived(frame: LaidFrame): boolean {
    frame.waiting--;
    return frame.waiting <= 0 && open.has(frame.id);
  }

  /**
   * A frame is finished when its children and all that is below them are. Walks up rather than
   * recursing, as one op can finish a deep chain. A FILL frame is verified along with its parent:
   * until the parent has all its children, the frame's size is not its final one.
   */
  function finish(first: LaidFrame) {
    let current: LaidFrame | undefined = first;
    while (current) {
      const { id, parent, deferred, sizingH, sizingV }: LaidFrame = current;
      open.delete(id);
      const waitsForParent =
        parent && open.has(parent.id) && (sizingH === "FILL" || sizingV === "FILL");
      const target = waitsForParent ? parent.deferred : ready;
      for (const frame of deferred) target.push(frame);
      target.push(current);
      passTextUp(current);
      current = parent && arrived(parent) ? parent : undefined;
    }
  }

  /** Back to FIXED and widened, for FILL text that the frame's final width gave extra lines. */
  function checkLines(c: Child) {
    const { fit } = c;
    if (!fit || c.node.height <= fit.limit) return;
    const node = c.node as TextNode;
    node.layoutSizingHorizontal = "FIXED";
    c.sizingH = "FIXED";
    c.fit = undefined;
    if (!widenToLines(node, fit)) rewrappedTexts++;
  }

  /** A box that fills is wider than the text in it by design, so only its height can drift. */
  function countDrift({ node, w, h, text, sizingH }: Child) {
    if (!text) return;
    const wide = sizingH !== "FILL" && Math.abs(node.width - w) > TOL;
    if (wide || Math.abs(node.height - h) > TOL) textDriftCount++;
  }

  function placeChild(c: Child) {
    const { node } = c;
    // Its parent's layout never placed it, and writing x and y would move a turned node's corner.
    if (c.rotated) return;
    if (c.fit) {
      // Nothing gives it its width now, and it may have been keeping its lines on a wider box.
      if (!widenToLines(node as TextNode, c.fit)) rewrappedTexts++;
      c.fit = undefined;
    } else if (!c.text && (c.sizingH === "FILL" || c.sizingV === "FILL")) {
      const sized = node as FrameNode;
      sized.resize(
        clampSize(c.sizingH === "FILL" ? c.w : node.width),
        clampSize(c.sizingV === "FILL" ? c.h : node.height)
      );
      if (c.sizingH === "HUG") sized.layoutSizingHorizontal = "HUG";
      if (c.sizingV === "HUG") sized.layoutSizingVertical = "HUG";
    }
    node.x = alignedX(c.align, c.x, c.w, node.width);
    node.y = c.y;
  }

  /**
   * Puts the frame back to absolute, leaving its children's own layout alone. Text keeps its
   * measured height, and a child that hugged goes on hugging; only a FILL axis has lost its source.
   */
  function fallBack({ frame, op, parent, child, sizingH, sizingV, children }: LaidFrame) {
    attempt(() => {
      frame.layoutMode = "NONE";
    });
    // Spacing bound to a layout the frame no longer has would only mislead.
    for (const field of Object.keys(frame.boundVariables ?? {})) {
      if (LENGTH_FIELDS.has(field)) {
        attempt(() => frame.setBoundVariable(field as VariableBindableNodeField, null));
      }
    }
    attempt(() => {
      frame.resize(clampSize(op.w), clampSize(op.h));
      if (parent && parent.frame.layoutMode !== "NONE") {
        if (sizingH === "FILL") frame.layoutSizingHorizontal = "FILL";
        if (sizingV === "FILL") frame.layoutSizingVertical = "FILL";
      }
    });
    for (const c of children) attempt(() => placeChild(c));
    if (child) {
      child.sizingH = sizingH === "FILL" ? "FILL" : "FIXED";
      child.sizingV = sizingV === "FILL" ? "FILL" : "FIXED";
    }
  }

  function expectation(frame: LaidFrame): ExpectedLayout {
    return {
      layout: frame.op.layout as ExpectedLayout["layout"],
      w: frame.op.w,
      h: frame.op.h,
      containsText: frame.containsText,
      sizingH: frame.sizingH,
      sizingV: frame.sizingV,
      children: frame.children,
    };
  }

  function verify(frame: LaidFrame) {
    for (const c of frame.fillTexts) attempt(() => checkLines(c));
    for (const c of frame.children) attempt(() => countDrift(c));
    let reason: string | undefined;
    try {
      const verdict = verifyFrame(frame.frame, expectation(frame));
      if (verdict.ok) autoLayoutFrames++;
      else reason = verdict.reason ?? "unknown";
    } catch {
      reason = "error";
    }
    if (reason !== undefined) {
      countFallback(reason);
      fallBack(frame);
    }
    // Last, from the size it ended with: turning it earlier would let a later resize move its centre.
    if (frame.turn) attempt(() => turnAbout(frame.frame, frame.op, frame.op.rotation as number));
  }

  return {
    countFallback,
    noteRewrapped() {
      rewrappedTexts++;
    },

    /** Records what the op made, so that its parent and the node itself can be verified. */
    track(op: PlanOp, node: Built, fit: TextFit | null) {
      const parent = op.parent === null ? undefined : open.get(op.parent);
      const auto = op.op === "frame" && (node as FrameNode).layoutMode !== "NONE";
      const own = auto && op.layout.mode !== "NONE" && op.layout.mode !== "GRID" ? op.layout : null;
      const sizing = (axis: "sizingH" | "sizingV"): Sizing => {
        if (op.childLayout?.[axis] === "FILL") return "FILL";
        // A leaf, which sizes itself as its main does, or as the applier left it.
        if (op.op === "instance") {
          const { layoutSizingHorizontal: h, layoutSizingVertical: v } = node as InstanceNode;
          return axis === "sizingH" ? h : v;
        }
        return own?.[axis] ?? "FIXED";
      };
      const sizingH = sizing("sizingH");
      const sizingV = sizing("sizingV");
      let child: Child | null = null;
      if (parent) {
        child = {
          node,
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          absolute: op.childLayout?.positioning === "ABSOLUTE",
          rotated: "rotation" in op && Boolean(op.rotation),
          text: op.op === "text",
          containsText: op.op === "instance" && mains.get(op.key)?.containsText === true,
          sizingH,
          sizingV,
          align: op.op === "text" ? op.align : "LEFT",
        };
        parent.children.push(child);
        if (op.op === "text" || child.containsText) parent.containsText = true;
        if (fit) {
          child.fit = fit;
          parent.fillTexts.push(child);
        }
      }
      if (op.op === "frame" && auto) {
        const frame: LaidFrame = {
          id: op.id,
          frame: node as FrameNode,
          op,
          sizingH,
          sizingV,
          child,
          parent: parent ?? null,
          turn:
            op.parent !== null && Boolean(op.rotation) && op.childLayout?.positioning !== "AUTO",
          children: [],
          fillTexts: [],
          containsText: false,
          waiting: op.childCount,
          deferred: [],
        };
        open.set(op.id, frame);
        if (op.component) mains.set(op.component.key, frame);
        if (op.childCount <= 0) finish(frame);
      } else if (parent && arrived(parent)) {
        finish(parent);
      }
    },

    /** A failed child is one less to wait for; verification judges the frame without it. */
    failed(op: PlanOp) {
      const parent = op.parent === null ? undefined : open.get(op.parent);
      if (parent && arrived(parent)) finish(parent);
    },

    /** Verifies what is ready. `yieldNow` says when, `breathe` does it; false means stop. */
    async drain(yieldNow: () => boolean, breathe: () => Promise<boolean>): Promise<boolean> {
      let verified = 0;
      for (let i = 0; i < ready.length; i++) {
        if (verified >= MAX_VERIFIES_PER_SLICE || yieldNow()) {
          if (!(await breathe())) return false;
          verified = 0;
        }
        verify(ready[i] as LaidFrame);
        verified++;
      }
      ready = [];
      return true;
    },

    /** Frames still open never got all their ops. Latest first: children come after their parents. */
    closeOpen() {
      for (const frame of [...open.values()].reverse()) {
        for (const deferred of frame.deferred) ready.push(deferred);
        ready.push(frame);
        passTextUp(frame);
      }
      open = new Map();
    },

    counts: () => ({
      rewrappedTexts,
      autoLayoutFrames,
      fallbackFrames,
      fallbackReasons,
      textDriftCount,
    }),
  };
}
