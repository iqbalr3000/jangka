/** Same protocols as the link extension; a bare domain gets https. */
export function normalizeHref(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  // "example.com:8080" has no scheme; "ftp://…" and "mailto:…" do.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^mailto:/i.test(value);
  const withProtocol = hasScheme ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
