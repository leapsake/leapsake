import type {
  ImportDecision,
  ImportOutcome,
  ImportPreviewEntry,
} from "@leapsake/ui/web";
import type { ParsedContact } from "@leapsake/vcard";

/** Likely-duplicate flags for what was just dropped. */
export const previewImport = (
  contacts: readonly ParsedContact[],
): Promise<ImportPreviewEntry[]> => window.api.import.preview([...contacts]);

/** Commit, attaching where the rule allows; offer "which of these is you?"
 *  only when someone was created and no self-person is set. */
export async function commitImport(
  decisions: ImportDecision[],
): Promise<ImportOutcome> {
  const result = await window.api.import.commit(decisions, { attach: true });
  const self = await window.api.self.get().catch(() => undefined);
  return { ...result, offerPickSelf: result.created > 0 && self === undefined };
}
