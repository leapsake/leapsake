import { View } from "react-native";
import { LinkButton } from "../components/LinkButton";
import { styles } from "../lib/styles";
import { SYNC_PREVIEW_MARKER } from "./preview";

const LABEL = "Sync across devices (preview)";

/** The Account screen's way into the sync preview. */
export default function SyncEntry() {
  return (
    <View nativeID={SYNC_PREVIEW_MARKER} style={{ marginTop: 24 }}>
      <LinkButton
        href="/sync"
        label={LABEL}
        tone="secondary"
        style={styles.field}
      />
    </View>
  );
}
