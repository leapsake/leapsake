import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type ContactMethod,
  type ContactMethodKind,
  formatPostalAddress,
} from "@leapsake/schema";
import { findPlatform } from "@leapsake/contact-links";
import { ContactMethodForm, type ContactFormValue } from "./ContactMethodForm";
import { styles } from "../lib/styles";

/** A glyph per kind, mirroring {@link ContactsSection}. */
const KIND_ICON: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
  social: "💬",
};

/** What each kind's add link is called. */
const KIND_LABEL: Record<ContactMethodKind, string> = {
  email: "Email",
  phone: "Phone",
  postal: "Postal",
  social: "Social",
};

/**
 * A contact method being authored on a form: the value the write will use, a key
 * to address the row by, and — on the edit screen — the id of the method it was
 * read back from. See {@link StagedMilestone}, which is the same idea for the
 * same reasons; a contact has no forward reference to satisfy, so its key is only
 * ever a React key.
 */
export interface StagedContact {
  key: string;
  value: ContactFormValue;
  /** The saved method this row came from; absent on a row added to the form. */
  savedId?: string;
  /** Whether its editor has been submitted here — see {@link StagedMilestone}. */
  edited?: boolean;
}

/** A saved contact method as a staged row. */
export function stagedContactOf(entry: ContactMethod): StagedContact {
  const key = entry.method.id;
  const savedId = entry.method.id;
  if (entry.kind === "email") {
    const { label, address } = entry.method;
    return { key, savedId, value: { kind: "email", label, address } };
  }
  if (entry.kind === "phone") {
    const { label, number, extension, country, smsCapable, reachableOn } =
      entry.method;
    return {
      key,
      savedId,
      value: {
        kind: "phone",
        label,
        number,
        extension,
        country,
        smsCapable,
        reachableOn,
      },
    };
  }
  if (entry.kind === "postal") {
    const { label, line1, line2, locality, region, postalCode, country } =
      entry.method;
    return {
      key,
      savedId,
      value: {
        kind: "postal",
        label,
        line1,
        line2,
        locality,
        region,
        postalCode,
        country,
      },
    };
  }
  const { label, platform, handle, platformUserId, url } = entry.method;
  return {
    key,
    savedId,
    value: { kind: "social", label, platform, handle, platformUserId, url },
  };
}

/** The one-line value shown under each staged method's label. */
function stagedValue(entry: ContactFormValue): string {
  if (entry.kind === "email") return entry.address;
  if (entry.kind === "phone") {
    const ext = entry.extension !== null ? ` ext. ${entry.extension}` : "";
    const noSms = entry.smsCapable ? "" : " (no texts)";
    return entry.number + ext + noSms;
  }
  if (entry.kind === "social") {
    const name = findPlatform(entry.platform)?.name ?? entry.platform;
    return entry.handle === ""
      ? (entry.url ?? name)
      : `${name} · ${entry.handle}`;
  }
  return formatPostalAddress(entry);
}

/**
 * Contact methods on the **create** and **edit** screens — held in an array until
 * the form is saved, then written through the same `core.contactMethods.*` calls.
 * See {@link StagedMilestonesSection} for why staging works this way; the
 * counterpart on the Person screen is {@link ContactsSection}, which is a list of
 * ways to reach somebody rather than a place to revise them.
 *
 * Person-only, like the section it mirrors: a pet has no Contacts section on its
 * detail page, so offering one would promise a place to read it back that doesn't
 * exist. Neither entity form renders this for a pet.
 *
 * The header's four add links choose the kind up front, exactly as the detail
 * section's used to — the form's fields branch on it and can't be swapped midway.
 * A row's own Edit reopens it on that kind, which is likewise not a thing an edit
 * can change: a phone number that should have been an email is a new row.
 */
export function StagedContactsSection({
  entries,
  onChange,
}: {
  entries: StagedContact[];
  onChange: (entries: StagedContact[]) => void;
}) {
  const [adding, setAdding] = useState<ContactMethodKind | null>(null);
  // Which row's editor is open, by key. Mutually exclusive with `adding`.
  const [open, setOpen] = useState<string | null>(null);
  const idle = adding === null && open === null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact methods</Text>
        {idle && (
          <View style={styles.rowActions}>
            {(["email", "phone", "postal", "social"] as const).map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => setAdding(kind)}
              >
                <Text style={styles.link}>{KIND_LABEL[kind]}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {entries.map((entry) =>
        open === entry.key ? (
          <ContactMethodForm
            key={entry.key}
            inline
            kind={entry.value.kind}
            value={entry.value}
            submitLabel="Save"
            onCancel={() => setOpen(null)}
            onSubmit={async (value) => {
              onChange(
                entries.map((e) =>
                  e.key === entry.key ? { ...e, value, edited: true } : e,
                ),
              );
              setOpen(null);
            }}
          />
        ) : (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.rowText}>
              {KIND_ICON[entry.value.kind]} {entry.value.label}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{stagedValue(entry.value)}</Text>
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.value.label}`}
                  onPress={() => setOpen(entry.key)}
                >
                  <Text style={styles.link}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.value.label}`}
                  onPress={() =>
                    onChange(entries.filter((e) => e.key !== entry.key))
                  }
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ),
      )}

      {adding !== null ? (
        <ContactMethodForm
          inline
          // Remount when the kind changes so the label suggestion re-seeds.
          key={adding}
          kind={adding}
          submitLabel="Add"
          onCancel={() => setAdding(null)}
          onSubmit={async (value) => {
            onChange([...entries, { key: crypto.randomUUID(), value }]);
            setAdding(null);
          }}
        />
      ) : entries.length === 0 && open === null ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : null}
    </View>
  );
}
