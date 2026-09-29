# `@leapsake/contact-links`

What a stored contact method can **do**: the platform registry (`PLATFORMS`), the links and
actions a row offers (`resolveActions`), and how a typed handle or number is normalized.
Depends only on `@leapsake/schema`.

## Every link is https

A custom URL scheme only works if the app binary declares it, so a scheme here would make this
list a property of each build rather than of this file. The only schemes a client must declare
are the system verbs in `NATIVE_SCHEMES`, which mobile pins with a test.

Every first-class platform intercepts its own universal links on iOS and Android, so
`https://instagram.com/someone` opens the app when it is installed and the browser when not.
`NATIVE_SCHEMES` is therefore short (`facetime`, `geo`): it is the exhaustive input to iOS's
`LSApplicationQueriesSchemes`, where a missing scheme makes `canOpenURL` return false with no
error. `tel:`, `sms:` and `mailto:` need no declaration. `SCHEME_PROBES` sits beside it so each
scheme's throwaway probe URL cannot drift from the list.

## How close a link gets you

Every action carries its **reach**, so the UI can say where a tap goes instead of promising a DM
it cannot deliver. Only some platforms publish a URL that opens a _conversation_: WhatsApp and
Signal key on a phone number, Telegram and Messenger on a username, Instagram on `ig.me/m/…`.
Three shapes follow:

- **Chat from a handle** (Telegram, Facebook/Messenger, Instagram): a tap opens the conversation,
  and the profile follows as a fallback.
- **Profile from a handle** (TikTok, Snapchat, Bluesky, LinkedIn, X): the handle reaches the person,
  but DMs key on an opaque numeric id the platform does not publish. Where that id unlocks more
  (X, Discord) the form offers an optional field for it, and a supplied id leads.
- **Nothing from a handle** (Discord): the username addresses nothing, so the row falls back to
  copying it until someone fills in the id.

A **phone** platform reaches someone through a stored number, so it adds actions to the phone
row rather than a row of its own. Leapsake cannot tell whether a number is on WhatsApp, so it is
**opt-in**: the user ticks it once on the phone form, which lists `PHONE_PLATFORMS`, and adding
one is a registry entry rather than a migration.

## What a row offers, in order

`resolveActions` returns the actions best first: `[0]` is the row tap, the rest the overflow
sheet, and the order lives here so both clients agree. A number marked as not textable leads with
Call rather than a text that goes nowhere; a chat link outranks the same platform's profile; Call
is the one action that **asks first**, being disruptive and irreversible; and `copy` closes every
list, so no row dead-ends. The list says what is _possible_: whether an app is installed is the
client's to probe with `canOpenURL`, falling back to the https URL.

A typed handle is kept as its owner writes it. `bareHandle` accepts a pasted profile URL (its last
path segment), drops a leading `@` and any query, and preserves case, since platforms ignore it and
the lookup key is normalized separately. A phone link gets `+` prepended unconditionally: a
number stored without a country code cannot be dialled internationally anyway, and the platform
refusing it beats a link that opens the wrong conversation.

## The contact-method form's draft lives here

`contactMethodDraftOf`, `contactMethodDraftWithKind` and `contactMethodInputOf` shape the add and
edit forms on both clients (see [`@leapsake/ui`](../ui/README.md) → _Forms_). They sit here
rather than in `schema`, where the other forms' shaping lives, because a social handle is
reduced by its platform's own rules (`normalizeFor`), and this package depends on `schema`, not
the other way round.

The draft holds every kind's fields at once, so switching kind on mobile keeps what was already
typed under another; only the fields its `kind` selects are read.
