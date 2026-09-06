import type { EntityRow } from "@leapsake/core";
import type {
  EntityType,
  Person,
  Pet,
  ResolvedMention,
  SearchHit,
} from "@leapsake/schema";
import { entityLabel, fullName, tagLabel } from "@leapsake/schema";

/**
 * The query parameter a link uses to tell a record screen what that record is
 * called. Chosen to match react-navigation's own word for the thing it feeds.
 */
const PARAM = "title";

/**
 * ## What titles a record's page
 *
 * One function per kind, called by two places that must never disagree: the
 * screen, for its own `<Stack.Screen options={{ title }} />`, and the link that
 * opens it, which sends the same string ahead so the screen is titled before its
 * read comes back (see {@link withTitle} below).
 *
 * They are thin — a person's page is titled with their full name, a pet's with
 * its name — and that is the point. Written out at each end instead, the two
 * agree only by coincidence, and the coincidence is invisible: nothing fails when
 * a link starts sending the row's decorated "Rex (pet)" to a page that titles
 * itself "Rex". Named once, they are the same expression, and a change to how a
 * page is titled is carried by every link to it.
 */
export function personTitle(person: Person): string {
  return fullName(person);
}

export function petTitle(pet: { name: string }): string {
  return pet.name;
}

/** With the "#" — a tag is shown wearing its sigil everywhere it is named. */
export function tagTitle(tag: { name: string }): string {
  return tagLabel(tag.name);
}

export function holidayTitle(holiday: { name: string }): string {
  return holiday.name;
}

/**
 * ## Links that carry the name
 *
 * A record screen can only title itself once its own read comes back, and until
 * then it has nothing to put in the header — the app's own name for that gap was
 * the route path (`reminders/[id]/index`) until {@link headerTitle} stopped
 * falling back to it, and a blank bar after that. But the screen the user tapped
 * *from* knew the answer: a list row, a tag chip, an `@mention` all render the
 * very name the destination is about to display. Sending it along turns the load
 * into a screen that is simply already titled.
 *
 * Every builder below takes the **record**, never a caller's string, and derives
 * the title with the functions above. That is what makes agreement structural
 * rather than remembered: there is no argument for a call site to get wrong.
 * {@link withTitle} itself stays private for the same reason — a general
 * "path plus any string" is exactly the door this closes.
 *
 * It stays a hint and never a source: {@link headerTitle} reads it only while the
 * screen has declared no title of its own, so the record's own read overwrites it
 * the moment that lands. A name gone stale between the two — renamed on another
 * device, mid-sync — is therefore wrong only for the frames before the truth
 * arrives, and a link that sends nothing (a deep link, a notification) is no
 * worse off than before this existed.
 */
function withTitle(path: string, title: string): string {
  // An unnamed record — a person saved with no name yet — has nothing to send,
  // and an empty parameter would only make the URL longer to say so.
  if (title === "") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${PARAM}=${encodeURIComponent(title)}`;
}

export function personHref(person: Person): string {
  return withTitle(`/people/${person.id}`, personTitle(person));
}

export function petHref(pet: { id: string; name: string }): string {
  return withTitle(`/pets/${pet.id}`, petTitle(pet));
}

export function tagHref(tag: { id: string; name: string }): string {
  return withTitle(`/tags/${tag.id}`, tagTitle(tag));
}

export function holidayHref(holiday: { id: string; name: string }): string {
  return withTitle(`/holidays/${holiday.id}`, holidayTitle(holiday));
}

/**
 * A person's or pet's page, whichever this record is — titled with
 * `entityLabel`, which is `fullName` for one and the plain name for the other,
 * and so is {@link personTitle} and {@link petTitle} under another name.
 */
export function entityHref(type: EntityType, entity: Person | Pet): string {
  const path = type === "person" ? "people" : "pets";
  return withTitle(`/${path}/${entity.id}`, entityLabel(type, entity));
}

/**
 * ### The three that arrive already named
 *
 * A catalog row, a search hit and a resolved `@mention` carry a display name
 * rather than the record, so these are the only places that can hand
 * {@link withTitle} a string it did not derive. Each is one line, and each is
 * here — rather than at its call site — so the claim that its string is the right
 * one is made once, next to the functions it has to match.
 */

/** `EntityRow.label` is `entityLabel(type, entity)`, which is what titles both pages. */
export function entityRowHref(row: EntityRow): string {
  const path = row.type === "person" ? "people" : "pets";
  return withTitle(`/${path}/${row.id}`, row.label);
}

/**
 * A hit's `title` is the plain display name the search service indexed — a
 * person's full name, a pet's, a tag's *bare* name, a holiday's. So the tag hit
 * is the one that needs work: its page wears the "#" that a hit deliberately
 * leaves off. A gift idea's page is titled "Gift idea" whatever it holds, so it
 * takes no name.
 */
export function searchHitHref(hit: SearchHit): string {
  if (hit.entityType === "gift_idea") return `/gifts/${hit.entityId}/edit`;
  if (hit.entityType === "tag")
    return tagHref({ id: hit.entityId, name: hit.title });
  if (hit.entityType === "holiday")
    return holidayHref({ id: hit.entityId, name: hit.title });
  const path = hit.entityType === "pet" ? "pets" : "people";
  return withTitle(`/${path}/${hit.entityId}`, hit.title);
}

/**
 * A mention's `label` is the target's **current** `entityLabel` — the same
 * function behind both page titles. Unresolved mentions (`label: null`) aren't
 * links at all, so they never reach here.
 */
export function mentionHref(mention: ResolvedMention): string {
  const path = mention.targetType === "person" ? "people" : "pets";
  // `label` is null only for a mention whose target is gone, which the caller
  // renders as plain text rather than a link — so this is the bare path it never
  // navigates to, not a case worth its own branch.
  return withTitle(`/${path}/${mention.targetId}`, mention.label ?? "");
}

/**
 * The name a link sent for the screen it opened, or `""` when it sent none.
 *
 * Read by the navigators rather than by each screen, which is what makes it cost
 * a loading screen nothing: a screen that hasn't reached its own `<Stack.Screen>`
 * yet has declared no options at all, so there is nowhere in it to put this.
 * Reading the route's own parameters in the header renderer means the title is
 * right on the **first** frame, on every route that carries one, with no screen
 * having to opt in.
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
 * A note on the encoding, because the two halves look mismatched: what
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
