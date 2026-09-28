# `@leapsake/contact-links`

What a stored contact method can **do**: the platform registry (`PLATFORMS`), the links and
actions a row offers (`resolveActions`), and how a typed handle or number is normalized.
Depends only on `@leapsake/schema`.

## Every link is https

A custom URL scheme only works if the app binary declares it, so a scheme here would make this
list a property of each build rather than of this file. The only schemes a client must declare
are the system verbs in `NATIVE_SCHEMES`, which mobile pins with a test.

## The contact-method form's draft lives here

`contactMethodDraftOf`, `contactMethodDraftWithKind` and `contactMethodInputOf` shape the add and
edit forms on both clients (see [`@leapsake/ui`](../ui/README.md) → _Forms_). They sit here
rather than in `schema`, where the other forms' shaping lives, because a social handle is
reduced by its platform's own rules (`normalizeFor`), and this package depends on `schema`, not
the other way round.

The draft holds every kind's fields at once, so switching kind on mobile keeps what was already
typed under another; only the fields its `kind` selects are read.
