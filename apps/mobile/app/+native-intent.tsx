/** The iOS share extension hands a share over at `leapsake://dataUrl=…`, which
 *  is no route, so it lands where the app already is (Home on launch). */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  if (!path.includes("dataUrl=")) return path;
  return initial ? "/" : null;
}
