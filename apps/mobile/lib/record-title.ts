import type { EntityRow } from "@leapsake/core";
import type {
  EntityType,
  Person,
  Pet,
  ResolvedMention,
  SearchHit,
} from "@leapsake/schema";
import { entityLabel, fullName, tagLabel } from "@leapsake/schema";

/** The query parameter a link uses to tell a record screen its name. */
const PARAM = "title";

/**
 * What titles a record's page, shared by the screen and every link to it, so
 * a link's title always matches the one the screen sets once loaded.
 */
export function personTitle(person: Person): string {
  return fullName(person);
}

export function petTitle(pet: { name: string }): string {
  return pet.name;
}

/** With the "#", as a tag is shown everywhere it is named. */
export function tagTitle(tag: { name: string }): string {
  return tagLabel(tag.name);
}

export function holidayTitle(holiday: { name: string }): string {
  return holiday.name;
}

/**
 * Sends the destination's name ahead, so it is titled before its read lands.
 * Private: the builders below take a record, never a caller's string.
 */
function withTitle(path: string, title: string): string {
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

/** `entityLabel` is {@link personTitle} or {@link petTitle}, by type. */
export function entityHref(type: EntityType, entity: Person | Pet): string {
  const path = type === "person" ? "people" : "pets";
  return withTitle(`/${path}/${entity.id}`, entityLabel(type, entity));
}

// The three below carry a display name rather than the record, so each is
// kept here, next to the functions its string has to match.

/** `EntityRow.label` is `entityLabel(type, entity)`, as the pages use. */
export function entityRowHref(row: EntityRow): string {
  const path = row.type === "person" ? "people" : "pets";
  return withTitle(`/${path}/${row.id}`, row.label);
}

/**
 * A hit's `title` is the indexed display name; a tag's is bare, so it gains
 * its "#". A gift idea's page has a fixed title, so it takes no name.
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

/** A mention's `label` is the target's current `entityLabel`. */
export function mentionHref(mention: ResolvedMention): string {
  const path = mention.targetType === "person" ? "people" : "pets";
  // `label` is null only for a gone target, which the caller never links.
  return withTitle(`/${path}/${mention.targetId}`, mention.label ?? "");
}

/**
 * The name a link sent for the screen it opened, or `""` when it sent none.
 * Read by the navigators, so the title is right before the screen renders.
 */
export function titleFromLink(params: object | undefined): string {
  if (params === undefined) return "";
  const sent = (params as Record<string, unknown>)[PARAM];
  // A repeated parameter arrives as an array, which titles nothing.
  return typeof sent === "string" ? sent : "";
}

/**
 * The screen's declared title (even `""`), else the name its link sent.
 * Never `route.name`, which would show a route path in the header.
 */
export function headerTitle(
  options: { title?: string },
  route: { params?: object },
): string {
  return options.title ?? titleFromLink(route.params);
}

// `withTitle` encodes and `titleFromLink` does not decode: expo-router's
// `URLSearchParams` has already decoded `route.params`. Decoding twice breaks.
