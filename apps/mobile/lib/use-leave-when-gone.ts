import { useEffect } from "react";
import { useRouter } from "expo-router";

/** Returns to the reminders list once a screen's reminder turns out to be
 *  gone, rather than leaving the user on an empty page. */
export function useLeaveWhenGone(gone: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (gone) router.dismissTo("/");
  }, [gone, router]);
}
