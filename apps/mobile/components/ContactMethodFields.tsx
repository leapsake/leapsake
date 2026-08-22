import type { ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  type ContactMethod,
  type ContactMethodKind,
  emailLabelSuggestions,
  phoneLabelSuggestions,
  postalLabelSuggestions,
  socialLabelSuggestions,
} from "@leapsake/schema";
import {
  HANDLE_PLATFORMS,
  PHONE_PLATFORMS,
  findPlatform,
  normalizeFor,
} from "@leapsake/contact-links";
import { CheckboxBox } from "./Checkbox";
import { CountryField } from "./CountryField";
import { SelectField } from "./SelectField";
import { SuggestField } from "./SuggestField";
import { styles } from "../lib/styles";

/**
 * The prefix marking a Type option as "social, on this platform"; the rest of
 * the value is the platform id, and {@link OTHER_SOCIAL} — the prefix with no id
 * after it — is the one that names no platform. A prefix rather than a second
 * dropdown because *what a contact method is* is one question to the user:
 * "Instagram" is an answer to it in the same way "Email" is, and asking for the
 * kind first only to ask which platform second was making them spell out a
 * classification they had already made.
 */
const SOCIAL_PREFIX = "social:";

/** A profile on a platform the registry has no template for — see below. */
const OTHER_SOCIAL = SOCIAL_PREFIX;

/**
 * What a new method can be, in the order the Type dropdown offers them: the
 * three kinds that are their own answer, then every platform Leapsake knows how
 * to open, then the catch-all for the ones it doesn't.
 *
 * The platforms come from the registry rather than being listed here, so adding
 * one to `@leapsake/contact-links` puts it in this dropdown — the same bargain
 * `PHONE_PLATFORMS` makes with the "Also reachable on" checkboxes.
 */
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "postal", label: "Postal address" },
  ...HANDLE_PLATFORMS.map((platform) => ({
    value: `${SOCIAL_PREFIX}${platform.id}`,
    label: platform.name,
  })),
  { value: OTHER_SOCIAL, label: "Other" },
];

/** The Platform dropdown on a saved social row, which has no Type dropdown. */
const PLATFORM_OPTIONS = TYPE_OPTIONS.filter((option) =>
  option.value.startsWith(SOCIAL_PREFIX),
);

/**
 * Which Type option a draft is sitting on. A social row answers with its
 * platform, and a platform the registry has never heard of — one the user named
 * by hand — answers with the catch-all, which is exactly where they typed it.
 */
function typeValueOf(draft: ContactDraft): string {
  if (draft.kind !== "social") return draft.kind;
  return findPlatform(draft.platform) === undefined
    ? OTHER_SOCIAL
    : `${SOCIAL_PREFIX}${draft.platform}`;
}

/** The label chips offered for a kind. */
function labelSuggestionsFor(kind: ContactMethodKind): readonly string[] {
  if (kind === "email") return emailLabelSuggestions;
  if (kind === "phone") return phoneLabelSuggestions;
  if (kind === "postal") return postalLabelSuggestions;
  return socialLabelSuggestions;
}

/**
 * A contact method as the UI holds it: every field a string, nothing trimmed or
 * parsed yet — the same idea as {@link PersonDraft}, and held for the same
 * reason, since a half-typed field has to survive being looked at.
 *
 * It is the **superset** of the four kinds rather than a union, so that switching
 * a new row's Type doesn't throw away what has already been typed under another
 * one: only the fields `kind` selects are ever read ({@link contactDraftToValue}),
 * and the rest sit there in case the user switches back.
 */
export interface ContactDraft {
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
  /** Phone and postal both. */
  country: string | null;
  /** Social. */
  platform: string;
  handle: string;
  platformUserId: string;
  url: string;
}

export function emptyContactDraft(
  kind: ContactMethodKind = "email",
): ContactDraft {
  return {
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
    platform: HANDLE_PLATFORMS[0].id,
    handle: "",
    platformUserId: "",
    url: "",
  };
}

/** A saved contact method as a draft — what the edit screen seeds its rows from. */
export function contactDraftFrom(entry: ContactMethod): ContactDraft {
  const draft = { ...emptyContactDraft(entry.kind), label: entry.method.label };
  if (entry.kind === "email") {
    return { ...draft, address: entry.method.address };
  }
  if (entry.kind === "phone") {
    const { number, extension, country, smsCapable, reachableOn } =
      entry.method;
    return {
      ...draft,
      number,
      extension: extension ?? "",
      country,
      smsCapable,
      reachableOn: [...reachableOn],
    };
  }
  if (entry.kind === "postal") {
    const { line1, line2, locality, region, postalCode, country } =
      entry.method;
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
  const { platform, handle, platformUserId, url } = entry.method;
  return {
    ...draft,
    platform,
    handle,
    platformUserId: platformUserId ?? "",
    url: url ?? "",
  };
}

/**
 * The structured value the write uses, discriminated by kind; the caller supplies
 * the owner and the matching `core.contactMethods.*` call. Optional text fields
 * are already collapsed `"" → null` here, mirroring desktop's `readNote`, so the
 * caller forwards them straight to the input schema.
 */
export type ContactFormValue =
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

/** Trim, then treat an empty optional field as absent (`null`). */
function blankToNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** The draft as the write wants it: only its kind's fields, trimmed. */
export function contactDraftToValue(draft: ContactDraft): ContactFormValue {
  const label = draft.label.trim();
  if (draft.kind === "email") {
    return { kind: "email", label, address: draft.address.trim() };
  }
  if (draft.kind === "phone") {
    return {
      kind: "phone",
      label,
      number: draft.number.trim(),
      extension: blankToNull(draft.extension),
      country: draft.country,
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
      country: draft.country,
    };
  }
  return {
    kind: "social",
    label,
    // Trimmed because it may be a name the user typed rather than a registry id.
    platform: draft.platform.trim(),
    // Cleaned here rather than in the repo: what counts as a handle is a fact
    // about the platform, and this is the only layer that knows which platform
    // was picked. A pasted profile URL arrives as a handle.
    handle: normalizeFor(findPlatform(draft.platform), draft.handle),
    platformUserId: blankToNull(draft.platformUserId),
    url: blankToNull(draft.url),
  };
}

/**
 * Whether the draft carries the one thing its kind exists to hold — the address,
 * the number, the street, somewhere to point. A row without it isn't half-typed,
 * it's untyped: see {@link contactRowPending}, which is what lets a row added by
 * a stray tap be ignored rather than block the form.
 */
export function contactDraftFilled(draft: ContactDraft): boolean {
  if (draft.kind === "email") return draft.address.trim().length > 0;
  if (draft.kind === "phone") return draft.number.trim().length > 0;
  if (draft.kind === "postal") return draft.line1.trim().length > 0;
  // A social row needs *somewhere to point*: a handle, or — for a platform with
  // no template — a pasted URL. Either alone is enough.
  return draft.handle.trim().length > 0 || draft.url.trim().length > 0;
}

/** Whether the draft would pass its kind's schema. */
export function contactDraftValid(draft: ContactDraft): boolean {
  if (draft.label.trim().length === 0) return false;
  // A social row picked from the catch-all starts with no platform at all, and
  // `socialProfileSchema` wants one: the write would fail where the form can
  // just wait. Every other kind carries its platform implicitly or not at all.
  if (draft.kind === "social" && draft.platform.trim().length === 0) {
    return false;
  }
  return contactDraftFilled(draft);
}

/**
 * One contact method's fields, ported from the desktop `ContactMethodForm` — a
 * polymorphic set whose visible members branch on `kind` (email / phone / postal
 * / social). Contacts are person-owned only, so there is no subject-type axis.
 *
 * Controlled throughout, and with no submit of its own: whoever owns the draft
 * sees every keystroke, exactly as {@link PersonFields} works. That is what lets
 * {@link StagedContactsSection} keep every row **open and live** on the entity
 * form instead of behind an Edit — a stored email you can retype in place, like
 * the name at the top of the same screen — and it leaves the writing to the one
 * Save the whole form has.
 *
 * The kind is only sometimes the row's to change, so `canChangeKind` decides
 * whether the Type dropdown appears: on a row being added it is the first thing
 * you pick; on a row read back from a saved method it is fixed, since a phone
 * number that should have been an email is a new row, not an edit.
 *
 * That dropdown answers "what is this?" once, platform and all — Instagram sits
 * in it beside Email — so a row being added never picks Social and then picks
 * again. A saved social row, having no Type dropdown to change, gets the same
 * list without the kinds as its Platform field; see {@link TYPE_OPTIONS}.
 *
 * The label is free text over a short list of usual answers — desktop's
 * `<datalist>`, rendered here as a {@link SuggestField} whose sheet holds both.
 * Everywhere but postal it shares a line with the address, number or handle it
 * names, since a screen that stacks several of these rows can't afford a whole
 * line for one word.
 */
export function ContactMethodFields({
  draft,
  onChange,
  canChangeKind = false,
}: {
  draft: ContactDraft;
  onChange: (draft: ContactDraft) => void;
  /** Show the Type dropdown — a row being added, rather than one being revised. */
  canChangeKind?: boolean;
}) {
  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const { kind } = draft;
  const labelSuggestions = labelSuggestionsFor(kind);
  const platform = findPlatform(draft.platform);

  /**
   * Point the row at a different kind, and — where the answer named one — a
   * platform, in the one move the user made.
   *
   * Switching carries the label over only if the user typed one of their own: a
   * label that is still one of the old kind's suggestions was chosen for a kind
   * this row no longer is, so it re-seeds from the new kind's — "Mobile" has no
   * business surviving a switch to Email.
   */
  function retarget(next: ContactMethodKind, rest: Partial<ContactDraft> = {}) {
    onChange({
      ...draft,
      ...rest,
      kind: next,
      label: labelSuggestions.includes(draft.label)
        ? labelSuggestionsFor(next)[0]!
        : draft.label,
    });
  }

  /** Answer the Type dropdown: a bare kind, or social plus which platform. */
  function setType(value: string) {
    if (!value.startsWith(SOCIAL_PREFIX)) {
      retarget(value as ContactMethodKind);
      return;
    }
    const id = value.slice(SOCIAL_PREFIX.length);
    // The catch-all names no platform, so it blanks the one a listed option had
    // set — the row is something we have no template for, and the free-text
    // field it reveals is where the user says what. A name they had already
    // typed there survives the round trip, for the reason the draft is a
    // superset at all: switching away and back shouldn't cost you "Mastodon".
    const keepTyped = id === "" && platform === undefined;
    retarget("social", { platform: keepTyped ? draft.platform : id });
  }

  /**
   * A one-word name for the row, free text with the kind's usual answers behind
   * a sheet. Narrow by nature, so wherever the kind has a single field that *is*
   * the row — an address, a number, a handle — it shares that field's line
   * rather than spending one of its own: see {@link pairedWithLabel}.
   */
  const labelField = (
    <SuggestField
      label="Label"
      value={draft.label}
      suggestions={labelSuggestions}
      onChange={(value) => set("label", value)}
    />
  );

  /** Label beside the one field it names. */
  const pairedWithLabel = (field: ReactNode) => (
    <View style={styles.fieldPair}>
      <View style={styles.fieldPairNarrow}>{labelField}</View>
      <View style={styles.fieldPairWide}>{field}</View>
    </View>
  );

  return (
    <>
      {canChangeKind ? (
        <SelectField
          label="Type"
          value={typeValueOf(draft)}
          options={TYPE_OPTIONS}
          onChange={setType}
        />
      ) : null}

      {/* Postal keeps the Label on its own line: it has five fields of its own
          and no single one of them is the one the Label names. The other three
          kinds pair it with theirs, below. */}
      {kind === "postal" ? labelField : null}

      {kind === "email"
        ? pairedWithLabel(
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={draft.address}
                onChangeText={(value) => set("address", value)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>,
          )
        : null}

      {kind === "phone" ? (
        <>
          {pairedWithLabel(
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Number</Text>
              <TextInput
                style={styles.input}
                value={draft.number}
                onChangeText={(value) => set("number", value)}
                keyboardType="phone-pad"
              />
            </View>,
          )}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Extension (optional)</Text>
            <TextInput
              style={styles.input}
              value={draft.extension}
              onChangeText={(value) => set("extension", value)}
              keyboardType="number-pad"
            />
          </View>
          <CountryField
            value={draft.country}
            onChange={(value) => set("country", value)}
          />
          <View
            style={[
              styles.field,
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              },
            ]}
          >
            <Text style={styles.fieldValue}>Can receive texts</Text>
            <Switch
              value={draft.smsCapable}
              onValueChange={(value) => set("smsCapable", value)}
            />
          </View>

          {/* Whether this number is on WhatsApp is the one thing Leapsake
              cannot work out for itself, and the only thing standing between a
              stored number and a tap that opens the conversation. Asked here,
              once, rather than guessed — and rendered from the registry, so a
              platform added to `@leapsake/contact-links` shows up without this
              form changing. */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Also reachable on</Text>
            {PHONE_PLATFORMS.map((option) => {
              const on = draft.reachableOn.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={option.name}
                  style={[styles.rowWithLead, { paddingVertical: 8 }]}
                  onPress={() =>
                    set(
                      "reachableOn",
                      on
                        ? draft.reachableOn.filter((id) => id !== option.id)
                        : [...draft.reachableOn, option.id],
                    )
                  }
                >
                  <CheckboxBox checked={on} />
                  <Text style={styles.fieldValue}>{option.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {kind === "postal" ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Address line 1 (street or PO box)
            </Text>
            <TextInput
              style={styles.input}
              value={draft.line1}
              onChangeText={(value) => set("line1", value)}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Address line 2 (apt, unit, suite)
            </Text>
            <TextInput
              style={styles.input}
              value={draft.line2}
              onChangeText={(value) => set("line2", value)}
            />
          </View>
          {/* "City" and "State" rather than the full "City / town" and
              "State / province / county": the slash-lists were the honest label
              for an address form that doesn't know which country it is in, but
              they cost two lines to say what one word gets across, and the
              country is right below. When the form learns to name these from
              the country, it names them one word at a time. */}
          <View style={styles.fieldPair}>
            <View style={styles.fieldPairWide}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput
                  style={styles.input}
                  value={draft.locality}
                  onChangeText={(value) => set("locality", value)}
                />
              </View>
            </View>
            <View style={styles.fieldPairNarrow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>State</Text>
                <TextInput
                  style={styles.input}
                  value={draft.region}
                  onChangeText={(value) => set("region", value)}
                />
              </View>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Postal code</Text>
            <TextInput
              style={styles.input}
              value={draft.postalCode}
              onChangeText={(value) => set("postalCode", value)}
            />
          </View>
          <CountryField
            value={draft.country}
            onChange={(value) => set("country", value)}
          />
        </>
      ) : null}

      {kind === "social" ? (
        <>
          {/* A saved row's kind is fixed, so it has no Type dropdown to change
              the platform from — this is that dropdown with the kinds taken
              out, and the only place a stored Instagram profile can become a
              Telegram one. A row being added doesn't need it: Type just said. */}
          {canChangeKind ? null : (
            <SelectField
              label="Platform"
              value={typeValueOf(draft)}
              options={PLATFORM_OPTIONS}
              onChange={setType}
            />
          )}

          {/* The catch-all's one field, and the reason `platform` is a free
              string rather than an enum: a profile on something Leapsake has no
              template for is still worth keeping, and a name the user typed
              reads back better than a bare URL. Shown whenever the platform
              isn't one the registry knows — which is both the row that just
              picked "Other" and the saved row that did so months ago. */}
          {platform === undefined ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Platform name</Text>
              <TextInput
                style={styles.input}
                value={draft.platform}
                onChangeText={(value) => set("platform", value)}
                autoCorrect={false}
                placeholder="e.g. Mastodon"
              />
            </View>
          ) : null}

          {/* "…or link" rather than "…or profile link": sharing the line costs
              this field a third of the width, and the Profile URL field below
              says the longer word anyway. */}
          {pairedWithLabel(
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Handle or link</Text>
              <TextInput
                style={styles.input}
                value={draft.handle}
                onChangeText={(value) => set("handle", value)}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="@name"
              />
            </View>,
          )}

          {/* Offered only where an opaque id reaches further than the handle
              does — that is the entire reason the field exists, and showing it
              on Telegram (whose username already opens a chat) would be asking
              for something that buys nothing. */}
          {platform?.acceptsUserId === true ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                {platform.name} user ID (optional)
              </Text>
              <TextInput
                style={styles.input}
                value={draft.platformUserId}
                onChangeText={(value) => set("platformUserId", value)}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.muted}>
                {platform.name} opens a direct message only from a numeric ID.
                Without one this row opens their profile.
              </Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Profile URL (optional)</Text>
            <TextInput
              style={styles.input}
              value={draft.url}
              onChangeText={(value) => set("url", value)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…"
            />
          </View>
        </>
      ) : null}
    </>
  );
}
