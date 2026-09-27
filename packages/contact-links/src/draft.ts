import {
  type ContactMethod,
  type ContactMethodKind,
  emailLabelSuggestions,
  phoneLabelSuggestions,
  postalLabelSuggestions,
  socialLabelSuggestions,
} from "@leapsake/schema";
import { HANDLE_PLATFORMS, findPlatform, normalizeFor } from "./platforms.js";

/**
 * A contact method as a form holds it: every kind's fields as typed, so switching
 * kind keeps what was typed under another. Only the fields `kind` selects are read.
 */
export interface ContactMethodDraft {
  kind: ContactMethodKind;
  label: string;
  /** Email. */
  address: string;
  /** Phone. */
  number: string;
  extension: string;
  smsCapable: boolean;
  reachableOn: string[];
  /** Postal. */
  line1: string;
  line2: string;
  locality: string;
  region: string;
  postalCode: string;
  /** Phone and postal both; null when unset. */
  country: string | null;
  /** Social. A registry id, or a name typed for a platform it doesn't know. */
  platform: string;
  handle: string;
  platformUserId: string;
  url: string;
}

/** A draft as its kind's write wants it: trimmed, blank optionals null. */
export type ContactMethodValue =
  | { kind: "email"; label: string; address: string }
  | {
      kind: "phone";
      label: string;
      number: string;
      extension: string | null;
      country: string | null;
      smsCapable: boolean;
      reachableOn: string[];
    }
  | {
      kind: "postal";
      label: string;
      line1: string;
      line2: string | null;
      locality: string | null;
      region: string | null;
      postalCode: string | null;
      country: string | null;
    }
  | {
      kind: "social";
      label: string;
      platform: string;
      handle: string;
      platformUserId: string | null;
      url: string | null;
    };

/** The fields a draft can be refused on; a social `handle` means handle or URL. */
export type ContactMethodDraftErrors = Partial<
  Record<
    "label" | "address" | "number" | "line1" | "platform" | "handle",
    "required"
  >
>;

export type ContactMethodDraftResult =
  | { ok: true; input: ContactMethodValue }
  | { ok: false; errors: ContactMethodDraftErrors };

const LABEL_SUGGESTIONS: Record<ContactMethodKind, readonly string[]> = {
  email: emailLabelSuggestions,
  phone: phoneLabelSuggestions,
  postal: postalLabelSuggestions,
  social: socialLabelSuggestions,
};

/** The labels a form suggests for a kind, the first being the default. */
export function labelSuggestionsFor(
  kind: ContactMethodKind,
): readonly string[] {
  return LABEL_SUGGESTIONS[kind];
}

/** The draft a form starts from: a saved method being edited, or a blank of one kind. */
export function contactMethodDraftOf(
  start: ContactMethodKind | ContactMethod = "email",
): ContactMethodDraft {
  const kind = typeof start === "string" ? start : start.kind;
  const blank: ContactMethodDraft = {
    kind,
    label: labelSuggestionsFor(kind)[0]!,
    address: "",
    number: "",
    extension: "",
    smsCapable: true,
    reachableOn: [],
    line1: "",
    line2: "",
    locality: "",
    region: "",
    postalCode: "",
    country: null,
    platform: HANDLE_PLATFORMS[0]!.id,
    handle: "",
    platformUserId: "",
    url: "",
  };
  if (typeof start === "string") return blank;

  const draft = { ...blank, label: start.method.label };
  if (start.kind === "email")
    return { ...draft, address: start.method.address };
  if (start.kind === "phone") {
    const { number, extension, country, smsCapable, reachableOn } =
      start.method;
    return {
      ...draft,
      number,
      extension: extension ?? "",
      country,
      smsCapable,
      reachableOn: [...(reachableOn ?? [])],
    };
  }
  if (start.kind === "postal") {
    const { line1, line2, locality, region, postalCode, country } =
      start.method;
    return {
      ...draft,
      line1,
      line2: line2 ?? "",
      locality: locality ?? "",
      region: region ?? "",
      postalCode: postalCode ?? "",
      country,
    };
  }
  const { platform, handle, platformUserId, url } = start.method;
  return {
    ...draft,
    platform,
    handle,
    platformUserId: platformUserId ?? "",
    url: url ?? "",
  };
}

/**
 * The draft pointed at another kind (and, for social, a platform). A label still
 * on the old kind's suggestions re-seeds from the new kind's; a typed one stays.
 */
export function contactMethodDraftWithKind(
  draft: ContactMethodDraft,
  kind: ContactMethodKind,
  platform: string = draft.platform,
): ContactMethodDraft {
  return {
    ...draft,
    kind,
    platform,
    label: labelSuggestionsFor(draft.kind).includes(draft.label)
      ? labelSuggestionsFor(kind)[0]!
      : draft.label,
  };
}

/** Whether the draft holds what its kind exists for: an address, number, street, or handle or URL. */
export function contactMethodDraftFilled(draft: ContactMethodDraft): boolean {
  if (draft.kind === "email") return draft.address.trim() !== "";
  if (draft.kind === "phone") return draft.number.trim() !== "";
  if (draft.kind === "postal") return draft.line1.trim() !== "";
  return draft.handle.trim() !== "" || draft.url.trim() !== "";
}

const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** An ISO alpha-2 code as the schema wants it: uppercased, blank null. */
const countryOf = (text: string | null) =>
  blankToNull(text ?? "")?.toUpperCase() ?? null;

/** The value for the write, or why not. A social handle is reduced by its platform's rules. */
export function contactMethodInputOf(
  draft: ContactMethodDraft,
): ContactMethodDraftResult {
  const errors: ContactMethodDraftErrors = {};
  const label = draft.label.trim();
  if (label === "") errors.label = "required";

  const input = valueOf(draft, label);
  if (input.kind === "email" && input.address === "") {
    errors.address = "required";
  } else if (input.kind === "phone" && input.number === "") {
    errors.number = "required";
  } else if (input.kind === "postal" && input.line1 === "") {
    errors.line1 = "required";
  } else if (input.kind === "social") {
    if (input.platform === "") errors.platform = "required";
    if (input.handle === "" && input.url === null) errors.handle = "required";
  }

  return Object.keys(errors).length === 0
    ? { ok: true, input }
    : { ok: false, errors };
}

function valueOf(draft: ContactMethodDraft, label: string): ContactMethodValue {
  if (draft.kind === "email") {
    return { kind: "email", label, address: draft.address.trim() };
  }
  if (draft.kind === "phone") {
    return {
      kind: "phone",
      label,
      number: draft.number.trim(),
      extension: blankToNull(draft.extension),
      country: countryOf(draft.country),
      smsCapable: draft.smsCapable,
      reachableOn: draft.reachableOn,
    };
  }
  if (draft.kind === "postal") {
    return {
      kind: "postal",
      label,
      line1: draft.line1.trim(),
      line2: blankToNull(draft.line2),
      locality: blankToNull(draft.locality),
      region: blankToNull(draft.region),
      postalCode: blankToNull(draft.postalCode),
      country: countryOf(draft.country),
    };
  }
  return {
    kind: "social",
    label,
    platform: draft.platform.trim(),
    handle: normalizeFor(findPlatform(draft.platform), draft.handle),
    platformUserId: blankToNull(draft.platformUserId),
    url: blankToNull(draft.url),
  };
}
