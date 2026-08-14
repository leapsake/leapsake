import type { CoreApi } from "@leapsake/core";
import { MessagesProvider, en } from "@leapsake/ui/messages";
import { GiftsPortsProvider, PersonScreen, UiProvider } from "@leapsake/ui/web";
import type { GiftsPorts } from "@leapsake/ui/web";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ssrUiAdapter } from "../ui-adapter.js";

/**
 * The rendered half of the browser client: the loader, the screen, and the
 * provider stack — **everything downstream of having a `CoreApi`.**
 *
 * It is one file with two callers on purpose, and that is Increment 5c's
 * structural claim rather than a tidy-up. `client-app.tsx` (5b) hands it a
 * `core` built in this same thread; `client-worker-app.tsx` (5c) hands it a
 * `core` that is a `postMessage` proxy onto a Worker, where the database and the
 * master key actually live. Nothing here can tell the difference, because
 * `CoreApi` is already an all-async interface — the same reason desktop's
 * renderer talks to `window.api` over `ipcRenderer.invoke` and its screens never
 * mention it.
 *
 * So the file the two hosts share is the evidence: if the screen needed to know
 * which side of a thread boundary its data came from, this import would not
 * compile for one of them.
 */

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * The person page's data, from `core` — the *same seven calls*, in the same
 * `Promise.all`, that `routes/person.tsx` makes on the server and `personLoader`
 * makes on desktop against `window.api`.
 *
 * Copied rather than imported from the SSR route for one reason: that one wraps
 * these in the `WEB_SPIKE_LOADER=serial` attribution harness, which reads
 * `process.env`. The calls themselves are identical, and that they are is the
 * finding — a third host, a third transport under `CoreApi`, no reshaping.
 *
 * Over the Worker proxy this is seven `postMessage` round trips rather than
 * seven direct calls, still in one `Promise.all`. That it needed no batching API
 * is worth knowing: the calls were already async and already parallel.
 */
export async function personProps(core: CoreApi, id: string) {
  const [
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCandidates,
  ] = await Promise.all([
    core.views.person(id),
    core.reminders.mentioning("person", id),
    core.holidays.listForBearer("person", id),
    core.gifts.suggestions.listForRecipient("person", id),
    core.gifts.ideas.list(),
    core.gifts.given.listForRecipient("person", id),
    core.duplicates.findFor(id),
  ]);
  if (view === null) return null;
  return {
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCount: duplicateCandidates.length,
  };
}

type PersonProps = Awaited<ReturnType<typeof personProps>>;

/**
 * `apps/desktop/src/renderer/src/screens/PersonView.tsx`, with its two
 * dependencies on being desktop replaced:
 *
 * - `useLoaderData()` → the loader called directly, since this client has no
 *   router (the framework question is still deliberately open);
 * - `useRevalidator()` → `load()` again, which is the same idea with none of the
 *   machinery. `onSetObserves` and `onChanged` are the two writes that do *not*
 *   go through a route action, and on the no-JS host they were no-ops with an
 *   apology in a comment. **Here they work**, because JavaScript runs.
 *
 * The `<select>` is the spike's, not the product's: there is no shared people
 * list (see `routes/people.tsx`), and one is not worth inventing to prove a
 * screen renders.
 */
export function PersonApp(props: {
  core: CoreApi;
  people: readonly { id: string; label: string }[];
  first: string;
}): ReactElement {
  const { core, people, first } = props;
  const [id, setId] = useState(first);
  const [data, setData] = useState<PersonProps>(null);
  const [loaderMs, setLoaderMs] = useState<number | null>(null);

  const load = useCallback(
    async (personId: string): Promise<void> => {
      const started = performance.now();
      const next = await personProps(core, personId);
      setLoaderMs(round(performance.now() - started));
      setData(next);
    },
    [core],
  );

  useEffect(() => {
    void load(id);
  }, [load, id]);

  return (
    <>
      <p>
        <label htmlFor="who">Person</label>{" "}
        <select
          id="who"
          value={id}
          onChange={(event) => setId(event.target.value)}
        >
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.label}
            </option>
          ))}
        </select>{" "}
        <small>
          {people.length} people in the browser&rsquo;s store
          {loaderMs === null ? "" : ` — loader ${loaderMs} ms`}
        </small>
      </p>
      {data === null ? (
        <p>Loading…</p>
      ) : (
        <PersonScreen
          // Every `href` this screen renders is a link to the *SSR* host's
          // routes, and clicking one is a full document navigation that throws
          // this tab's store and master key away. That is not a bug in the
          // adapter, it is what the degenerate adapter *is* — see the findings.
          trail={[{ label: "People & Pets", href: "/client" }]}
          person={data.view.person}
          gender={data.view.gender}
          tags={data.view.tags}
          relationships={data.view.relationships}
          timeline={data.view.timeline}
          contactMethods={data.view.contactMethods}
          mentionedIn={data.mentionedIn}
          holidays={data.holidays}
          giftSuggestions={data.giftSuggestions}
          giftsGiven={data.giftsGiven}
          giftIdeaPool={data.giftIdeaPool}
          duplicateCount={data.duplicateCount}
          onSetObserves={(holidayId, observes) =>
            core.holidays.setObservers(holidayId, [
              { bearerType: "person", bearerId: id, observes },
            ])
          }
          onChanged={() => {
            void load(id);
          }}
        />
      )}
    </>
  );
}

export function mountPersonApp(
  core: CoreApi,
  ports: GiftsPorts,
  people: readonly { id: string; label: string }[],
): void {
  const host = document.getElementById("app");
  const first = people[0]?.id;
  if (host === null || first === undefined) return;

  // The identical provider stack `render.tsx` mounts for a server render — the
  // same three providers, the same adapter instance — with `renderToString`
  // replaced by a root. Nothing about `@leapsake/ui` needed to know which.
  createRoot(host).render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={ssrUiAdapter}>
        <GiftsPortsProvider ports={ports}>
          <PersonApp core={core} people={people} first={first} />
        </GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>,
  );
}
