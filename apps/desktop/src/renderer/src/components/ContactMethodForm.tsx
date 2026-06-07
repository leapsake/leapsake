import {
  type ContactMethodKind,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  contactCountryOptions,
  countryFlag,
  emailLabelSuggestions,
  phoneLabelSuggestions,
  postalLabelSuggestions,
} from "@leapsake/schema";
import { Form, Link, useNavigation } from "react-router-dom";

/** A stored method being edited; absent when adding. */
type ExistingMethod = EmailAddress | PhoneNumber | PostalAddress;

/** The suggested labels per kind, offered as datalist hints (never a constraint). */
const LABEL_SUGGESTIONS: Record<ContactMethodKind, readonly string[]> = {
  email: emailLabelSuggestions,
  phone: phoneLabelSuggestions,
  postal: postalLabelSuggestions,
};

/**
 * The country picker shared by the phone and postal fields: a select over the
 * short {@link contactCountryOptions} list plus an empty "unset" option. A stored
 * country outside the list (e.g. from before it was narrowed) is appended so
 * editing keeps it rather than silently dropping it.
 */
function CountrySelect({ current }: { current: string | null }) {
  const known = contactCountryOptions.some((c) => c.code === current);
  return (
    <label>
      Country{" "}
      <select name="country" defaultValue={current ?? ""}>
        <option value="">—</option>
        {contactCountryOptions.map((c) => (
          <option key={c.code} value={c.code}>
            {countryFlag(c.code)} {c.name}
          </option>
        ))}
        {current && !known && (
          <option value={current}>
            {countryFlag(current)} {current}
          </option>
        )}
      </select>
    </label>
  );
}

const KIND_NOUN: Record<ContactMethodKind, string> = {
  email: "email",
  phone: "phone",
  postal: "address",
};

/**
 * Add/edit form for one contact method, rendered on a Person's page. The visible
 * fields depend on `kind`: an email is one address; a phone adds extension +
 * country + an SMS-capable checkbox; a postal address is the structured
 * line1/line2/locality/region/postal code/country set. The label is a free-text
 * input with per-kind datalist suggestions — pick one or type anything. When
 * `method` is provided the form pre-fills from it (edit mode); the route action
 * consumes the field `name`s and supplies the owner.
 */
export function ContactMethodForm({
  kind,
  method,
  cancelTo,
}: {
  kind: ContactMethodKind;
  method?: ExistingMethod;
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const editing = method !== undefined;

  const email =
    kind === "email" ? (method as EmailAddress | undefined) : undefined;
  const phone =
    kind === "phone" ? (method as PhoneNumber | undefined) : undefined;
  const postal =
    kind === "postal" ? (method as PostalAddress | undefined) : undefined;

  const labelListId = `${kind}-label-suggestions`;

  return (
    <Form method="post">
      <header>
        <h1>
          {editing ? "Edit" : "Add"} {KIND_NOUN[kind]}
        </h1>
        <button type="submit" disabled={submitting}>
          {editing ? "Save" : "Add"}
        </button>{" "}
        <Link to={cancelTo}>Cancel</Link>
      </header>

      <fieldset disabled={submitting}>
        <label>
          Label{" "}
          <input
            name="label"
            list={labelListId}
            defaultValue={method?.label ?? LABEL_SUGGESTIONS[kind][0]}
            placeholder="e.g. Home"
            required
          />
        </label>
        <datalist id={labelListId}>
          {LABEL_SUGGESTIONS[kind].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>{" "}
        {kind === "email" && (
          <p>
            <label>
              Email{" "}
              <input
                type="email"
                name="address"
                defaultValue={email?.address ?? ""}
                required
              />
            </label>
          </p>
        )}
        {kind === "phone" && (
          <p>
            <label>
              Number{" "}
              <input
                name="number"
                defaultValue={phone?.number ?? ""}
                required
              />
            </label>{" "}
            <label>
              Extension{" "}
              <input
                name="extension"
                defaultValue={phone?.extension ?? ""}
                placeholder="optional"
              />
            </label>{" "}
            <CountrySelect current={phone?.country ?? null} />{" "}
            <label>
              <input
                type="checkbox"
                name="smsCapable"
                defaultChecked={phone?.smsCapable ?? true}
              />{" "}
              Can receive texts (SMS)
            </label>
          </p>
        )}
        {kind === "postal" && (
          <>
            <p>
              <label>
                Address line 1{" "}
                <input
                  name="line1"
                  defaultValue={postal?.line1 ?? ""}
                  placeholder="Street or PO box"
                  required
                />
              </label>
            </p>
            <p>
              <label>
                Address line 2{" "}
                <input
                  name="line2"
                  defaultValue={postal?.line2 ?? ""}
                  placeholder="Apt / unit / suite"
                />
              </label>
            </p>
            <p>
              <label>
                City / town{" "}
                <input name="locality" defaultValue={postal?.locality ?? ""} />
              </label>{" "}
              <label>
                State / province / county{" "}
                <input name="region" defaultValue={postal?.region ?? ""} />
              </label>
            </p>
            <p>
              <label>
                Postal code{" "}
                <input
                  name="postalCode"
                  defaultValue={postal?.postalCode ?? ""}
                />
              </label>{" "}
              <CountrySelect current={postal?.country ?? null} />
            </p>
          </>
        )}
      </fieldset>
    </Form>
  );
}
