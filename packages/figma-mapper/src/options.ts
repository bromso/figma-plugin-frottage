export type ImportOptions = {
  autoLayout: boolean;
  tokens: boolean;
  useLocalStyles: boolean;
  hyperlinks: boolean;
  htmlNames: boolean;
  components: boolean;
  hoverComponents: boolean;
};

/** What a plan is made with: the user's options, and what the import works out for itself. */
export type PlanOptions = ImportOptions & {
  /**
   * Fewest uses in this capture that make a token proposal. A set asks for 1, as `mergeVersions`
   * then counts uses across its versions.
   */
  tokenFloor?: number;
};

/**
 * Everything on, except layer names stay readable rather than `tag.class`, and hover variants stay
 * off.
 */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  autoLayout: true,
  tokens: true,
  useLocalStyles: true,
  hyperlinks: true,
  htmlNames: false,
  components: true,
  hoverComponents: false,
};
