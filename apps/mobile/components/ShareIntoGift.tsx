import { useEffect } from "react";
import { useRootNavigationState, useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { sharedGiftOf } from "@leapsake/ui/headless";

/**
 * Opens "Add a gift" started from text shared into the app from another app's
 * share sheet: its link if it holds one, else the text as the gift's name.
 */
export function ShareIntoGift() {
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key !== undefined;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!navigationReady || !hasShareIntent) return;
    const start = sharedGiftOf(shareIntent.text ?? "");
    resetShareIntent();
    if (start !== null) router.push({ pathname: "/gifts/new", params: start });
  }, [navigationReady, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
