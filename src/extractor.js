'use strict';

const { createHash } = require('crypto');
const { resolveLink } = require('./url-utils');

/**
 * Content extraction: links and identity.
 *
 * extractLinks pulls every crawlable href/srcset-style link out of an HTML
 * document with a single pass. A full HTML parser would be more correct for
 * pathological markup, but a crawler processes thousands of pages — a
 * well-scoped regex over href/src attributes is the standard speed/accuracy
 * trade-off and covers <a>, <link>, <img>, <script> and friends.
 *
 * pageHash fingerprints a page body (SHA-256) so the engine can skip
 * duplicate content served under different URLs (printer pages, session
 * IDs, mirror paths).
 */

const LINK_RE = /<(?:a|area|link)\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRC_RE = /<(?:img|script|iframe|source|video|audio|embed|track)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function collectHrefs(html) {
  const hrefs = [];
  for (const re of [LINK_RE, SRC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (href) hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Extract normalized, in-scope links from an HTML page.
 * `options.sameHostOnly` restricts results to the page's origin.
 */
function extractLinks(html, baseUrl, options = {}) {
  const { sameHostOnly = false } = options;
  let baseOrigin = null;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const out = new Set();
  for (const href of collectHrefs(html)) {
    const url = resolveLink(href, baseUrl);
    if (!url) continue;
    if (sameHostOnly) {
      try {
        if (new URL(url).origin !== baseOrigin) continue;
      } catch {
        continue;
      }
    }
    out.add(url);
  }
  return [...out];
}

/** SHA-256 hex digest of a page body (string or Buffer). */
function pageHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

module.exports = { extractLinks, pageHash };
