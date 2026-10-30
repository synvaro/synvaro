const PRIVATE_API_ORIGIN = 'http://api:3001';

export function apiOrigin(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.origin !== PRIVATE_API_ORIGIN)
  ) {
    throw new Error(
      'API_INTERNAL_URL must be an HTTPS, loopback HTTP, or private API origin',
    );
  }
  return url.origin;
}
