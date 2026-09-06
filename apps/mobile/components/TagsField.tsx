import { Fragment } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { tagHref } from "../lib/record-title";
import { colors, styles } from "../lib/styles";

/**
 * The Tags row on the Person and Pet detail screens: every tag is a link to its
 * own page, exactly as a `#tag` inside reminder text is on the reminder detail
 * screen — a tag names a set, and the page listing that set is the only thing it
 * can usefully point at. It was flat text here while the same tags were tappable
 * two screens away, and desktop's TagsSection has always linked them.
 *
 * One <Text> holding the lot, so a long tag list wraps like prose rather than
 * clipping; RN can't nest a <Link> inside <Text>, so each tag is a nested <Text>
 * with `onPress` → `router.push`, the same construction {@link ReminderText}
 * uses. Colour alone marks the links — `styles.link` would drop them to 16pt
 * inside a 17pt field value and leave the line unevenly sized.
 *
 * This is the read half only: the row's own header carries the "Tags" name and
 * the Edit that swaps this for a {@link TagsInput}. An entity with no tags keeps
 * the same em-dash placeholder the other fields use.
 */
export function TagsField({ tags }: { tags: readonly Tag[] }) {
  const router = useRouter();

  return (
    <Text style={styles.fieldValue}>
      {tags.length === 0
        ? "—"
        : tags.map((tag, i) => (
            <Fragment key={tag.id}>
              {i > 0 ? " " : null}
              <Text
                style={{ color: colors.accent }}
                accessibilityRole="link"
                onPress={() => router.push(tagHref(tag))}
              >
                {tagLabel(tag.name)}
              </Text>
            </Fragment>
          ))}
    </Text>
  );
}
