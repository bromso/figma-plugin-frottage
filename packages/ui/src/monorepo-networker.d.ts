// monorepo-networker's package.json "exports" field lacks a "types" condition,
// so TypeScript with moduleResolution: "Bundler" can't resolve the types.
// This shim re-exports from the package's declared types path.
declare module "monorepo-networker" {
  export { Networker } from "monorepo-networker/dist/networker";
  export * from "monorepo-networker/dist/types";
  export * from "monorepo-networker/dist/util/NetworkError";
}
