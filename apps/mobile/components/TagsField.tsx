import { Fragment } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { tagHref } from "../lib/record-title";
import { styles } from "../lib/styles";
import { tagColor } from "../lib/tag-color";

/**
 * The read-only Tags row, each tag a pressable run linking to its page, in
 * one wrapping `<Text>`, styled as tags are inside reminder text.
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
                style={[styles.tag, { color: tagColor(tag.name) }]}
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
