import type { CoreApi } from "@leapsake/core";
import { PersonScreen } from "@leapsake/ui/web";
import { html, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * A person's page, server-rendered — **the increment's whole question**.
 *
 * ## The loader is a mechanical port, and that is the finding
 *
 * `personLoader` in `apps/desktop/src/renderer/src/router.tsx` is seven parallel
 * `window.api.*` calls. `window.api` mirrors `CoreApi`, so each one becomes the
 * same call on `core` — same names, same arguments, same `Promise.all`. Nothing
 * was reshaped, and nothing needed to be, because the desktop loader never
 * depended on being in Electron: it depended on `CoreApi`, which is portable by
 * construction.
 *
 * The prop wiring below is `screens/PersonView.tsx` with `useLoaderData()`
 * replaced by the arguments and both callbacks replaced by no-ops. The no-ops
 * are honest rather than lazy: `onSetObserves` and `onChanged` exist for
 * desktop's revalidator, and a no-JS page has no revalidation — a write is a
 * navigation, which Increment 3 takes up.
 */

/** One labelled loader call, deferred so it can be run either way. */
type Call<T> = readonly [label: string, run: () => Promise<T>];

/**
 * Run the loader's calls and time each — in parallel like the desktop loader, or
 * **serially** under `WEB_SPIKE_LOADER=serial`.
 *
 * The serial mode is not a performance option, it is the *attribution* one. Run
 * in parallel, a call that blocks the event loop makes every sibling's timer read
 * the same number, because none of their `await`s can resolve until the block
 * ends — so a 12-second page reports seven 12-second calls and names no culprit.
 * Serial costs the parallelism and answers the question.
 */
async function gather<T extends readonly unknown[]>(
  calls: { [K in keyof T]: Call<T[K]> },
): Promise<T> {
  const serial = process.env.WEB_SPIKE_LOADER === "serial";
  const parts: string[] = [];

  const timed = async <V,>([label, run]: Call<V>): Promise<V> => {
    const started = performance.now();
    try {
      return await run();
    } finally {
      parts.push(`${label} ${Math.round((performance.now() - started) * 10) / 10}`);
    }
  };

  const results: unknown[] = [];
  if (serial) {
    for (const call of calls) results.push(await timed(call));
  } else {
    results.push(...(await Promise.all(calls.map((call) => timed(call)))));
  }
  console.log(`  loader${serial ? " (serial)" : ""}: ${parts.join(" ms, ")} ms`);
  return results as unknown as T;
}

export async function personPage(core: CoreApi, id: string): Promise<Reply> {
  const [
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCandidates,
  ] = await gather([
    ["views.person", () => core.views.person(id)],
    ["reminders.mentioning", () => core.reminders.mentioning("person", id)],
    ["holidays.listForBearer", () => core.holidays.listForBearer("person", id)],
    [
      "gifts.suggestions",
      () => core.gifts.suggestions.listForRecipient("person", id),
    ],
    ["gifts.ideas", () => core.gifts.ideas.list()],
    ["gifts.given", () => core.gifts.given.listForRecipient("person", id)],
    ["duplicates.findFor", () => core.duplicates.findFor(id)],
  ] as const);

  // Desktop throws a `Response` here and lets the router render its error
  // element; this host has no router, so the 404 is the return value.
  if (view === null) return text(404, "Person not found\n");

  return html(
    renderPage({
      title: `${view.person.firstName} ${view.person.lastName}`,
      children: (
        <PersonScreen
          trail={[{ label: "People & Pets", href: "/people" }]}
          person={view.person}
          gender={view.gender}
          tags={view.tags}
          relationships={view.relationships}
          timeline={view.timeline}
          contactMethods={view.contactMethods}
          mentionedIn={mentionedIn}
          holidays={holidays}
          giftSuggestions={giftSuggestions}
          giftsGiven={giftsGiven}
          giftIdeaPool={giftIdeaPool}
          duplicateCount={duplicateCandidates.length}
          onSetObserves={() => Promise.resolve()}
          onChanged={() => {}}
        />
      ),
    }),
  );
}
