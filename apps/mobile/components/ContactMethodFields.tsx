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
 * Marks a Type option as social, the platform id after it: "Instagram"
 * answers the Type question as "Email" does, in one dropdown.
 */
const SOCIAL_PREFIX = "social:";

/** A profile on a platform the registry has no template for. */
const OTHER_SOCIAL = SOCIAL_PREFIX;

/**
 * The Type options: three kinds, then every platform the registry knows, then
 * the catch-all. A platform added to `@leapsake/contact-links` appears here.
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

/** Which Type option a draft is on; an unknown platform is the catch-all. */
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
  /** Show the Type dropdown, for a row being added. */
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

  // The row's one-word name, sharing the line of the field it names.
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

      {/* Postal's Label has its own line: no one field is the one it names. */}
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

          {/* Whether a number is on WhatsApp cannot be worked out, so it is
              asked; the list comes from the registry. */}
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
          {/* A saved row has no Type dropdown; this changes its platform. */}
          {canChangeKind ? null : (
            <SelectField
              label="Platform"
              value={typeValueOf(draft)}
              options={PLATFORM_OPTIONS}
              onChange={setType}
            />
          )}

          {/* For a platform the registry does not know, which is why
              `platform` is free text rather than an enum. */}
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

          {/* Only where an opaque id reaches further than the handle. */}
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
