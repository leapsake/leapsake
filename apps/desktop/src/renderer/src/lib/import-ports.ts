import type {
  ImportDecision,
  ImportOutcome,
  ImportPreviewEntry,
} from "@leapsake/ui/web";
import type { ParsedContact } from "@leapsake/contact-import";

/** Likely-duplicate flags for what was just dropped. */
export const previewImport = (
  contacts: readonly ParsedContact[],
): Promise<ImportPreviewEntry[]> => window.api.import.preview([...contacts]);

/**
 * Commit the reviewed decisions, then answer the one question the review can't:
 * whether to offer “which of these is you?”. It is offered only when something
 * was imported *and* no self-person is set yet — there is now a list to pick
 * from. A failed lookup just means no nudge.
 */
export async function commitImport(
  decisions: ImportDecision[],
): Promise<ImportOutcome> {
  const result = await window.api.import.commit(decisions);
  const self = await window.api.self.get().catch(() => undefined);
  return { ...result, offerPickSelf: result.created > 0 && self === undefined };
}
