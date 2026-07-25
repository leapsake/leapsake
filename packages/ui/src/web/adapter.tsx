import {
  type ComponentType,
  type ReactNode,
  createContext,
  useContext,
} from "react";

/**
 * Client-side navigation. The prop is `href` — the HTML name — rather than
 * react-router's `to`, so the contract reads as semantic markup and can be
 * satisfied by whichever framework the web app lands on (`status.md` →
 * *Open questions*). The desktop adapter maps `href` → `to`; a framework whose
 * link already takes `href` needs no mapping at all.
 *
 * The index signature passes through `aria-*`, `title`, and friends without the
 * package having to enumerate them.
 */
export interface UiLinkProps {
  href: string;
  children: ReactNode;
  [key: string]: unknown;
}

/**
 * A submitting form. The adapter **must** render a real `<form>` with `method`
 * and `action` intact: the no-JS floor the web app owes
 * (`plans/encryption/model.md` §10) is exactly the case where no adapter
 * JavaScript runs and the browser posts the form itself. An adapter that
 * intercepted submission and dropped the underlying element would satisfy the
 * types and silently remove that floor.
 */
export interface UiFormProps {
  method: "post";
  action?: string;
  children: ReactNode;
}

/**
 * The two pieces of app chrome presentational components can't supply
 * themselves. Everything else a component needs — data, submit state, write
 * callbacks — arrives as props, because it is per-screen rather than ambient.
 * Keeping this interface at two members is deliberate: it is the whole surface
 * a new client has to implement.
 */
export interface UiAdapter {
  Link: ComponentType<UiLinkProps>;
  Form: ComponentType<UiFormProps>;
}

const UiAdapterContext = createContext<UiAdapter | null>(null);

/** Supplies the host app's navigation + form components to everything below. */
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

/**
 * Read the host's adapter. Throws rather than falling back to a plain `<a>`:
 * a silent fallback would render a full-page navigation that looks correct in
 * development and drops the app's router in production.
 */
export function useUi(): UiAdapter {
  const adapter = useContext(UiAdapterContext);
  if (adapter === null) {
    throw new Error(
      "@leapsake/ui: no UiProvider found. Wrap the app in <UiProvider adapter={…}> — see packages/ui/README.md.",
    );
  }
  return adapter;
}
