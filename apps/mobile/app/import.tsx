import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  Contact,
  ContactField,
  ContactsSortOrder,
  requestPermissionsAsync,
} from "expo-contacts";
import type { ParsedContact } from "@leapsake/vcard";
import { kindDefs } from "@leapsake/schema";
import type { DuplicateMatch, ImportResult } from "@leapsake/core";
import { Checkbox, CheckboxBox } from "../components/Checkbox";
import { deviceContactToParsed } from "../lib/device-contacts";
import { useCore } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/**
 * Import from Contacts — the mobile counterpart to desktop's drag-and-drop vCard
 * import. It reads the phone's address book (`expo-contacts`), maps each record
 * to the shared {@link ParsedContact} shape via {@link deviceContactToParsed},
 * flags likely-existing people with `core.import.preview`, and lets the user
 * multi-select who to bring in before committing through `core.import.commit` —
 * the same write path (and duplicate/birthday reconciliation) manual creation and
 * the desktop importer use. Nothing is written until the user taps Import.
 */

/**
 * The fields the mapper reads — kept in sync with `DeviceContact` in
 * {@link ../lib/device-contacts}, which types the slice it consumes.
 *
 * Lives here rather than beside the mapper because this is a *value* import from
 * `expo-contacts`, whose entrypoint calls `requireNativeModule` at module scope —
 * next to the mapper it would cost `device-contacts.ts` the purity that lets it
 * unit-test under node.
 */
const CONTACT_FIELDS: ContactField[] = [
  ContactField.GIVEN_NAME,
  ContactField.MIDDLE_NAME,
  ContactField.FAMILY_NAME,
  ContactField.FULL_NAME,
  ContactField.COMPANY,
  ContactField.NOTE,
  ContactField.EMAILS,
  ContactField.PHONES,
  ContactField.ADDRESSES,
  // Both date sources. `BIRTHDAY` is iOS-only (Android's `ContactField` enum has
  // no such member and its detail record no such property); `DATES` carries
  // anniversaries on both platforms and, on Android, the birthday itself.
  ContactField.BIRTHDAY,
  ContactField.DATES,
];

const TIER_LABEL: Record<string, string> = {
  high: "Very likely already in Leapsake",
  medium: "Possibly already in Leapsake",
};

/** Read + map device contacts, or signal that permission was refused. */
async function readDeviceContacts(): Promise<ParsedContact[] | "denied"> {
  const permission = await requestPermissionsAsync();
  if (!permission.granted) return "denied";
  const details = await Contact.getAllDetails(CONTACT_FIELDS, {
    sortOrder: ContactsSortOrder.GivenName,
  });
  return details.map(deviceContactToParsed);
}

type Phase = "loading" | "denied" | "review" | "error";

export default function ImportScreen() {
  const core = useCore();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [matchesByIndex, setMatchesByIndex] = useState<
    Map<number, DuplicateMatch[]>
  >(new Map());
  const [search, setSearch] = useState("");
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Whether the done screen offers "which of these is you?" — see {@link commit}.
  const [promptSelf, setPromptSelf] = useState(false);

  // Read the address book once, then fetch duplicate flags. A preview failure
  // just leaves rows unflagged (the import still works).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await readDeviceContacts();
        if (!live) return;
        if (read === "denied") {
          setPhase("denied");
          return;
        }
        setContacts(read);
        setPhase("review");
        if (read.length > 0) {
          const preview = await core.import.preview(read);
          if (!live) return;
          setMatchesByIndex(new Map(preview.map((p) => [p.index, p.matches])));
        }
      } catch (cause) {
        if (live) {
          setLoadError(String(cause));
          setPhase("error");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [core]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function setName(
    index: number,
    field: "firstName" | "lastName",
    value: string,
  ) {
    setContacts((prev) =>
      prev.map((contact, i) =>
        i === index
          ? { ...contact, name: { ...contact.name, [field]: value } }
          : contact,
      ),
    );
  }

  // Rows matching the search box, carrying their original index so selection,
  // duplicate flags, and name edits stay keyed to the full list.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const withIndex = contacts.map((contact, index) => ({ contact, index }));
    if (term === "") return withIndex;
    return withIndex.filter(({ contact }) =>
      [contact.displayName, contact.name.firstName, contact.name.lastName]
        .filter((s): s is string => s !== null && s !== "")
        .some((s) => s.toLowerCase().includes(term)),
    );
  }, [contacts, search]);

  // Select-all acts on the rows the search is *showing*, so it reads as "all of
  // these" rather than silently reaching contacts scrolled out of the filter.
  const allShownSelected =
    rows.length > 0 && rows.every(({ index }) => selected.has(index));
  const someShownSelected = rows.some(({ index }) => selected.has(index));

  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const { index } of rows) {
        if (allShownSelected) next.delete(index);
        else next.add(index);
      }
      return next;
    });
  }

  async function commit() {
    setCommitting(true);
    const decisions = contacts
      .map((contact, index) => ({ contact, index }))
      .filter(({ index }) => selected.has(index))
      .map(({ contact }) => ({ action: "create" as const, contact }));
    try {
      const imported = await core.import.commit(decisions);
      setResult(imported);
      // Import is a natural prompt point for the self-person, mirroring
      // desktop's ImportReview: offer it only when people
      // actually landed and no self is set yet — there's now a list to pick from.
      const self = await core.self.get().catch(() => undefined);
      setPromptSelf(imported.created > 0 && self === undefined);
    } catch (cause) {
      Alert.alert("Import failed", String(cause));
    } finally {
      setCommitting(false);
    }
  }

  /**
   * Leave the import. The per-row flags in the review only score each incoming
   * contact against people who already existed, so two contacts *within* one
   * import that duplicate each other are invisible to that pass — as is a match
   * the user chose to import anyway. Once the rows are committed, ask the
   * detector and land on the review if it has anything. Unscoped: one import can
   * implicate many people at once. Mirrors desktop's ImportReview `finish`.
   */
  async function finish() {
    const outstanding =
      result !== null && result.created > 0
        ? await core.duplicates.count().catch(() => 0)
        : 0;
    // Two different moves, because the two destinations live in different
    // navigators: the review is another root-stack screen, so it replaces this
    // one; People & Pets is in the tab navigator underneath, so we drop back to
    // it rather than stacking a second copy of the tabs on top.
    if (outstanding > 0) router.replace("/duplicates");
    else router.dismissTo("/people");
  }

  // ---- Terminal / non-review states -------------------------------------

  if (result !== null) {
    return (
      <Screen title="Import complete">
        <Text style={styles.rowText}>
          Imported {result.created} {result.created === 1 ? "person" : "people"}
          {result.skipped > 0 ? `, skipped ${result.skipped}` : ""}.
        </Text>
        {result.errors.length > 0 && (
          <View style={local.errorBox}>
            <Text style={styles.danger}>
              Couldn’t import {result.errors.length}:
            </Text>
            {result.errors.map((err) => (
              <Text key={err.index} style={styles.muted}>
                • {err.contact.displayName ?? "Unnamed contact"} — {err.message}
              </Text>
            ))}
          </View>
        )}
        {promptSelf && (
          <View style={{ gap: 8 }}>
            <Text style={styles.rowText}>Which of these is you?</Text>
            {/* `replace`, not `dismissTo`: /about-you is another root-stack
                screen, so it stands in for this one rather than dropping back to
                the tabs. Its typeahead is the point at this exact moment — the
                list behind it is hundreds of names long and you know your own. */}
            <Pressable
              accessibilityRole="button"
              style={styles.button}
              onPress={() => router.replace("/about-you")}
            >
              <Text style={styles.buttonText}>Pick yourself</Text>
            </Pressable>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          // Secondary once the self prompt is up, so "Pick yourself" leads.
          style={promptSelf ? undefined : styles.button}
          onPress={() => void finish()}
        >
          <Text style={promptSelf ? styles.link : styles.buttonText}>Done</Text>
        </Pressable>
      </Screen>
    );
  }

  if (phase === "loading") {
    return (
      <Screen title="Import from Contacts">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (phase === "denied") {
    return (
      <Screen title="Import from Contacts">
        <Text style={styles.rowText}>
          Leapsake needs permission to read your contacts to import them.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => void Linking.openSettings()}
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </Pressable>
        {/* The way on for someone who is not going to grant it. This screen is
            now where the first-run nudge sends people, so a refusal here used to
            end the only path the app had offered them — Open Settings, or back
            to a Home whose one row led straight back here. Adding by hand is a
            complete answer to "get started", and the two screens now link to
            each other rather than one way. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/add")}
        >
          <Text style={styles.link}>Or add someone by hand</Text>
        </Pressable>
      </Screen>
    );
  }

  if (phase === "error") {
    return (
      <Screen title="Import from Contacts">
        <Text style={styles.danger}>{loadError}</Text>
      </Screen>
    );
  }

  // ---- Review (multi-select) --------------------------------------------

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Import from Contacts" }} />
      <FlatList
        data={rows}
        keyExtractor={({ index }) => String(index)}
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          contacts.length === 0 ? null : (
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                Choose which contacts to add as People. Nothing is imported
                until you tap Import.
              </Text>
              <Text style={styles.fieldLabel}>Search</Text>
              <View style={local.searchRow}>
                <Checkbox
                  accessibilityLabel={
                    search.trim() === ""
                      ? "Select all contacts"
                      : "Select all matching contacts"
                  }
                  checked={
                    allShownSelected
                      ? true
                      : someShownSelected
                        ? "mixed"
                        : false
                  }
                  disabled={rows.length === 0}
                  onPress={toggleAllShown}
                  style={rows.length === 0 ? { opacity: 0.5 } : undefined}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Search contacts"
                />
              </View>
            </View>
          )
        }
        ListEmptyComponent={
          <Text style={styles.muted}>
            {contacts.length === 0
              ? "No contacts found on this device."
              : "No contacts match your search."}
          </Text>
        }
        renderItem={({ item }) => (
          <ContactRow
            contact={item.contact}
            selected={selected.has(item.index)}
            matches={matchesByIndex.get(item.index) ?? []}
            onToggle={() => toggle(item.index)}
            onName={(field, value) => setName(item.index, field, value)}
          />
        )}
      />
      {contacts.length > 0 && (
        <View style={local.footer}>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.button,
              (selected.size === 0 || committing) && { opacity: 0.5 },
            ]}
            disabled={selected.size === 0 || committing}
            onPress={commit}
          >
            <Text style={styles.buttonText}>
              {committing ? "Importing…" : `Import ${selected.size}`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ContactRow({
  contact,
  selected,
  matches,
  onToggle,
  onName,
}: {
  contact: ParsedContact;
  selected: boolean;
  matches: DuplicateMatch[];
  onToggle: () => void;
  onName: (field: "firstName" | "lastName", value: string) => void;
}) {
  const needsName =
    contact.name.firstName.trim() === "" || contact.name.lastName.trim() === "";
  const topMatch = matches[0];
  const label =
    contact.displayName ??
    `${contact.name.firstName} ${contact.name.lastName}`.trim();

  return (
    <View style={styles.row}>
      {/* The toggle target: tapping anywhere here selects/deselects. The name
          inputs below sit *outside* it so editing a name never flips the box. */}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={onToggle}
        style={styles.rowWithLead}
      >
        <CheckboxBox checked={selected} style={styles.rowLeadCheckbox} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.rowText}>{label || "Unnamed contact"}</Text>
          <ContactDetail contact={contact} />
          {topMatch && (
            <Text style={styles.danger}>
              ⚠ {TIER_LABEL[topMatch.tier] ?? topMatch.tier}: matches{" "}
              {topMatch.name} ({topMatch.reasons.join("; ")})
            </Text>
          )}
          {/* Named alongside the contact rather than silently: each of these
              becomes a person attached to them, and seeing the names is how a
              user notices the card is bringing in more than they expected. */}
          {contact.related.length > 0 && (
            <Text style={styles.muted}>
              Also adds: {contact.related.map((r) => r.name).join(", ")}
            </Text>
          )}
          {contact.dropped.length > 0 && (
            <Text style={styles.muted}>
              Not imported: {contact.dropped.map((d) => d.property).join(", ")}
            </Text>
          )}
        </View>
      </Pressable>

      {needsName && (
        <View style={local.nameFix}>
          <Text style={styles.danger}>
            Add a first and last name to import:
          </Text>
          <View style={local.nameFields}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>First name</Text>
              <TextInput
                style={styles.input}
                value={contact.name.firstName}
                onChangeText={(v) => onName("firstName", v)}
                autoCapitalize="words"
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Last name</Text>
              <TextInput
                style={styles.input}
                value={contact.name.lastName}
                onChangeText={(v) => onName("lastName", v)}
                autoCapitalize="words"
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function ContactDetail({ contact }: { contact: ParsedContact }) {
  const bits: string[] = [];
  for (const e of contact.emails) bits.push(e.address);
  for (const p of contact.phones) bits.push(p.number);
  if (contact.birthday) bits.push(kindDefs.birthday.icon ?? "Birthday");
  for (const d of contact.dates) bits.push(kindDefs[d.kind].icon ?? d.label);
  if (bits.length === 0) return null;
  return <Text style={styles.muted}>{bits.join(" · ")}</Text>;
}

/** A simple centered container for the loading/denied/error/done states. */
function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      {children}
    </View>
  );
}

const local = StyleSheet.create({
  // Select-all sits left of the search box so it lines up with the per-row
  // checkboxes below: same leading edge (both children start at the list's
  // content padding) and the same `rowWithLead` gap, which also aligns the
  // search text with the names.
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  nameFix: {
    gap: 6,
    marginTop: 8,
    marginLeft: 36,
  },
  nameFields: {
    flexDirection: "row",
    gap: 8,
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  errorBox: {
    gap: 4,
  },
});
