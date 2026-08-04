import { Alert, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import {
  type ContactMethod,
  type ContactMethodKind,
  formatPostalAddress,
} from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A glyph per kind, mirroring the desktop section's leading icon. */
const KIND_ICON: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
};

/** The one-line value shown under each method's label. */
function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const ext = entry.method.extension ? ` ext. ${entry.method.extension}` : "";
    const noSms = entry.method.smsCapable ? "" : " (no texts)";
    return entry.method.number + ext + noSms;
  }
  return formatPostalAddress(entry.method);
}

/**
 * The Contacts section on the Person detail screen, ported from the desktop
 * `ContactMethodsSection`. It lists a person's merged contact methods — email,
 * phone, postal, already unioned by `views.person`'s `contactMethods` — each row
 * carrying Edit (to the kind-scoped edit route) and Remove (a native `Alert`
 * confirm, then a kind-dispatched soft delete and `onChanged` refetch, mirroring
 * `MilestonesSection`). The header offers one add link per kind, like the
 * desktop's three Add buttons. Contacts are person-owned only, so there is no
 * subject-type axis — just the `ownerId`.
 */
export function ContactsSection({
  ownerId,
  methods,
  onChanged,
}: {
  ownerId: string;
  methods: ContactMethod[];
  onChanged: () => void;
}) {
  const core = useCore();

  function removeFn(entry: ContactMethod): () => Promise<void> {
    const id = entry.method.id;
    if (entry.kind === "email")
      return () => core.contactMethods.emails.softDelete(id);
    if (entry.kind === "phone")
      return () => core.contactMethods.phones.softDelete(id);
    return () => core.contactMethods.postals.softDelete(id);
  }

  function confirmRemove(entry: ContactMethod) {
    Alert.alert("Remove contact", `Remove ${entry.method.label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          removeFn(entry)().then(
            () => onChanged(),
            (e: unknown) => Alert.alert("Couldn't remove", String(e)),
          );
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact methods</Text>
        <View style={styles.rowActions}>
          <Link
            href={`/people/${ownerId}/contacts/email/new`}
            style={styles.link}
          >
            Email
          </Link>
          <Link
            href={`/people/${ownerId}/contacts/phone/new`}
            style={styles.link}
          >
            Phone
          </Link>
          <Link
            href={`/people/${ownerId}/contacts/postal/new`}
            style={styles.link}
          >
            Postal
          </Link>
        </View>
      </View>

      {methods.length === 0 ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : (
        methods.map((entry) => (
          <View key={entry.method.id} style={styles.row}>
            <Text style={styles.rowText}>
              {KIND_ICON[entry.kind]} {entry.method.label}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{methodValue(entry)}</Text>
              <View style={styles.rowActions}>
                <Link
                  href={`/people/${ownerId}/contacts/${entry.kind}/${entry.method.id}/edit`}
                  style={styles.link}
                >
                  Edit
                </Link>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmRemove(entry)}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
