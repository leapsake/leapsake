import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
import { Link } from "react-router-dom";

/** The icon shown beside each contact-method kind. */
const KIND_ICON = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
} as const;

/**
 * Render a method's value: the address; the (extension-suffixed) number, flagged
 * "(no texts)" when it can't receive SMS since texting is otherwise assumed; or
 * the formatted postal address.
 */
function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const { number, extension, smsCapable } = entry.method;
    const withExt = extension ? `${number} ext. ${extension}` : number;
    return smsCapable ? withExt : `${withExt} (no texts)`;
  }
  return formatPostalAddress(entry.method);
}

/**
 * The Contact section on a Person's view: the person's emails, phones, and postal
 * addresses, merged into one list by {@link ContactMethod} and rendered with a
 * per-kind Edit / Remove. The three "Add" links create one kind each. Owner is a
 * Person today; when households ship the same list also surfaces the household's
 * shared methods (the union lives in `listContactMethods`, not here).
 */
export function ContactMethodsSection({
  personId,
  methods,
}: {
  personId: string;
  methods: ContactMethod[];
}) {
  const basePath = `/people/${personId}`;

  return (
    <section>
      <header>
        <h2>Contact</h2>
        <Link to={`${basePath}/contact/email/new`}>Add email</Link>{" "}
        <Link to={`${basePath}/contact/phone/new`}>Add phone</Link>{" "}
        <Link to={`${basePath}/contact/postal/new`}>Add address</Link>
      </header>
      {methods.length === 0 ? (
        <p>No contact methods yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {methods.map((entry) => {
              const { id, label } = entry.method;
              const path = `${basePath}/contact/${entry.kind}/${id}`;
              return (
                <tr key={`${entry.kind}:${id}`}>
                  <td>
                    {KIND_ICON[entry.kind]} {label}
                  </td>
                  <td>{methodValue(entry)}</td>
                  <td>
                    <Link to={`${path}/edit`}>Edit</Link>{" "}
                    <Link to={`${path}/delete`}>Remove</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
