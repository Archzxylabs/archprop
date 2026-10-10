/**
 * Slug generation for property URLs.
 *
 * The `properties.slug` column is `not null unique` and constrained to
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The route derives it server-side from the
 * property name rather than accepting a client-supplied value, so a caller
 * cannot squat a URL that is not theirs or inject characters the constraint
 * would reject.
 *
 * Uniqueness is not guaranteed by derivation: two properties may legitimately
 * share a name, and two different names may collapse to the same slug once
 * non-alphanumerics are stripped. The insert is therefore retried with a
 * numeric suffix, and the unique-violation path in the route remains the
 * final authority on a collision with an unrelated row.
 */

/** Longest slug the derivation can emit before a suffix is appended. */
const MAX_SLUG_LENGTH = 80;

/**
 * Derives a URL-safe slug from a display name.
 *
 * Accented and non-Latin characters are removed rather than transliterated,
 * because a wrong transliteration would silently produce a misleading URL.
 * Runs of separators collapse, and the result is trimmed of leading and
 * trailing dashes so the constraint's `[a-z0-9]+(?:-[a-z0-9]+)*` shape holds.
 */
export function deriveSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "Cafe" instead of "Caf".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base === "") {
    // A name with no usable ASCII alphanumerics still needs a valid slug.
    // `deriveSlugWithSuffix` never appends a suffix when the base is empty,
    // so a fixed non-empty fallback keeps the constraint satisfiable.
    return "property";
  }
  return base.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}

/**
 * Appends a numeric disambiguator to a base slug.
 *
 * The suffix is `-2`, `-3`, … (not `-1`) so the unsuffixed form stays reserved
 * for the first property to claim the name, and the result still matches the
 * constraint.
 */
export function deriveSlugWithSuffix(name: string, attempt: number): string {
  const base = deriveSlug(name);
  if (attempt <= 1) {
    return base;
  }
  const suffix = `-${attempt}`;
  // Truncate the base first so the final slug never exceeds the column's
  // practical length once the suffix is attached.
  return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
