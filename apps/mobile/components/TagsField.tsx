import { Fragment } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { tagHref } from "../lib/record-title";
import { colors, styles } from "../lib/styles";

/**
 * The read-only Tags row, each tag a pressable run linking to its page, in
 * one wrapping `<Text>`. Colour alone marks them, keeping the line's size.
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
