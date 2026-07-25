import { useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { formatGiftDate, formatGiftTargetDate } from "@leapsake/schema";
import { GiftAdornmentsEditor } from "./GiftAdornmentsEditor";
import { GiftCaptureForm } from "./GiftCaptureForm";
import { dateFieldsOf } from "./GiftOccasionFields";
import { useCore } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/** One gift idea's standing for this recipient: its suggestion(s), if any, and
 *  its giving(s), if any — the two tables unioned by idea for a single list. */
interface IdeaGroup {
  ideaId: string;
  title: string;
  url: string | null;
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
}

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

/**
 * The "Gifts" section on a Person or Pet screen, ported from the desktop
 * `GiftsSection`. One consolidated capture form on top — type a gift
 * (autocompleting existing ideas), and it's a suggestion; add a date and it's a
 * logged giving (plans/gifts.md) — over one list combining **suggestions**
 * (candidates) and **givings** (dated events), grouped by idea. A giving points at
 * the idea, never the suggestion, so "✓ given" is just a fact read alongside (the
 * suggestion row never changes state); candidates not yet given lead, given ideas
 * sink.
 */
export function GiftsSection({
  recipientType,
  recipientId,
  recipientLabel,
  suggestions,
  gifts,
  ideaPool,
  onChanged,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
  ideaPool: GiftIdea[];
  onChanged: () => void;
}) {
  const core = useCore();
  // Which row (if any) has its occasion/date editor open — one at a time, keyed
  // by row id, so the list doesn't grow a form per entry.
  const [editing, setEditing] = useState<string | null>(null);
  const recipient = { type: recipientType, id: recipientId };
  const closeEditor = () => {
    setEditing(null);
    onChanged();
  };

  // Union suggestions + gifts into one entry per idea.
  const groups = new Map<string, IdeaGroup>();
  const groupFor = (ideaId: string, title: string, url: string | null) => {
    const existing = groups.get(ideaId);
    if (existing) return existing;
    const created: IdeaGroup = {
      ideaId,
      title,
      url,
      suggestions: [],
      gifts: [],
    };
    groups.set(ideaId, created);
    return created;
  };
  for (const s of suggestions) {
    groupFor(s.giftIdeaId, s.ideaTitle, s.ideaUrl).suggestions.push(s);
  }
  for (const g of gifts) {
    groupFor(g.giftIdeaId, g.ideaTitle, g.ideaUrl).gifts.push(g);
  }
  // Candidates (not yet given) lead; given ideas sink. Alphabetical within each.
  const ordered = [...groups.values()].sort((a, b) => {
    const aGiven = a.gifts.length > 0 ? 1 : 0;
    const bGiven = b.gifts.length > 0 ? 1 : 0;
    return aGiven - bGiven || a.title.localeCompare(b.title);
  });

  function confirmRemove(what: string, remove: () => Promise<void>) {
    Alert.alert("Remove gift", `Remove ${what}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          remove().then(
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
        <Text style={styles.sectionTitle}>Gifts</Text>
      </View>

      <GiftCaptureForm
        ideaPool={ideaPool}
        fixedRecipient={{
          type: recipientType,
          id: recipientId,
          label: recipientLabel,
        }}
        onSaved={onChanged}
      />

      {ordered.length === 0 ? (
        <Text style={styles.muted}>No gifts yet.</Text>
      ) : (
        ordered.map((group) => (
          <View key={group.ideaId} style={styles.row}>
            <Link href={`/gifts/${group.ideaId}/edit`}>
              <Text style={[styles.rowText, { color: colors.accent }]}>
                {group.title}
              </Text>
            </Link>
            {group.url !== null && <GiftLink url={group.url} />}

            {group.suggestions.map((s) => {
              const target = formatGiftTargetDate(s);
              const bits = joinBits([
                s.occasionLabel,
                target === "" ? null : target,
              ]);
              return (
                <View key={s.id}>
                  <View style={styles.rowMeta}>
                    <Text style={styles.muted}>
                      Suggested{bits === "" ? "" : ` — ${bits}`}
                    </Text>
                    <View style={styles.rowActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setEditing(editing === s.id ? null : s.id)
                        }
                      >
                        <Text style={styles.link}>
                          {editing === s.id ? "Close" : "Edit"}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          confirmRemove(
                            `the suggestion of ${group.title}`,
                            () => core.gifts.suggestions.softDelete(s.id),
                          )
                        }
                      >
                        <Text style={[styles.link, styles.danger]}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                  {editing === s.id && (
                    <GiftAdornmentsEditor
                      kind="suggestion"
                      rowId={s.id}
                      recipient={recipient}
                      occasion={
                        s.occasionType !== null && s.occasionId !== null
                          ? { type: s.occasionType, id: s.occasionId }
                          : null
                      }
                      date={dateFieldsOf({
                        year: s.targetYear,
                        month: s.targetMonth,
                        day: s.targetDay,
                      })}
                      onDone={closeEditor}
                    />
                  )}
                </View>
              );
            })}

            {group.gifts.map((g) => {
              const when = formatGiftDate(g);
              const bits = joinBits([
                when === "" ? null : when,
                g.giverLabel !== null ? `from ${g.giverLabel}` : null,
                g.occasionLabel,
              ]);
              return (
                <View key={g.id}>
                  <View style={styles.rowMeta}>
                    <Text style={styles.muted}>
                      ✓ Given{bits === "" ? "" : ` — ${bits}`}
                    </Text>
                    <View style={styles.rowActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setEditing(editing === g.id ? null : g.id)
                        }
                      >
                        <Text style={styles.link}>
                          {editing === g.id ? "Close" : "Edit"}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          confirmRemove(`the giving of ${group.title}`, () =>
                            core.gifts.given.softDelete(g.id),
                          )
                        }
                      >
                        <Text style={[styles.link, styles.danger]}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                  {editing === g.id && (
                    <GiftAdornmentsEditor
                      kind="giving"
                      rowId={g.id}
                      recipient={recipient}
                      occasion={
                        g.occasionType !== null && g.occasionId !== null
                          ? { type: g.occasionType, id: g.occasionId }
                          : null
                      }
                      date={dateFieldsOf(g)}
                      onDone={closeEditor}
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * An idea's link, opened in the device browser — the mobile stand-in for the
 * desktop row's `<a target="_blank">`. A URL the OS can't open (a typo, a scheme
 * with no handler) surfaces as an alert rather than failing silently.
 */
export function GiftLink({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        Linking.openURL(url).catch(() =>
          Alert.alert("Couldn't open link", url),
        );
      }}
    >
      <Text style={styles.link} numberOfLines={1}>
        {url}
      </Text>
    </Pressable>
  );
}
