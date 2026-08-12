/**
 * What a route hands back: a status, headers, and a body.
 *
 * Routes deliberately do not touch `ServerResponse`. Keeping them to plain data
 * is what lets `app.tsx` own the two things every response needs — the
 * `private, no-store` header §9.2 asks for, and the request-scoped zeroize —
 * without each route having to remember either.
 */
export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export function html(body: string, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  };
}

export function text(status: number, body: string): Reply {
  return {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
  };
}

/**
 * A **303**, not a 302: after a POST it is the status that tells the browser to
 * re-issue as a GET. Increment 3's write path depends on that being right, and
 * getting it wrong is invisible until a form resubmits on refresh.
 */
export function redirect(
  location: string,
  headers: Record<string, string> = {},
): Reply {
  return { status: 303, headers: { location, ...headers }, body: "" };
}
