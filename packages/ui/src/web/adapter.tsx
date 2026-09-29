import {
  type ComponentType,
  type FormEvent,
  type ReactNode,
  createContext,
  useContext,
} from "react";

/** Client-side navigation, taking `href`; other props such as `aria-*` pass
 *  through. */
export interface UiLinkProps {
  href: string;
  children: ReactNode;
  [key: string]: unknown;
}

/** A submitting form, which must render a real `<form>` with `method` and
 *  `action` intact, so it still posts without JavaScript. */
export interface UiFormProps {
  method: "post";
  action?: string;
  /** Runs before the post; `preventDefault()` stops it. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/** The two pieces of app chrome components can't supply themselves. */
export interface UiAdapter {
  Link: ComponentType<UiLinkProps>;
  Form: ComponentType<UiFormProps>;
}

const UiAdapterContext = createContext<UiAdapter | null>(null);

/** Supplies the host app's navigation and form components. */
export function UiProvider({
  adapter,
  children,
}: {
  adapter: UiAdapter;
  children: ReactNode;
}) {
  return (
    <UiAdapterContext.Provider value={adapter}>
      {children}
    </UiAdapterContext.Provider>
  );
}

/** Reads the host's adapter; throws rather than falling back to `<a>`. */
export function useUi(): UiAdapter {
  const adapter = useContext(UiAdapterContext);
  if (adapter === null) {
    throw new Error(
      "@leapsake/ui: no UiProvider found. Wrap the app in <UiProvider adapter={…}> — see packages/ui/README.md.",
    );
  }
  return adapter;
}
