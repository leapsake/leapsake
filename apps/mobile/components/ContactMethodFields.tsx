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
import { styles } from "../lib/styles";

/** The kinds a new method can be, in the order the Type dropdown offers them. */
const KIND_OPTIONS: { value: ContactMethodKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "postal", label: "Postal address" },
  { value: "social", label: "Social" },
];

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
    platform: draft.platform,
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
  return draft.label.trim().length > 0 && contactDraftFilled(draft);
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
 * The label is free text; the kind's suggestions render as tappable chips — the
 * RN equivalent of desktop's `<datalist>`.
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
   * Switching kinds carries the label over only if the user typed one of their
   * own: a label that is still one of the old kind's suggestions was chosen for a
   * kind this row no longer is, so it re-seeds from the new kind's — "Fax" has no
   * business surviving a switch to Email.
   */
  function setKind(next: ContactMethodKind) {
    onChange({
      ...draft,
      kind: next,
      label: labelSuggestions.includes(draft.label)
        ? labelSuggestionsFor(next)[0]!
        : draft.label,
    });
  }

  return (
    <>
      {canChangeKind ? (
        <SelectField
          label="Type"
          value={kind}
          options={KIND_OPTIONS}
          onChange={setKind}
        />
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput
          style={styles.input}
          value={draft.label}
          onChangeText={(value) => set("label", value)}
        />
        <View style={styles.headerActions}>
          {labelSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              onPress={() => set("label", suggestion)}
            >
              <Text style={styles.link}>{suggestion}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {kind === "email" ? (
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
        </View>
      ) : null}

      {kind === "phone" ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Number</Text>
            <TextInput
              style={styles.input}
              value={draft.number}
              onChangeText={(value) => set("number", value)}
              keyboardType="phone-pad"
            />
          </View>
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
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>City / town</Text>
            <TextInput
              style={styles.input}
              value={draft.locality}
              onChangeText={(value) => set("locality", value)}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>State / province / county</Text>
            <TextInput
              style={styles.input}
              value={draft.region}
              onChangeText={(value) => set("region", value)}
            />
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
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Platform</Text>
            <View style={styles.headerActions}>
              {HANDLE_PLATFORMS.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: option.id === draft.platform,
                  }}
                  onPress={() => set("platform", option.id)}
                >
                  <Text
                    style={[
                      styles.link,
                      option.id === draft.platform && styles.linkSelected,
                    ]}
                  >
                    {option.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Handle or profile link</Text>
            <TextInput
              style={styles.input}
              value={draft.handle}
              onChangeText={(value) => set("handle", value)}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="@name"
            />
          </View>

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
