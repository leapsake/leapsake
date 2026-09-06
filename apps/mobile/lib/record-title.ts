/**
 * The query parameter a link uses to tell a record screen what that record is
 * called. Chosen to match react-navigation's own word for the thing it feeds.
 */
const PARAM = "title";

/**
 * Name a record's path with the name the screen doing the linking already has.
 *
 * A record screen can only title itself once its own read comes back, and until
 * then it has nothing to put in the header — the app's own name for that gap was
 * the route path (`reminders/[id]/index`) until the navigators stopped falling
 * back to it, and a blank bar after that. But the screen the user tapped *from*
 * knew the answer: a list row, a tag chip, an `@mention` all render the very name
 * the destination is about to display. Sending it along turns the load into a
 * screen that is simply already titled.
 *
 * It is a hint and never a source: {@link titleFromLink} is read only while the
 * screen has declared no title of its own, so the record's own read overwrites it
 * the moment that lands. A name gone stale between the two — renamed on another
 * device, mid-sync — is therefore wrong only for the frames before the truth
 * arrives, and a link that sends nothing (a deep link, a notification, a screen
 * with no name to give) is no worse off than before this existed.
 *
 * Send the string the destination will *itself* show — `fullName(person)`,
 * `pet.name`, `tagLabel(tag.name)`, `holiday.name` — not the row's decorated
 * version of it. A row reading "Rex (pet)" whose page reads "Rex" should send
 * "Rex", or the title visibly rewrites itself on arrival, which is the flicker
 * this exists to remove.
 */
export function withTitle(path: string, title: string): string {
  // An unnamed record — a person saved with no name yet — has nothing to send,
  // and an empty parameter would only make the URL longer to say so.
  if (title === "") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${PARAM}=${encodeURIComponent(title)}`;
}

/**
 * The name a link sent for the screen it opened, or `""` when it sent none.
 *
 * Read by the navigators (`app/_layout.tsx`) rather than by each screen, which is
 * what makes it cost a loading screen nothing: a screen that hasn't reached its
 * own `<Stack.Screen>` yet has declared no options at all, so there is nowhere in
 * it to put this. Reading the route's own parameters in the header renderer means
 * the title is right on the **first** frame, on every route that carries one, with
 * no screen having to opt in.
 */
export function titleFromLink(params: object | undefined): string {
  if (params === undefined) return "";
  const sent = (params as Record<string, unknown>)[PARAM];
  // Array-valued if a parameter is somehow repeated; there is no sensible title
  // in that, so it falls through to the blank one.
  return typeof sent === "string" ? sent : "";
}

/**
 * What a header shows for a screen: the title the screen declared, or — while it
 * has declared none — the name the link that opened it sent.
 *
 * Both navigators route through here (`app/_layout.tsx`,
 * `app/(tabs)/_layout.tsx`) so there is one answer to "what goes in the header",
 * and so that answer is testable: a layout is unreachable from a unit test, and
 * the rule this encodes is worth a test.
 *
 * The rule is that **a route never names a screen**. React Navigation offers
 * `route.name` for the gap this fills, and taking it put "reminders/[id]/index"
 * in the one place on screen whose job is to answer "where am I?" — so the gap is
 * filled by the linking screen's answer, or by nothing at all. A declared title
 * always wins, including a deliberate empty one (the reminder detail sets `""`,
 * whose own first words are its heading).
 */
export function headerTitle(
  options: { title?: string },
  route: { params?: object },
): string {
  return options.title ?? titleFromLink(route.params);
}

/*
 * A note on the encoding, because the two halves above look mismatched: what
 * {@link withTitle} percent-encodes, {@link titleFromLink} does not decode.
 *
 * It doesn't have to. expo-router parses a path's query with
 * `new URL(href, "file:").searchParams`, and `URLSearchParams` decodes on the way
 * in — so by the time a value reaches `route.params` it is already the string
 * that was sent. (`useLocalSearchParams` runs `decodeURIComponent` over the same
 * values a second time, which is why reading them there looks like it needs it.
 * We read `route.params` directly and must not.) The encoding on the way out is
 * still load-bearing: a name holding a `#`, `&` or `?` would otherwise not
 * survive being written into a URL at all.
 */
