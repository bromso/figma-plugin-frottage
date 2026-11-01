import { type Capture, LIMITS, packFrottageSet } from "@repo/capture-schema";

/** 180 MiB of images plus the capture JSON stays under the 256 MiB import limit. */
const ASSET_BYTES = 180 * 1024 * 1024;

export type SetLimits = { totalBytes: number; assetBytes: number };

/**
 * The captures of one run, held in memory until the run ends and they are packed into one file.
 * An image used by several captures is kept, and counted, once.
 */
export class CaptureSet {
  private captures: Capture[] = [];
  private assets = new Map<string, Uint8Array>();
  private jsonBytes = 0;
  private assetBytes = 0;

  constructor(
    private limits: SetLimits = { totalBytes: LIMITS.totalBytes, assetBytes: ASSET_BYTES }
  ) {}

  get size(): number {
    return this.captures.length;
  }

  /** Keeps the capture and the images it lists; false, keeping nothing, when a limit would pass. */
  add(capture: Capture, assets: Map<string, Uint8Array>): boolean {
    const json = new TextEncoder().encode(JSON.stringify(capture)).length;
    const fresh = new Map<string, Uint8Array>();
    let freshBytes = 0;
    for (const [hash, bytes] of assets) {
      if (this.assets.has(hash) || fresh.has(hash)) continue;
      fresh.set(hash, bytes);
      freshBytes += bytes.length;
    }
    if (this.assetBytes + freshBytes > this.limits.assetBytes) return false;
    if (this.jsonBytes + json + this.assetBytes + freshBytes > this.limits.totalBytes) return false;
    this.captures.push(capture);
    for (const [hash, bytes] of fresh) this.assets.set(hash, bytes);
    this.jsonBytes += json;
    this.assetBytes += freshBytes;
    return true;
  }

  /** The kept captures and the images they list, as one file. */
  pack(): Uint8Array {
    return packFrottageSet(this.captures, this.assets);
  }
}
