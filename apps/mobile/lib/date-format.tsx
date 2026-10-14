import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppState } from "react-native";
import { type DateFormat, defaultDateFormat } from "@leapsake/schema";
import { useCore, useDataVersion } from "./core-context";
import { deviceRegion } from "./device-region";

interface DateFormatSetting {
  /** The user's choice, or `null` for their region's default. */
  chosen: DateFormat | null;
  /** What `null` means on this device. */
  regionDefault: DateFormat;
  choose: (format: DateFormat | null) => Promise<void>;
}

const DateFormatContext = createContext<DateFormatSetting | null>(null);

/** Holds the date format, re-read on launch, on a data bump and on return to
 *  the foreground, where a synced change from another device lands. */
export function DateFormatProvider({ children }: { children: ReactNode }) {
  const core = useCore();
  const version = useDataVersion();
  const [chosen, setChosen] = useState<DateFormat | null>(null);
  const [regionDefault] = useState(() => defaultDateFormat(deviceRegion()));

  const reload = useCallback(() => {
    core.preferences.getDateFormat().then(setChosen, (cause) => {
      console.error("reading the date format failed:", cause);
    });
  }, [core]);

  useEffect(reload, [reload, version]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") reload();
    });
    return () => sub.remove();
  }, [reload]);

  const choose = useCallback(
    async (format: DateFormat | null) => {
      await core.preferences.setDateFormat(format);
      setChosen(format);
    },
    [core],
  );

  return (
    <DateFormatContext.Provider value={{ chosen, regionDefault, choose }}>
      {children}
    </DateFormatContext.Provider>
  );
}

/** The date format and its setter, for the Settings screen. */
export function useDateFormatSetting(): DateFormatSetting {
  const setting = useContext(DateFormatContext);
  if (setting === null) throw new Error("No DateFormatProvider above this.");
  return setting;
}

/** The format every date on screen is written in. */
export function useDateFormat(): DateFormat {
  const { chosen, regionDefault } = useDateFormatSetting();
  return chosen ?? regionDefault;
}
