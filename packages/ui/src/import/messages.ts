import { FrottageFileError } from "@repo/capture-schema";

export const GENERIC_ERROR =
  "Something went wrong importing this file. Nothing was added to your file.";

const MESSAGES = {
  "not-a-frottage-file":
    "This isn't a Frottage file. Capture a page with the extension, then choose its .frottage file.",
  "too-large": "This file is too large to import. Frottage opens files up to 256 MB.",
  "too-many-nodes": "This page has too many elements to import. Try capturing a smaller section.",
  "too-deep": "This page is nested too deeply to import. Try capturing a smaller section.",
  "invalid-capture": "This file is damaged or incomplete. Capture the page again.",
  "newer-version": "This file needs a newer version of Frottage. Update the plugin and try again.",
  "missing-asset": "This file is missing some of its images. Capture the page again.",
  "corrupt-asset": "This file has damaged images. Capture the page again.",
} as const;

/** Plain sentences only: no codes, paths or parser detail ever reach the user. */
export function messageForError(error: unknown): string {
  if (error instanceof FrottageFileError) return MESSAGES[error.code] ?? GENERIC_ERROR;
  return GENERIC_ERROR;
}
