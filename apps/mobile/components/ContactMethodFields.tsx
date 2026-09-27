import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { ContactMethodKind } from "@leapsake/schema";
import {
  type ContactMethodDraft,
  HANDLE_PLATFORMS,
  PHONE_PLATFORMS,
  findPlatform,
  labelSuggestionsFor,
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
function typeValueOf(draft: ContactMethodDraft): string {
  if (draft.kind !== "social") return draft.kind;
  return findPlatform(draft.platform) === undefined
    ? OTHER_SOCIAL
    : `${SOCIAL_PREFIX}${draft.platform}`;
}

/**
 * One contact method's fields for its draft's kind, with no submit of its own.
 * `canChangeKind` shows the Type dropdown, whose options name platforms too.
 */
export function ContactMethodFields({
  draft,
  onChange,
  setKind,
  canChangeKind = false,
}: {
  draft: ContactMethodDraft;
  onChange: (draft: ContactMethodDraft) => void;
  /** Points the draft at a kind and, for social, a platform. */
  setKind: (kind: ContactMethodKind, platform?: string) => void;
  /** Show the Type dropdown — a row being added, rather than one being revised. */
  canChangeKind?: boolean;
}) {
  const set = <K extends keyof ContactMethodDraft>(
    key: K,
    value: ContactMethodDraft[K],
  ) => onChange({ ...draft, [key]: value });

  const { kind } = draft;
  const labelSuggestions = labelSuggestionsFor(kind);
  const platform = findPlatform(draft.platform);

  /** Answer the Type dropdown: a bare kind, or social plus which platform. */
  function setType(value: string) {
    if (!value.startsWith(SOCIAL_PREFIX)) {
      setKind(value as ContactMethodKind);
      return;
    }
    const id = value.slice(SOCIAL_PREFIX.length);
    // The catch-all keeps a platform name already typed under it.
    const keepTyped = id === "" && platform === undefined;
    setKind("social", keepTyped ? draft.platform : id);
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
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.smsCapable }}
            accessibilityLabel="Can receive texts"
            style={[styles.field, styles.rowWithLead, { paddingVertical: 8 }]}
            onPress={() => set("smsCapable", !draft.smsCapable)}
          >
            <CheckboxBox checked={draft.smsCapable} />
            <Text style={styles.fieldValue}>Can receive texts</Text>
          </Pressable>

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
