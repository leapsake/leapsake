# @leapsake/phone

A phone number as the rest of the world reads it. A number is stored exactly as its owner
wrote or imported it, with its country code optional; `phoneE164(raw, region)` works out the
international form (`+14126062561`) from that text whenever something needs one, reading a
number without its country code as the given region's. Nothing stores the result, so a wrong
guess is never written down or synced.

It returns `""` rather than guessing: with no country code and no region, or for a number that
is not valid in the region it would be read as, so a caller falls back to what it would have
done with no international form at all. The region is an ISO 3166 alpha-2 code the caller
supplies. Shared code cannot see the device, so each app reads it at its entry.

## Why a dependency

Turning a national number into an international one is not "put the calling code in front".
The UK drops its trunk `0`, Italy keeps its, North American numbers may arrive with or
without their leading `1`, and a number can be too short or too long for its country to be
real. `libphonenumber-js` is the pure-JS port of Google's libphonenumber, the rules Android,
Google Contacts and Signal all rely on, and a hand-kept table of calling codes would get
exactly those cases wrong while claiming to be right.

It is imported with its default (`min`) metadata, the smallest set that still checks a
number's validity. It is pure JS, so it runs unchanged on Hermes.
