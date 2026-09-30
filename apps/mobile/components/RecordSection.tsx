import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { SectionLink, type SectionLinkProps } from "./SectionLink";
import { styles } from "../lib/styles";

/**
 * One section of a record's page or form: a title with its ➕ or ⋯, the rows,
 * and `emptyText` in their place while `isEmpty`.
 */
export function RecordSection({
  title,
  link,
  isEmpty = false,
  emptyText,
  children,
}: {
  title: string;
  link?: SectionLinkProps;
  isEmpty?: boolean;
  emptyText?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {link !== undefined && <SectionLink {...link} />}
      </View>
      {children}
      {isEmpty && emptyText !== undefined && (
        <Text style={styles.muted}>{emptyText}</Text>
      )}
    </View>
  );
}
