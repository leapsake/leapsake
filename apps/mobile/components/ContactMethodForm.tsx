import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack } from "expo-router";
import {
  type ContactMethodKind,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  type SocialProfile,
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
import { HeaderSave } from "./HeaderSave";
import { styles } from "../lib/styles";

/**
 * The structured value the form hands back, discriminated by kind; the screen
 * supplies the owner and the matching `core.contactMethods.*` call. Optional
 * text fields are already collapsed `"" → null` here, mirroring desktop's
 * `readNote`, so the screen forwards them straight to the input schema.
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

/**
 * Add/edit form for a contact method, ported from the desktop `ContactMethodForm`
 * — one polymorphic form whose visible fields branch on `kind` (email / phone /
 * postal). Contacts are person-owned only, so there is no subject-type axis.
 *
 * Like the other mobile forms it only collects input: the caller owns the
 * `core.contactMethods.{emails,phones,postals}.create/update` call and gets back
 * a {@link ContactFormValue}. When `method` is provided the form is in edit mode
 * and pre-fills from it (the caller passes a method whose shape matches `kind`).
 * The label is free text; the kind's suggestions render as tappable chips — the
 * RN equivalent of desktop's `<datalist>`.
 *
 * With `inline` it renders into the caller's layout rather than owning the
 * screen — see {@link MilestoneForm}, which takes the same prop for the same
 * reason: the create and edit screens stage contact methods rather than writing
 * them where they stand, and a scroll view nested in another of the same
 * orientation silently stops scrolling. The submit action moves with the mode — see
 * {@link MilestoneForm}, which splits its props the same way: a header
 * {@link HeaderSave} on its own screen, the in-body `Cancel  submitLabel` row
 * inline.
 */
export function ContactMethodForm({
  title,
  kind,
  method,
  value,
  submitLabel,
  onSubmit,
  onCancel,
  inline = false,
}: {
  /** Screen mode: the native header title, set here so it's declared in one place. */
  title?: string;
  kind: ContactMethodKind;
  method?: EmailAddress | PhoneNumber | PostalAddress | SocialProfile;
  /**
   * A draft to open on, taking precedence over `method`: what a staged section
   * passes to re-open a row already filled in during this session (see
   * {@link StagedContactsSection}). A stored method and a draft carry the same
   * fields, so one seed serves either.
   */
  value?: ContactFormValue;
  /** Inline mode: the in-body submit button's label. */
  submitLabel?: string;
  onSubmit: (value: ContactFormValue) => Promise<void>;
  /** Inline mode: collapses the sub-form. */
  onCancel?: () => void;
  /** Render without the screen-owning scroll view, for embedding in a form. */
  inline?: boolean;
}) {
  // `method`'s shape matches `kind` (the caller guarantees it), so narrow once;
  // a `value` is self-describing and wins where it agrees with `kind`.
  const email =
    kind === "email"
      ? value?.kind === "email"
        ? value
        : (method as EmailAddress | undefined)
      : undefined;
  const phone =
    kind === "phone"
      ? value?.kind === "phone"
        ? value
        : (method as PhoneNumber | undefined)
      : undefined;
  const postal =
    kind === "postal"
      ? value?.kind === "postal"
        ? value
        : (method as PostalAddress | undefined)
      : undefined;
  const social =
    kind === "social"
      ? value?.kind === "social"
        ? value
        : (method as SocialProfile | undefined)
      : undefined;

  const labelSuggestions =
    kind === "email"
      ? emailLabelSuggestions
      : kind === "phone"
        ? phoneLabelSuggestions
        : kind === "postal"
          ? postalLabelSuggestions
          : socialLabelSuggestions;

  const [label, setLabel] = useState(
    value?.label ?? method?.label ?? labelSuggestions[0],
  );
  const [address, setAddress] = useState(email?.address ?? "");
  const [number, setNumber] = useState(phone?.number ?? "");
  const [extension, setExtension] = useState(phone?.extension ?? "");
  const [smsCapable, setSmsCapable] = useState(phone?.smsCapable ?? true);
  const [reachableOn, setReachableOn] = useState<string[]>(
    phone?.reachableOn ?? [],
  );
  const [line1, setLine1] = useState(postal?.line1 ?? "");
  const [line2, setLine2] = useState(postal?.line2 ?? "");
  const [locality, setLocality] = useState(postal?.locality ?? "");
  const [region, setRegion] = useState(postal?.region ?? "");
  const [postalCode, setPostalCode] = useState(postal?.postalCode ?? "");
  const [country, setCountry] = useState<string | null>(
    phone?.country ?? postal?.country ?? null,
  );
  const [platformId, setPlatformId] = useState(
    social?.platform ?? HANDLE_PLATFORMS[0].id,
  );
  const [handle, setHandle] = useState(social?.handle ?? "");
  const [platformUserId, setPlatformUserId] = useState(
    social?.platformUserId ?? "",
  );
  const [url, setUrl] = useState(social?.url ?? "");
  const [submitting, setSubmitting] = useState(false);

  const platform = findPlatform(platformId);

  const labelOk = label.trim().length > 0;
  const requiredOk =
    kind === "email"
      ? address.trim().length > 0
      : kind === "phone"
        ? number.trim().length > 0
        : kind === "postal"
          ? line1.trim().length > 0
          : // A social row needs *somewhere to point*: a handle, or — for a
            // platform with no template — a pasted URL. Either alone is enough.
            handle.trim().length > 0 || url.trim().length > 0;
  const canSubmit = !submitting && labelOk && requiredOk;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const trimmedLabel = label.trim();
      if (kind === "email") {
        await onSubmit({
          kind: "email",
          label: trimmedLabel,
          address: address.trim(),
        });
      } else if (kind === "phone") {
        await onSubmit({
          kind: "phone",
          label: trimmedLabel,
          number: number.trim(),
          extension: blankToNull(extension),
          country,
          smsCapable,
          reachableOn,
        });
      } else if (kind === "postal") {
        await onSubmit({
          kind: "postal",
          label: trimmedLabel,
          line1: line1.trim(),
          line2: blankToNull(line2),
          locality: blankToNull(locality),
          region: blankToNull(region),
          postalCode: blankToNull(postalCode),
          country,
        });
      } else {
        await onSubmit({
          kind: "social",
          label: trimmedLabel,
          platform: platformId,
          // Cleaned here rather than in the repo: what counts as a handle is a
          // fact about the platform, and this is the only layer that knows which
          // platform was picked. A pasted profile URL arrives as a handle.
          handle: normalizeFor(platform, handle),
          platformUserId: blankToNull(platformUserId),
          url: blankToNull(url),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <>
      {inline ? (
        <View style={[styles.headerActions, { justifyContent: "flex-end" }]}>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            disabled={submitting}
          >
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.button, !canSubmit && { opacity: 0.5 }]}
          >
            <Text style={styles.buttonText}>{submitLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput style={styles.input} value={label} onChangeText={setLabel} />
        <View style={styles.headerActions}>
          {labelSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              onPress={() => setLabel(suggestion)}
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
            value={address}
            onChangeText={setAddress}
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
              value={number}
              onChangeText={setNumber}
              keyboardType="phone-pad"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Extension (optional)</Text>
            <TextInput
              style={styles.input}
              value={extension}
              onChangeText={setExtension}
              keyboardType="number-pad"
            />
          </View>
          <CountryField value={country} onChange={setCountry} />
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
            <Switch value={smsCapable} onValueChange={setSmsCapable} />
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
              const on = reachableOn.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={option.name}
                  style={[styles.rowWithLead, { paddingVertical: 8 }]}
                  onPress={() =>
                    setReachableOn((current) =>
                      on
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id],
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
              value={line1}
              onChangeText={setLine1}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Address line 2 (apt, unit, suite)
            </Text>
            <TextInput
              style={styles.input}
              value={line2}
              onChangeText={setLine2}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>City / town</Text>
            <TextInput
              style={styles.input}
              value={locality}
              onChangeText={setLocality}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>State / province / county</Text>
            <TextInput
              style={styles.input}
              value={region}
              onChangeText={setRegion}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Postal code</Text>
            <TextInput
              style={styles.input}
              value={postalCode}
              onChangeText={setPostalCode}
            />
          </View>
          <CountryField value={country} onChange={setCountry} />
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
                  accessibilityState={{ selected: option.id === platformId }}
                  onPress={() => setPlatformId(option.id)}
                >
                  <Text
                    style={[
                      styles.link,
                      option.id === platformId && styles.linkSelected,
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
              value={handle}
              onChangeText={setHandle}
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
                value={platformUserId}
                onChangeText={setPlatformUserId}
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
              value={url}
              onChangeText={setUrl}
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

  if (inline) return <View style={styles.inlineForm}>{body}</View>;

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={submitting}
              onPress={() => void handleSubmit()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    </>
  );
}
