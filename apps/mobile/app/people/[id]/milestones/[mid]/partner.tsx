import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { kindDefs } from "@leapsake/schema";
import type { PartyChoice } from "@leapsake/ui/headless";
import { useHeaderSave } from "../../../../../components/HeaderSave";
import {
  PartnerField,
  linkedPartner,
} from "../../../../../components/PartnerField";
import { useCore } from "../../../../../lib/core-context";
import { useFocusedData } from "../../../../../lib/useFocusedData";
import { styles } from "../../../../../lib/styles";
import { FormScrollView } from "../../../../../components/FormScrollView";

const COPY = {
  failed: "Couldn’t save",
  partnerRequired: "Say who it’s with before saving.",
} as const;

/** Who a couple's occasion held by one person is with, asked from its
 *  reminders. */
export default function MilestonePartnerScreen() {
  const core = useCore();
  const router = useRouter();
  const { id, mid, kind } = useLocalSearchParams<{
    id: string;
    mid: string;
    kind: "wedding" | "first-date";
  }>();
  const [partner, setPartner] = useState<PartyChoice | null | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const loadSelf = useCallback(() => core.self.get(), [core]);
  const { data: self } = useFocusedData(loadSelf);

  async function save() {
    if (partner == null || saving) return;
    setSaving(true);
    try {
      await core.milestones.linkPartner({
        milestoneId: mid,
        personId: id,
        partner: linkedPartner(partner),
      });
      router.back();
    } catch (e) {
      Alert.alert(COPY.failed, String(e));
      setSaving(false);
    }
  }

  const headerRight = useHeaderSave({
    problem: partner == null ? COPY.partnerRequired : undefined,
    saving,
    onPress: () => void save(),
  });
  const options = useMemo(
    () => ({ title: kindDefs[kind].label, headerRight }),
    [kind, headerRight],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <FormScrollView contentContainerStyle={styles.screen}>
        <PartnerField
          kind={kind}
          personId={id}
          isSelf={self?.personId === id}
          value={partner}
          onChange={setPartner}
        />
      </FormScrollView>
    </>
  );
}
