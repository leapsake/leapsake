import { useEffect, useState } from "react";
import { Alert, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { ContactMethod } from "@leapsake/schema";
import {
  type LinkAction,
  NATIVE_SCHEMES,
  SCHEME_PROBES,
} from "@leapsake/contact-links";
import { methodValue, targetUrl } from "./contact-actions";
import { deviceRegion } from "./device-region";

// Tapping a contact method on this handset: the native half of
// `contact-actions.ts`, shared by every surface that reaches a person.

const COPIED = "Copied";

/** Put a value on the clipboard and say so: the last fallback. */
async function copyToClipboard(text: string) {
  await Clipboard.setStringAsync(text);
  Alert.alert(COPIED);
}

/**
 * Which custom schemes this handset answers, probed once per mount. Starts
 * empty, so an action arrives a frame late rather than vanishing.
 */
function useSupportedSchemes(): ReadonlySet<string> {
  const [schemes, setSchemes] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all(
      NATIVE_SCHEMES.map(async (scheme) => {
        const ok = await Linking.canOpenURL(SCHEME_PROBES[scheme]).catch(
          // iOS throws for a scheme missing from LSApplicationQueriesSchemes,
          // which means "no".
          () => false,
        );
        return { scheme, ok };
      }),
    ).then((results) => {
      if (!alive) return;
      setSchemes(new Set(results.filter((r) => r.ok).map((r) => r.scheme)));
    });
    return () => {
      alive = false;
    };
  }, []);

  return schemes;
}

/** Which schemes this device answers, its region, and what a press does.
 *  `subjectName` names the person in the call confirmation. */
export function useContactReach(subjectName: string): {
  schemes: ReadonlySet<string>;
  region: string | null;
  perform: (action: LinkAction, entry: ContactMethod) => void;
} {
  const schemes = useSupportedSchemes();
  /** Run an action: open its best URL, or fall back to the clipboard. */
  function perform(action: LinkAction, entry: ContactMethod) {
    const url = targetUrl(action, schemes);
    if (url === null) {
      void copyToClipboard(action.copyText ?? methodValue(entry));
      return;
    }
    const open = () =>
      Linking.openURL(url).catch((e: unknown) =>
        Alert.alert("Couldn't open", String(e)),
      );

    // The one action that interrupts somebody, so the one that asks first.
    if (action.confirm) {
      Alert.alert(`Call ${subjectName}?`, methodValue(entry), [
        { text: "Cancel", style: "cancel" },
        { text: "Call", onPress: () => void open() },
      ]);
      return;
    }
    void open();
  }

  return { schemes, region: deviceRegion(), perform };
}
