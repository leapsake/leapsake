import type { IncomingMessage } from "node:http";
import type { CoreApi } from "@leapsake/core";
import {
  type CreatePersonInput,
  type EntityType,
  type Gender,
  type RelationshipRole,
  parseTagNames,
} from "@leapsake/schema";

/**
 * A posted form body → `URLSearchParams`, and the field readers that turn one
 * into core's inputs.
 *
 * `application/x-www-form-urlencoded` is what a browser sends when no JavaScript
 * intercepts the submit, and `URLSearchParams` parses exactly that — including
 * repeated names, which is how the shared forms express multi-value fields. So
 * the no-JS write path needs no body parser and no dependency.
 *
 * ## The readers are `FormData`-shaped, and that turned out to be free
 *
 * Every reader below is a **verbatim** port of the desktop router's
 * (`apps/desktop/src/renderer/src/router.tsx:74-96, :149`), with one edit each:
 * the parameter type is `URLSearchParams` rather than `FormData`. Nothing in the
 * bodies changed, because the two classes agree exactly on the surface the
 * readers use — `get` returning `string | null`, and `getAll` returning an
 * array. That is the same shape of result Increment 2 got from the loader: the
 * desktop code was never Electron-shaped, it was `FormData`-shaped, and a
 * no-JS host supplies that for free.
 *
 * The one thing worth naming is that `FormData.get` can return a `File` and
 * `URLSearchParams.get` cannot, which is why desktop's `String(...)` wrappers
 * look redundant here. They are kept anyway — a port that quietly tidies is a
 * port whose differences stop meaning anything.
 */
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  // The same unbounded accumulation the relay's `readBody` does, and worth
  // naming rather than fixing here: a real host caps this, because an
  // unauthenticated POST that streams forever is a free denial of service.
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/** Parse the Gender select: the empty option means "unset" (null). */
export function readGender(formData: URLSearchParams): Gender | null {
  const value = String(formData.get("gender") ?? "");
  return value === "" ? null : (value as Gender);
}

/** Pull the editable Person fields out of a submitted form. */
export function readPersonInput(formData: URLSearchParams): CreatePersonInput {
  const middleName = String(formData.get("middleName")).trim();
  return {
    firstName: String(formData.get("firstName")),
    middleName: middleName.length > 0 ? middleName : null,
    lastName: String(formData.get("lastName")),
    gender: readGender(formData),
  };
}

/** Pull the desired tag names out of the comma-separated form field. */
export function readTags(formData: URLSearchParams): string[] {
  return parseTagNames(String(formData.get("tags") ?? ""));
}

/** The resolved b-side of one relationship row submitted by a create form. */
interface RelationshipDraft {
  bType: EntityType;
  bId: string;
  bRole: RelationshipRole;
  bRoleNote: string | null;
}

/**
 * Parse the create form's relationship rows — each row is one JSON blob.
 *
 * **This never fires with JavaScript disabled, and that is a finding rather
 * than a bug in the port.** `RelationshipFields` starts a Person form with zero
 * rows and grows them from an `onClick`, and each row's hidden
 * `relationships` input is only emitted once React has resolved the typed name
 * and role against the candidate list. No JavaScript means no rows, so
 * `getAll` returns `[]` and `createRelationships` below does nothing.
 *
 * Ported anyway, because the alternative is a create action that silently
 * differs from desktop's, and because the reader is the cheap half — the
 * expensive half is deciding what the no-JS shape of that section *is*
 * (`<select>` per row? a second screen after create?), which is product work
 * the spike does not spend. It goes in `WANTED-CHANGES.md`.
 */
export function readRelationships(
  formData: URLSearchParams,
): RelationshipDraft[] {
  return formData
    .getAll("relationships")
    .map((value) => JSON.parse(String(value)) as RelationshipDraft);
}

/**
 * Persist the relationship rows for a just-created subject. Core implies the
 * subject's own role from each picked b-side role, so the action only forwards
 * the parsed draft.
 *
 * Desktop's reaches for `window.api`; this takes `core` as an argument. That is
 * the only difference, and it is the same one Increment 2's loader had.
 */
export async function createRelationships(
  core: CoreApi,
  subjectType: EntityType,
  subjectId: string,
  drafts: RelationshipDraft[],
) {
  for (const draft of drafts) {
    await core.relationships.createFromSubject({
      subjectType,
      subjectId,
      otherType: draft.bType,
      otherId: draft.bId,
      otherRole: draft.bRole,
      otherRoleNote: draft.bRoleNote,
    });
  }
}
