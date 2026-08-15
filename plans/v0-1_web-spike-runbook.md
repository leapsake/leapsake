# Web spike — the two checks the owner has to make

> **Follow this top to bottom and you never have to read anything else.** It exists because the
> spike's last two checks need a human: one needs a **Firefox preference**, the other a **native
> install dialog**, and neither can be driven by an agent. Every command below was run on
> 2026-08-14 against this tree and produced the output shown.
>
> When both answers are written down, the spike is over — the teardown is §4, and this file is
> deleted with it.

Budget: **~15 minutes**, most of it §1.

---

## 1. Start the three processes

Three terminals, left running for both checks. Run each from the repo root unless it says
otherwise.

**1.1 — the throwaway relay.** The two rate-limit vars are a *finding*, not a convenience: an SSR
host logs in from one IP for every user, so the stock per-IP budget locks users out.

```sh
cd apps/server && PORT=4001 RELAY_DB=:memory: \
  RELAY_BOOTSTRAP_RATE_LIMIT_MAX=100000 RELAY_RATE_LIMIT_MAX=100000 \
  pnpm exec tsx src/index.ts
```

Expect: `Leapsake relay listening on http://localhost:4001`. It has no `/health` route — a 404
there is normal. **`:memory:` means restarting it destroys the account**, so if you restart it,
redo 1.2.

**1.2 — seed the account.** New terminal, repo root:

```sh
pnpm --filter @leapsake/web-spike seed \
  --relay http://localhost:4001 --username ada --password 'hunter2 hunter2' --rows 100
```

Expect a block ending `push  129 records  32.9 KiB wire`. It prints a **person id** for Ada
Lovelace — ignore it, you'll click her by name.

**1.3 — the SSR host.** Third terminal, repo root:

```sh
RELAY_URL=http://localhost:4001 pnpm --filter @leapsake/web-spike dev
```

Expect: `web-spike listening on http://localhost:5180  (store mode: cold, push mark: pull)`.

⚠️ **Do not restart this one during Check A.** Shares live in a process `Map`, so a restart
invalidates any share link you made.

*(All three are already up in the agent's session right now, with the account seeded — if you're
doing this immediately, skip to §2.)*

---

## 2. Check A — Firefox with JavaScript disabled

**The question:** does the no-JS floor hold in a *real* browser? Everything so far was proved by
`curl` and by parsing markup — the response provably contains no `<script>` and no inline event
attribute, so the claim is strong, but no browser was ever driven with JS off. This is the
thirty-second confirmation.

**2.1** — Open **Firefox** (`/Applications/Firefox.app`, installed). Use a fresh window you don't
mind breaking — **every site is unusable with this pref off**, so turn it back on at 2.9.

**2.2** — Go to `about:config`, accept the warning, search for:

```
javascript.enabled
```

Click the toggle at the right so it reads **`false`**. (It's a boolean; there's no Save.)

**2.3** — Go to `http://localhost:5180`. It redirects to `/login`. Log in:

- Username `ada`
- Password `hunter2 hunter2`

You should land on **People & Pets**, listing Ada Lovelace, Charles Babbage and 98
`PersonN Filler` rows. *If the login form doesn't submit, the check has already failed — say so.*

**2.4 — C.** Click **Add** (top of the list) → the create form at `/people/new`. Fill in a first
and last name, optionally tags, and press **Add**. Expect to land on the new person's page.

> Two things on this page are **expected to be inert** with JS off, and are not failures — they're
> the known gaps: the **Add relationship** button (`type="button"`, needs JS to grow a row), and
> on a person page the **Gifts** capture form and the **Holidays** add-field.

**2.5 — U.** On that person, click **Edit**, change the name, press **Save**. Expect to come back
to the person page showing the new name.

**2.6 — D.** Click **Delete**, then the **Delete** button on the confirm page. Expect to land back
on the list with the person gone. (There's a **Cancel** link beside it if you want to test that
too.)

**2.7 — the hosted share.** Back on `/people`, click **Share a relationship** at the bottom. Pick
**Ada Lovelace** in the dropdown, press **Show**. Her relationship with Charles Babbage appears
with two buttons; press:

```
Hosted link (server can read it)
```

The next page prints a link like `http://localhost:5180/hosted/<uuid>`.

**2.8** — Open that link **in a new tab** (still JS-disabled). Expect the shared relationship to
render: a heading reading **Ada Lovelace & Charles Babbage**, with both partners. That is the
half of Increment 4 that a DOM stub couldn't prove — a hosted share is server-rendered, so it must
work with JS off.

*(Optional, 20 seconds: press **Capability link (private)** instead on 2.7 and open that link with
JS off. It should show a `<noscript>` explaining the key never reaches the server — a page that
**says** it needs JS, not one that looks broken. This is the designed behavior, not a bug.)*

**2.9** — **Set `javascript.enabled` back to `true`.**

**Write the answer in §5, Answer A.** One line is enough: which of 2.4/2.5/2.6/2.8 worked, and
anything that behaved differently from what's written above.

---

## 3. Check B — install the PWA and read one line

**The question:** `navigator.storage.persist()` is **refused** on a plain `localhost` tab, which
leaves the OPFS database and the wrapped master key both evictable. Does an **installed** origin
get a different answer? Chrome grants durability to installed or highly-engaged origins, and
"install changes the answer" is a hypothesis nobody has tested. **If it's still refused, that is
the answer** — write it down and move on. The failure mode is mild by design: eviction costs one
Argon2id and a re-pull, not an account.

**3.1** — In **Chrome**, open:

```
http://localhost:5180/client-pwa
```

**3.2** — It boots by itself. If it shows a login form, log in with `ada` / `hunter2 hunter2`
(the fields are prefilled) — that mints the wrap the app runs on. Wait for the person to render.

**3.3** — Read the **storage** line near the top. On a plain tab it should say something like:

```
best-effort (evictable) storage — persist() was refused, N.N MiB used of 10.0 GiB
 · running as: browser tab — install the app and reload to see whether Chrome's answer changes
```

**3.4** — An **Install this app** button appears below it (Chrome only shows it when the manifest,
icons and service worker all qualify — verified serving 200s). Click it, and accept Chrome's
native install dialog. *(The `⊞`/install icon in the address bar does the same thing.)*

**3.5** — The app opens in its own window. **Reload it once** (⌘R), and read the same storage line
again. It now reports what an *installed* origin gets, and `running as:` should say
**`standalone`** rather than `browser tab` — that's how you know you're reading the installed
answer and not the tab's.

**Write the answer in §5, Answer B**: the storage line verbatim, both halves — the wording before
the `·` and the `running as:` value.

**3.6 — cleanup (optional):** uninstall from the app window's ⋮ menu → *Uninstall Leapsake*.

---

## 4. When both answers are written: the teardown

Nobody needs the owner at a keyboard for this — hand it to an agent, or run it yourself.

1. Fold both answers into [`v0-1_web-spike.md`](./v0-1_web-spike.md) — Answer A into *The no-JS
   floor*, Answer B into the §13 durability bullet under *Three edits owed to
   `encryption/model.md`* — and delete that doc's *Still owed* section.
2. Tag the commit: `git tag web-spike-final` (it's how `git show web-spike-final:<path>` keeps the
   ~8 000 lines readable forever).
3. `rm -rf apps/web-spike`, and drop its entry from the workspace if it's pinned anywhere.
4. Revert the `apps/web-spike` line in `.oxlintrc.json` → `ignorePatterns`.
5. Delete **this file**, and retire the spike's rows in [`status.md`](./status.md) and
   [`v0-1.md`](./v0-1.md) → *Parallel, not in the chain*.

Then the next thing is **08 Increment 1**, the policy substrate.

---

## 5. Answers

**Answer A — Firefox, `javascript.enabled=false`** *(create / edit / delete, and a hosted share)*

> _(not yet run)_

**Answer B — durable storage on an installed origin** *(the storage line, verbatim)*

> _(not yet run)_

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Login fails after a while | The relay is `:memory:` — if it restarted, re-run 1.2 |
| A share link 404s | The SSR host restarted; shares live in its process `Map`. Make a new one |
| `/client-pwa` hangs on "Starting the worker…" | Another tab of `/client-pwa`, `/client-worker` or `/client-key` holds the OPFS pool. Close it — this page queues rather than crashing, and takes over in ~20 ms |
| The install button never appears | Chrome only offers it once the service worker controls the page; reload once |
| Port already in use | `lsof -nP -iTCP:5180 -sTCP:LISTEN` — an earlier run is still up |
