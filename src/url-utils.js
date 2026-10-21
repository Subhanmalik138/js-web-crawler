'use strict';

/**
 * URL canonicalization utilities.
 *
 * Crawlers must compare URLs by identity, not by string. Two strings like
 * `HTTP://EXAMPLE.COM/a/` and `http://example.com/a?b=2&a=1#frag` point at
 * the same resource; without normalization the frontier would crawl it twice.
 */

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

/**
 * Normalize a URL into a canonical string used as the dedupe key.
 * - lowercases scheme + host
 * - drops default ports
 * - resolves dot-segments (via the URL parser)
 * - removes fragments
 * - drops a redundant trailing slash except for the root path
 * - sorts query parameters so ordering differences don't duplicate
 * Returns null when the input isn't an absolute http(s) URL.
 */
function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.port === DEFAULT_PORTS[url.protocol]) url.port = '';

  url.hash = '';

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  if (url.search) {
    const params = [...url.searchParams.entries()].sort(([a, ka], [b, kb]) =>
      a === b ? (ka < kb ? -1 : ka > kb ? 1 : 0) : a < b ? -1 : 1
    );
    url.search = '';
    for (const [k, v] of params) url.searchParams.append(k, v);
  }

  return url.toString();
}

/** True for absolute http(s) URLs only. */
function isHttpUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resolve a possibly-relative href against a base URL, then normalize. */
function resolveLink(href, base) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return null;
  }
  try {
    return normalizeUrl(new URL(href, base).toString());
  } catch {
    return null;
  }
}

/** Host key used for per-host politeness (host + effective port). */
function hostKey(raw) {
  const url = new URL(raw);
  const port = url.port || DEFAULT_PORTS[url.protocol] || '';
  return `${url.hostname.toLowerCase()}${port ? ':' + port : ''}`;
}

module.exports = { normalizeUrl, isHttpUrl, resolveLink, hostKey };
