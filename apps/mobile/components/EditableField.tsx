import { type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { styles } from "../lib/styles";

/**
 * A field on a detail screen that can be edited where it stands: a titled header
 * carrying **Edit**, over either the read view (`children`) or `edit` with its
 * own Cancel and Save.
 *
 * This is how a Person or Pet's own fields are revised now — one field at a
 * time, from the page they're read on — rather than through a whole-record form
 * behind an Edit button in the nav bar. It follows the sections below it (contact
 * methods, milestones, gifts), which have always been edited in place from their
 * own rows; the record's name, gender and tags were the last things on the screen
 * that needed a trip somewhere else. It also frees the header's right side, which
 * a single-purpose Edit was holding.
 *
 * A field owns the *outcome* of its save — the spinner-less busy state and the
 * error line — while the caller owns the draft, the validity check, and the
 * write itself, because those are the parts that differ per field.
 *
 * `label` names the field once, here. The editor below it is rendered without a
 * label of its own where the two would be the same word ({@link GenderField},
 * {@link TagsInput}); a multi-field group like a person's name keeps the inner
 * labels, which say something the header doesn't.
 */
export function EditableField({
  label,
  editing,
  onOpen,
  onClose,
  onSave,
  canSave = true,
  edit,
  children,
}: {
  label: string;
  editing: boolean;
  onOpen: () => void;
  /** Called on Cancel, and again once a save lands. */
  onClose: () => void;
  /** Rejects to show its reason in place, leaving the editor open and the draft
   *  intact so the user can fix it or cancel. */
  onSave: () => Promise<void>;
  canSave?: boolean;
  /** The editor, shown in place of `children` while `editing`. */
  edit: ReactNode;
  /** The read view. */
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A closed field forgets its failure. Reopening starts from the record as it
  // now stands, so a kept "Couldn't save" would be reporting on a draft that no
  // longer exists — and fields close each other, not just themselves.
  useEffect(() => {
    if (!editing) setError(null);
  }, [editing]);

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{label}</Text>
        {/* Only while closed: the editor's own Cancel is the way back out, and
            two ways to abandon one draft is one too many. The label is spelled
            out for a screen reader, which would otherwise hear a page of
            identical "Edit" buttons. */}
        {!editing && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${label.toLowerCase()}`}
            onPress={onOpen}
          >
            <Text style={styles.link}>Edit</Text>
          </Pressable>
        )}
      </View>

      {editing ? (
        <View style={styles.inlineForm}>
          {edit}

          {error !== null && (
            <Text style={styles.danger}>Couldn't save: {error}</Text>
          )}

          <View style={[styles.headerActions, { justifyContent: "flex-end" }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void save()}
              disabled={busy || !canSave}
              style={[styles.button, (busy || !canSave) && { opacity: 0.5 }]}
            >
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        children
      )}
    </View>
  );
}
