import { Form, Link } from "react-router-dom";

const COPY = {
  heading: "Don’t ask again",
  thisYear: "This year",
  ever: "Ever",
  cancel: "Cancel",
};

/** Stops a prompt asking about its occasion: this year, or ever. */
export function MilestoneStopAsking() {
  return (
    <main>
      <h1>{COPY.heading}</h1>
      <Form method="post">
        <button type="submit" name="scope" value="year">
          {COPY.thisYear}
        </button>{" "}
        <button type="submit" name="scope" value="ever">
          {COPY.ever}
        </button>{" "}
        <Link to="/reminders">{COPY.cancel}</Link>
      </Form>
    </main>
  );
}
