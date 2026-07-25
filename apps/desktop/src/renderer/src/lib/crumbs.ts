import type { Crumb } from "@leapsake/ui/web";

/**
 * The shared root crumb: the combined People & Pets list at `/people`.
 *
 * Lives in the app rather than in `@leapsake/ui`, because which route counts as
 * “home” is this client's decision, not a property of a breadcrumb trail.
 */
export const homeCrumb: Crumb = { label: "People & Pets", href: "/people" };
