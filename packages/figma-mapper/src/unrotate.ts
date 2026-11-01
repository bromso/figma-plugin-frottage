import type { CaptureNode, ElementNode } from "@repo/capture-schema";
import { readMotion } from "./transform";

/**
 * A browser reports the box of content inside a rotated element as the bounds of its rotated
 * drawing, in page space. Figma places children in their rotated parent's own space, so before the
 * mapper reads positions the boxes are turned back to where they would be without the rotation.
 */

type Box = { x: number; y: number; w: number; h: number };
/** One rotation to undo: clockwise degrees about a point in page space. */
export type Turn = { centre: { x: number; y: number }; theta: number };

/** Below this gap between cos² and sin² the bounds of a turned box cannot give back its size. */
const AMBIGUOUS = 0.1;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
/** Exact at multiples of 90 degrees, where cos or sin is rounding noise. */
const snap = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

const centreOf = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Turns a point by `-theta` about `centre`. */
function undo(p: { x: number; y: number }, { centre, theta }: Turn) {
  const t = radians(theta);
  const c = snap(Math.cos(t));
  const s = snap(Math.sin(t));
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  // The inverse of a clockwise turn on screen.
  return { x: centre.x + dx * c + dy * s, y: centre.y - dx * s + dy * c };
}

/**
 * The box as it would be unrotated: its centre turned back through each rotation in order, its
 * size recovered from the bounds. `keepSize` is for a box that is already untransformed.
 * Returns whether the size could be recovered; near 45 degrees it cannot, and the bounds stay.
 */
export function unrotateBox(
  box: Box,
  turns: readonly Turn[],
  keepSize = false
): { box: Box; exact: boolean } {
  let centre = centreOf(box);
  for (const turn of turns) centre = undo(centre, turn);
  let { w, h } = box;
  let exact = true;
  const total = turns.reduce((sum, t) => sum + t.theta, 0);
  if (!keepSize && total !== 0) {
    const c = Math.abs(snap(Math.cos(radians(total))));
    const s = Math.abs(snap(Math.sin(radians(total))));
    const gap = c * c - s * s;
    if (Math.abs(gap) > AMBIGUOUS) {
      w = Math.max((box.w * c - box.h * s) / gap, 0);
      h = Math.max((box.h * c - box.w * s) / gap, 0);
    } else exact = false;
  }
  return { box: { x: centre.x - w / 2, y: centre.y - h / 2, w, h }, exact };
}

const rotationOf = (node: CaptureNode) =>
  node.kind === "element" ? readMotion(node.transform).rotation : undefined;

function anyRotation(root: CaptureNode): boolean {
  const stack: CaptureNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CaptureNode;
    if (rotationOf(node) !== undefined) return true;
    if (node.kind === "element") stack.push(...node.children);
  }
  return false;
}

/** The tree with every box inside a rotated element turned back. Untouched without rotation. */
export function unrotateTree(root: CaptureNode, warn: (message: string) => void): CaptureNode {
  // The import root is never turned, so what is inside it stays where the page drew it.
  if (!(root.kind === "element" && root.children.some(anyRotation))) return root;
  let approximate = false;
  let uncorrected = false;
  type Item = { src: ElementNode; dst: ElementNode; turns: Turn[] };
  const own = (node: CaptureNode, turns: Turn[]): Turn[] => {
    const motion = readMotion(node.kind === "element" ? node.transform : undefined);
    const theta = motion.rotation;
    // The bounds of content under a scale or skew do not undo with a rotation alone.
    if (theta !== undefined && (motion.scaled || motion.skewed)) uncorrected = true;
    return theta === undefined ? turns : [...turns, { centre: centreOf(node.box), theta }];
  };
  const rootCopy: ElementNode = { ...root, children: [] };
  const first: Item[] = [{ src: root, dst: rootCopy, turns: [] }];
  const stack = first;
  while (stack.length > 0) {
    const { src, dst, turns } = stack.pop() as Item;
    for (const child of src.children) {
      // A box with its own transform is already the untransformed one, centred where it is drawn.
      const keep = child.transform !== undefined;
      const moved = unrotateBox(child.box, turns, keep);
      if (!moved.exact) approximate = true;
      let next: CaptureNode = { ...child, box: moved.box };
      if (child.kind === "text") {
        next = {
          ...child,
          box: moved.box,
          lines: child.lines.map((line) => {
            const l = unrotateBox(line, turns);
            if (!l.exact) approximate = true;
            return l.box;
          }),
        };
      }
      if (child.kind === "element") {
        next = { ...child, box: moved.box, children: [] };
        // The child's own turn is about its box as it stands once the outer turns are undone.
        stack.push({
          src: child,
          dst: next,
          turns: child.children.length > 0 ? own(next, turns) : turns,
        });
      }
      dst.children.push(next);
    }
  }
  if (uncorrected) {
    warn(
      "Content inside a layer that is rotated and also scaled or skewed was not corrected for the rotation (rotated-content)."
    );
  }
  if (approximate) {
    warn(
      "Content inside a layer rotated near 45 degrees keeps the size of its rotated bounds (rotated-content)."
    );
  }
  return rootCopy;
}
