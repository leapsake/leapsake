import {
  type ContactMethod,
  type ContactMethodKind,
  formatPostalAddress,
} from "@leapsake/schema";
import { findPlatform } from "@leapsake/contact-links";
import { useMessages } from "../../messages/index.js";
import type { Messages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** The icon shown beside each contact-method kind. */
const KIND_ICON: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
  social: "💬",
};

/**
 * Render a method's value: the address; the (extension-suffixed) number, flagged
 * when it can't receive SMS since texting is otherwise assumed; the handle
 * behind its platform's name; or the formatted postal address.
 *
 * The two phone shapes are catalog messages rather than concatenations here,
 * because “555-0100 ext. 12” and “555-0100 (no texts)” are sentences about a
 * number, and where the qualifier goes is a language's decision.
 */
function methodValue(entry: ContactMethod, m: Messages): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const { number, extension, smsCapable } = entry.method;
    const withExt =
      extension === null || extension === ""
        ? number
        : m.contactMethods.phoneWithExtension(number, extension);
    return smsCapable ? withExt : m.contactMethods.phoneWithoutSms(withExt);
  }
  if (entry.kind === "social") {
    // The platform's proper noun beside the handle, so a bare "@josh" says which
    // "@josh". An unknown platform id is shown as stored rather than hidden —
    // the whole point of the open list is that a row survives a platform this
    // build has never heard of.
    const { platform, handle, url } = entry.method;
    const name = findPlatform(platform)?.name ?? platform;
    return handle === ""
      ? (url ?? name)
      : m.contactMethods.socialHandle(name, handle);
  }
  return formatPostalAddress(entry.method);
}

/**
 * The Contact section on a Person's view: the person's emails, phones, postal
 * addresses and social profiles, merged into one list by {@link ContactMethod}
 * and rendered with a per-kind Edit / Remove. Each “Add” link creates one kind.
 *
 * Unlike the mobile section, a row here is not a tap target — the actions in
 * `@leapsake/contact-links` are built for a handset that has the apps installed,
 * and “open WhatsApp” means something quite different on a laptop. Owner is a
 * Person today; when households ship the same list also surfaces the household's
 * shared methods (the union lives in `listContactMethods`, not here).
 */
export function ContactMethodsSection({
  personId,
  methods,
}: {
  personId: string;
  methods: readonly ContactMethod[];
}) {
  const { Link } = useUi();
  const m = useMessages();
  const basePath = `/people/${personId}`;

  return (
    <Section
      title={m.contactMethods.title}
      actions={
        <>
          <Link href={`${basePath}/contact/email/new`}>
            {m.contactMethods.addEmail}
          </Link>{" "}
          <Link href={`${basePath}/contact/phone/new`}>
            {m.contactMethods.addPhone}
          </Link>{" "}
          <Link href={`${basePath}/contact/postal/new`}>
            {m.contactMethods.addAddress}
          </Link>{" "}
          <Link href={`${basePath}/contact/social/new`}>
            {m.contactMethods.addSocial}
          </Link>
        </>
      }
    >
      {methods.length === 0 ? (
        <EmptyState>{m.contactMethods.empty}</EmptyState>
      ) : (
        <DataTable
          items={methods}
          getKey={(entry) => `${entry.kind}:${entry.method.id}`}
          columns={[
            {
              header: m.contactMethods.columnLabel,
              cell: (entry) => (
                <>
                  {KIND_ICON[entry.kind]} {entry.method.label}
                </>
              ),
            },
            {
              header: m.contactMethods.columnValue,
              cell: (entry) => methodValue(entry, m),
            },
            {
              header: "",
              cell: (entry) => {
                const path = `${basePath}/contact/${entry.kind}/${entry.method.id}`;
                return (
                  <>
                    <Link href={`${path}/edit`}>{m.common.edit}</Link>{" "}
                    <Link href={`${path}/delete`}>{m.common.remove}</Link>
                  </>
                );
              },
            },
          ]}
        />
      )}
    </Section>
  );
}
