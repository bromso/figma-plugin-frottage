export type ImportOptions = {
  autoLayout: boolean;
  tokens: boolean;
  useLocalStyles: boolean;
  hyperlinks: boolean;
  htmlNames: boolean;
};

/** Everything on, except layer names stay readable rather than `tag.class`. */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  autoLayout: true,
  tokens: true,
  useLocalStyles: true,
  hyperlinks: true,
  htmlNames: false,
};
