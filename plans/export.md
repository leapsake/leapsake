# Export — what the exporter grows into

The exporter and the import side that reads its file back are built; what they emit and why is
[`@leapsake/vcard`](../packages/vcard/README.md) and [`@leapsake/export`](../packages/export/README.md).
⚠️ **None of it may ever use iCloud**; the permanent constraint is [`shipping.md`](./shipping.md)
→ _What must be true before the transfer will start_, and it binds everything below as much as it
bound what shipped.

**Increment 6:**

- **Restore.** The ids and timestamps in our own file are matching keys today, never row ids: an
  imported card always gets a fresh id and `X-LEAPSAKE-CREATED` is parsed but not applied,
  because honouring them needs the row-level `insert`. That is the restore door, and nothing on
  the import side lets it in by the back door (`X-LEAPSAKE-MILESTONE-ID` is a dedupe key; `-REL`
  is looked up through a map).
- **Desktop parity.** Desktop's Settings still says _"Leapsake cannot export it yet"_, and
  `api-channels.ts` already carries the `export.archive` channel waiting for the button.
- **CardDAV**, the surface the format was chosen for ([`encryption/model.md`](./encryption/model.md)
  §9.4), and **bulk export of photo originals** once files exist ([`media.md`](./media.md)).

**Three device verifications, none blocking:**

1. **The automated tap.** Maestro tapping Export and asserting the result line reports non-zero
   record and byte counts. `subflows/factory-reset.yaml` asserts the _offer is visible_ in each
   destructive confirmation but never taps it, because a share sheet that fails to dismiss inside
   a teardown stalls the arc and leaves the next flow asserting against the previous one's store.
   It wants a home where a stall fails loudly instead. The dismissal is known to be drivable:
   `tapOn: {point: "50%,15%"}` above the sheet closes it and lets `shareAsync` resolve.
2. **One AirDrop round trip, by hand.** Take a real export off a device, unzip it, and import
   `contacts.vcf` into macOS Contacts: the only check that exercises a third-party consumer rather
   than our own reader.
3. **A store with a pet and an unpublished person.** No device run has held either, so a pet card,
   an unpublished person as a text `RELATED`, a custom `X-ABLABEL` and `X-LEAPSAKE-SELF` rest on
   the Node tiers alone. This is about data shapes, not the runtime; the graph walk and the
   writer already run under Hermes.

**Open, a product question rather than a format one:** _should importing a file we wrote be
all-or-nothing?_ A `.vcf` from us is detectable before anything is parsed (`PRODID` names us,
which is why the writer emits it), so the review could offer "restore all of this" instead of a
per-card tick list. For: a partial import of your own backup produces shapes nobody asked for,
like a wedding landing on one partner because the other was unticked. Against: the same screen
is the one honest place to see what a file contains before it lands. It is a change to
`ImportReview.tsx`, not to the parser, and it does not block 6.
