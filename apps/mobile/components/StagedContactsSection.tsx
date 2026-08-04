import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ContactMethodKind, formatPostalAddress } from "@leapsake/schema";
import { ContactMethodForm, type ContactFormValue } from "./ContactMethodForm";
import { styles } from "../lib/styles";

/** A glyph per kind, mirroring {@link ContactsSection}. */
const KIND_ICON: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
};

/** The one-line value shown under each staged method's label. */
function stagedValue(entry: ContactFormValue): string {
  if (entry.kind === "email") return entry.address;
  if (entry.kind === "phone") {
    const ext = entry.extension !== null ? ` ext. ${entry.extension}` : "";
    const noSms = entry.smsCapable ? "" : " (no texts)";
    return entry.number + ext + noSms;
  }
  return formatPostalAddress(entry);
}

/**
 * Contact methods on the **create** screen — the staged counterpart to
 * {@link ContactsSection}, held in an array until the person exists and then
 * written through the same `core.contactMethods.*` calls. See
 * {@link StagedMilestonesSection} for why staging works this way.
 *
 * Person-only, like the section it mirrors: a pet has no Contacts section on its
 * detail page, so offering one at creation would promise a place to read it back
 * that doesn't exist. The create screen doesn't render this for a pet.
 *
 * The header's three add links choose the kind up front, exactly as the detail
 * section's do — the form's fields branch on it and can't be swapped midway.
 */
export function StagedContactsSection({
  entries,
  onChange,
}: {
  entries: ContactFormValue[];
  onChange: (entries: ContactFormValue[]) => void;
}) {
  const [adding, setAdding] = useState<ContactMethodKind | null>(null);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact methods</Text>
        {adding === null && (
          <View style={styles.rowActions}>
            {(["email", "phone", "postal"] as const).map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => setAdding(kind)}
              >
                <Text style={styles.link}>
                  {kind === "email"
                    ? "Email"
                    : kind === "phone"
                      ? "Phone"
                      : "Postal"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {entries.map((entry, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.rowText}>
            {KIND_ICON[entry.kind]} {entry.label}
          </Text>
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{stagedValue(entry)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {adding !== null ? (
        <ContactMethodForm
          inline
          // Remount when the kind changes so the label suggestion re-seeds.
          key={adding}
          kind={adding}
          submitLabel="Add"
          onCancel={() => setAdding(null)}
          onSubmit={async (value) => {
            onChange([...entries, value]);
            setAdding(null);
          }}
        />
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : null}
    </View>
  );
}
