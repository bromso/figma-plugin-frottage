export type ImportOptions = {
  autoLayout: boolean;
  tokens: boolean;
  useLocalStyles: boolean;
  hyperlinks: boolean;
  htmlNames: boolean;
  components: boolean;
  hoverComponents: boolean;
};

/**
 * Everything on, except layer names stay readable rather than `tag.class`, and components and hover
 * variants stay off. Components turn on once the applier builds them.
 */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  autoLayout: true,
  tokens: true,
  useLocalStyles: true,
  hyperlinks: true,
  htmlNames: false,
  components: false,
  hoverComponents: false,
};
