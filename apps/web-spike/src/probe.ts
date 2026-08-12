import { PersonScreen } from "@leapsake/ui/web";

/**
 * The one-line answer to "does the Vite pipeline actually load the shared UI?"
 *
 * `PersonScreen` is the specific import that rules out `apps/server`'s plain-`tsx`
 * pattern: it reaches `primitives/Combobox.tsx` (via `HolidaysSection` →
 * `MultiAddCombobox`), which imports a **CSS module** Node cannot load, and the
 * whole chain is written with `.js` specifiers pointing at `.ts` files. If
 * `ssrLoadModule` resolves this, `ssr.noExternal: [/^@leapsake\//]` is doing its
 * job and Increment 2 is plumbing rather than a fight with the bundler.
 *
 * Loaded through Vite only — never imported by the server module graph directly,
 * which is exactly the point being tested.
 */
export function probe(): { screen: string } {
  return { screen: PersonScreen.name };
}
