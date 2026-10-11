import { useEffect } from "react";
import { useRootNavigationState, useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { giftUrlOf } from "@leapsake/ui/headless";

/**
 * Opens "Add a gift" holding a link shared into the app from another app's
 * share sheet. A share with no web link is dropped.
 */
export function ShareIntoGift() {
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key !== undefined;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!navigationReady || !hasShareIntent) return;
    const url = giftUrlOf(shareIntent.webUrl ?? "");
    resetShareIntent();
    if (url !== null) router.push({ pathname: "/gifts/new", params: { url } });
  }, [navigationReady, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
