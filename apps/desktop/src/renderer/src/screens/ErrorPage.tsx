import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

/** Root error boundary — covers loader/action throws and unmatched routes. */
export function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong.";

  return (
    <main>
      <h1>{message}</h1>
      <p>
        <Link to="/">Back to people</Link>
      </p>
    </main>
  );
}
