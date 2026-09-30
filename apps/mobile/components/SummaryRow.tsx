import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RowMenu, type RowMenuProps } from "./RowMenu";
import { styles } from "../lib/styles";

/**
 * A list row summing up one thing: its title, a muted detail line, and a ⋯
 * menu on the detail line, or beside the title when there is no detail.
 */
export function SummaryRow({
  title,
  detail,
  menu,
  children,
}: {
  /** A string is drawn as row text; anything else as given. */
  title: ReactNode;
  /** A string is drawn muted; anything else as given. */
  detail?: ReactNode;
  menu?: RowMenuProps;
  /** Drawn under the row's lines, e.g. a gift's link. */
  children?: ReactNode;
}) {
  const titleNode =
    typeof title === "string" ? (
      <Text style={styles.rowText}>{title}</Text>
    ) : (
      title
    );
  const menuNode = menu !== undefined && <RowMenu {...menu} />;
  return (
    <View style={styles.row}>
      {detail === undefined ? (
        <View style={local.line}>
          <View style={styles.rowBody}>{titleNode}</View>
          {menuNode}
        </View>
      ) : (
        <>
          {titleNode}
          <View style={styles.rowMeta}>
            <View style={styles.rowBody}>
              {typeof detail === "string" ? (
                <Text style={styles.muted}>{detail}</Text>
              ) : (
                detail
              )}
            </View>
            {menuNode}
          </View>
        </>
      )}
      {children}
    </View>
  );
}

const local = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
