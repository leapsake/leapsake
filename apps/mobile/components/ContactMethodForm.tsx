import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  type ContactMethodKind,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  emailLabelSuggestions,
  phoneLabelSuggestions,
  postalLabelSuggestions,
} from "@leapsake/schema";
import { CountryField } from "./CountryField";
import { colors, styles } from "../lib/styles";

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
 * Like the other mobile forms it only collects input: the screen owns the
 * `core.contactMethods.{emails,phones,postals}.create/update` call and gets back
 * a {@link ContactFormValue}. When `method` is provided the form is in edit mode
 * and pre-fills from it (the caller passes a method whose shape matches `kind`).
 * The label is free text; the kind's suggestions render as tappable chips — the
 * RN equivalent of desktop's `<datalist>`.
 */
export function ContactMethodForm({
  kind,
  method,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  kind: ContactMethodKind;
  method?: EmailAddress | PhoneNumber | PostalAddress;
  submitLabel: string;
  onSubmit: (value: ContactFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  // `method`'s shape matches `kind` (the caller guarantees it), so narrow once.
  const email =
    kind === "email" ? (method as EmailAddress | undefined) : undefined;
  const phone =
    kind === "phone" ? (method as PhoneNumber | undefined) : undefined;
  const postal =
    kind === "postal" ? (method as PostalAddress | undefined) : undefined;

  const labelSuggestions =
    kind === "email"
      ? emailLabelSuggestions
      : kind === "phone"
        ? phoneLabelSuggestions
        : postalLabelSuggestions;

  const [label, setLabel] = useState(method?.label ?? labelSuggestions[0]);
  const [address, setAddress] = useState(email?.address ?? "");
  const [number, setNumber] = useState(phone?.number ?? "");
  const [extension, setExtension] = useState(phone?.extension ?? "");
  const [smsCapable, setSmsCapable] = useState(phone?.smsCapable ?? true);
  const [line1, setLine1] = useState(postal?.line1 ?? "");
  const [line2, setLine2] = useState(postal?.line2 ?? "");
  const [locality, setLocality] = useState(postal?.locality ?? "");
  const [region, setRegion] = useState(postal?.region ?? "");
  const [postalCode, setPostalCode] = useState(postal?.postalCode ?? "");
  const [country, setCountry] = useState<string | null>(
    phone?.country ?? postal?.country ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  const labelOk = label.trim().length > 0;
  const requiredOk =
    kind === "email"
      ? address.trim().length > 0
      : kind === "phone"
        ? number.trim().length > 0
        : line1.trim().length > 0;
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
        });
      } else {
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
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
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

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Home"
          placeholderTextColor={colors.muted}
        />
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
            placeholder="name@example.com"
            placeholderTextColor={colors.muted}
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
              placeholder="+1 555 123 4567"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Extension</Text>
            <TextInput
              style={styles.input}
              value={extension}
              onChangeText={setExtension}
              keyboardType="number-pad"
              placeholder="optional"
              placeholderTextColor={colors.muted}
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
        </>
      ) : null}

      {kind === "postal" ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Address line 1</Text>
            <TextInput
              style={styles.input}
              value={line1}
              onChangeText={setLine1}
              placeholder="Street or PO box"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Address line 2</Text>
            <TextInput
              style={styles.input}
              value={line2}
              onChangeText={setLine2}
              placeholder="Apt / unit / suite"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>City / town</Text>
            <TextInput
              style={styles.input}
              value={locality}
              onChangeText={setLocality}
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>State / province / county</Text>
            <TextInput
              style={styles.input}
              value={region}
              onChangeText={setRegion}
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Postal code</Text>
            <TextInput
              style={styles.input}
              value={postalCode}
              onChangeText={setPostalCode}
              placeholderTextColor={colors.muted}
            />
          </View>
          <CountryField value={country} onChange={setCountry} />
        </>
      ) : null}
    </ScrollView>
  );
}
