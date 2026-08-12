import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { GiftSuggestionForIdea } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { dateFieldsOf } from "@leapsake/ui/headless";
import { GiftAdornmentsEditor } from "./GiftAdornmentsEditor";
import { Typeahead } from "./Typeahead";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A person/pet the idea can be suggested for — the add field's pool. */
export interface RecipientCandidate {
  type: GiftPartyType;
  id: string;
  label: string;
}

/**
 * The "Suggested for" section on a gift idea's edit screen, ported from the
 * desktop `GiftIdeaRecipientsSection` — the idea end of a gift suggestion. The
 * mirror of a recipient's "Gifts" section: adding a recipient here writes the
 * same suggestion row a person page would.
 */
export function GiftIdeaRecipientsSection({
  ideaId,
  suggestions,
  candidates,
  onChanged,
}: {
  ideaId: string;
  suggestions: GiftSuggestionForIdea[];
  candidates: RecipientCandidate[];
  onChanged: () => void;
}) {
  const core = useCore();
  // The suggestion whose occasion/target-date editor is open — the same edit the
  // recipient's own Gifts section offers, from the idea end.
  const [editing, setEditing] = useState<string | null>(null);

  // Recipients already suggested drop out of the add field.
  const already = new Set(
    suggestions.map((s) => `${s.recipientType}:${s.recipientId}`),
  );

  function suggestFor(candidate: RecipientCandidate) {
    core.gifts.suggestions
      .create({
        giftIdeaId: ideaId,
        recipientType: candidate.type,
        recipientId: candidate.id,
      })
      .then(
        () => onChanged(),
        (e: unknown) => Alert.alert("Couldn't save", String(e)),
      );
  }

  function confirmRemove(suggestion: GiftSuggestionForIdea) {
    Alert.alert(
      "Remove suggestion",
      `Stop suggesting this for ${suggestion.recipientLabel}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            core.gifts.suggestions.softDelete(suggestion.id).then(
              () => onChanged(),
              (e: unknown) => Alert.alert("Couldn't remove", String(e)),
            );
          },
        },
      ],
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Suggested for</Text>
      </View>

      <Typeahead
        multi
        label="Suggest this for a person or pet"
        value={null}
        options={candidates}
        exclude={already}
        onChange={(candidate) => candidate !== null && suggestFor(candidate)}
        getKey={(c) => `${c.type}:${c.id}`}
        getLabel={(c) => c.label}
        placeholder="Suggest for someone…"
      />

      {suggestions.length === 0 ? (
        <Text style={styles.muted}>Not suggested for anyone yet.</Text>
      ) : (
        suggestions.map((suggestion) => (
          <View key={suggestion.id} style={styles.row}>
            <Text style={styles.rowText}>
              {suggestion.recipientLabel}
              {suggestion.occasionLabel !== null &&
                ` — ${suggestion.occasionLabel}`}
            </Text>
            <View style={styles.rowMeta}>
              <View />
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setEditing(editing === suggestion.id ? null : suggestion.id)
                  }
                >
                  <Text style={styles.link}>
                    {editing === suggestion.id ? "Close" : "Edit"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmRemove(suggestion)}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
            {editing === suggestion.id && (
              <GiftAdornmentsEditor
                kind="suggestion"
                rowId={suggestion.id}
                recipient={{
                  type: suggestion.recipientType,
                  id: suggestion.recipientId,
                }}
                occasion={
                  suggestion.occasionType !== null &&
                  suggestion.occasionId !== null
                    ? {
                        type: suggestion.occasionType,
                        id: suggestion.occasionId,
                      }
                    : null
                }
                date={dateFieldsOf({
                  year: suggestion.targetYear,
                  month: suggestion.targetMonth,
                  day: suggestion.targetDay,
                })}
                onDone={() => {
                  setEditing(null);
                  onChanged();
                }}
              />
            )}
          </View>
        ))
      )}
    </View>
  );
}
