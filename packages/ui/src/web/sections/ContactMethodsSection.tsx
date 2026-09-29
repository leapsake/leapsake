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

/** A method's value as shown; a phone that can't take texts says so. */
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
    // The platform names the handle; an unknown platform id shows as stored.
    const { platform, handle, url } = entry.method;
    const name = findPlatform(platform)?.name ?? platform;
    return handle === ""
      ? (url ?? name)
      : m.contactMethods.socialHandle(name, handle);
  }
  return formatPostalAddress(entry.method);
}

/**
 * A person's contact methods in one list; unlike mobile's, a row opens
 * nothing, as the link actions are built for a handset.
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
