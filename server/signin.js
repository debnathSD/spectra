/**
 * Builds the URL that signs in and then lands on `pageUrl`.
 *
 * `template` is the app's login URL with a `{url}` placeholder for the page to
 * return to, e.g. `http://localhost:3000/login/?redirect={url}`.
`{url}` becomes the URL-encoded path + query of the page (relative, which is
 * what login redirects usually accept). The template must not contain secrets:
 * it is remembered in the browser's localStorage.
 */
export function buildSignInUrl(template, pageUrl) {
  if (!template) return null;
  const u = new URL(pageUrl);
  const relative = `${u.pathname}${u.search}${u.hash}`;
  return template.includes('{url}')
    ? template.replaceAll('{url}', encodeURIComponent(relative))
    : template;
}

/** True when the document we ended up on is a failed load or a login screen. */
export function looksSignedOut(navigation, finalUrl) {
  if (navigation && navigation.status >= 400) return true;
  try {
    return /^\/(?:login|auth)\b/i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}
