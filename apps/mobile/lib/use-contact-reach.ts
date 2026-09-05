import { useEffect, useState } from "react";
import { Alert, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
import {
  type LinkAction,
  NATIVE_SCHEMES,
  SCHEME_PROBES,
  findPlatform,
} from "@leapsake/contact-links";
import { targetUrl } from "./contact-actions";

/**
 * **Tapping** a contact method, on this handset — the half of
 * `contact-actions.ts` that cannot stay pure.
 *
 * `@leapsake/contact-links` decides what a method *could* do and
 * `contact-actions.ts` decides which of those this device can actually offer;
 * what is left is the bridge itself — probing schemes, opening URLs, the
 * clipboard, and the one confirmation. That lives here rather than in a
 * component because **two** surfaces now perform contact actions: the person's
 * Contact section, and the reach buttons on a `wish` reminder. A second
 * implementation would be a second answer to "does calling someone ask first",
 * and the wrong answer to that one interrupts a stranger.
 */

const COPIED = "Copied";

/** Put a value on the clipboard and say so — the last rung of the fallback chain. */
async function copyToClipboard(text: string) {
  await Clipboard.setStringAsync(text);
  Alert.alert(COPIED);
}

/** The one-line value shown under each method's label. */
export function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const ext = entry.method.extension ? ` ext. ${entry.method.extension}` : "";
    const noSms = entry.method.smsCapable ? "" : " (no texts)";
    return entry.method.number + ext + noSms;
  }
  if (entry.kind === "social") {
    // The platform's proper noun beside the handle, so a bare "@josh" says which
    // "@josh". An unknown platform id is shown as stored rather than hidden —
    // the point of an open list is that a row outlives this build's knowledge.
    const { platform, handle, url } = entry.method;
    const name = findPlatform(platform)?.name ?? platform;
    return handle === "" ? (url ?? name) : `${name} · ${handle}`;
  }
  return formatPostalAddress(entry.method);
}

/**
 * Which custom schemes this handset actually answers.
 *
 * Probed once per mount rather than per row: a person may have a dozen contact
 * methods but there are only ever two schemes, and `canOpenURL` is a bridge
 * call. Starts empty, so an action with no web fallback (FaceTime) appears a
 * frame late rather than appearing and then vanishing — of the two, a control
 * that arrives is less alarming than one that leaves.
 */
function useSupportedSchemes(): ReadonlySet<string> {
  const [schemes, setSchemes] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all(
      NATIVE_SCHEMES.map(async (scheme) => {
        const ok = await Linking.canOpenURL(SCHEME_PROBES[scheme]).catch(
          // A rejected probe means "no", not a broken screen: iOS throws for a
          // scheme missing from LSApplicationQueriesSchemes, which is precisely
          // the case where we must not offer the action.
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

/**
 * The two halves of acting on a contact method, for a component that renders
 * them: which schemes this device answers, and what a press should do.
 *
 * `subjectName` is only ever read for the call confirmation, which names the
 * person it is about to interrupt.
 */
export function useContactReach(subjectName: string): {
  schemes: ReadonlySet<string>;
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

  return { schemes, perform };
}
