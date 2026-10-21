'use strict';

/**
 * robots.txt compliance.
 *
 * A polite crawler checks robots.txt before touching a host. This module
 * fetches and parses the file once per host, caches the rules, and answers
 * `isAllowed(url)`. It understands:
 *   - User-agent groups (with `*` fallback, longest-prefix agent matching)
 *   - Disallow / Allow with longest-match-wins precedence
 *   - Crawl-delay (seconds) exposed to the engine for per-host politeness
 *
 * Fail-open behavior: if robots.txt is unreachable (404, timeout, non-2xx),
 * crawling is allowed — a missing file is not a prohibition. A 5xx when
 * fetching robots.txt also fails open, matching what most crawlers do, but
 * the engine still backs off via its own politeness delay.
 */

const DEFAULT_UA = 'js-web-crawler/1.0';

class RobotsRules {
  constructor({ disallows = [], allows = [], crawlDelay = 0 } = {}) {
    this.disallows = disallows; // longest-first
    this.allows = allows; // longest-first
    this.crawlDelay = crawlDelay;
  }

  static empty() {
    return new RobotsRules();
  }

  isAllowed(path) {
    let bestDisallow = -1;
    let bestAllow = -1;
    for (const d of this.disallows) {
      if (path.startsWith(d) && d.length > bestDisallow) bestDisallow = d.length;
    }
    for (const a of this.allows) {
      if (path.startsWith(a) && a.length > bestAllow) bestAllow = a.length;
    }
    // Longest match wins; an Allow wins ties. No disallows → allowed.
    return bestAllow >= bestDisallow;
  }
}

/** Parse robots.txt text for one user-agent into RobotsRules. */
function parseRobots(text, userAgent = DEFAULT_UA) {
  const ua = userAgent.toLowerCase().split('/')[0];
  const groups = []; // { agents: [names], disallows: [], allows: [], crawlDelay }
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      const name = value.toLowerCase();
      // A new User-agent line after rules started begins a new group.
      if (current && (current.disallows.length || current.allows.length || current.crawlDelay)) {
        current = null;
      }
      if (!current) {
        current = { agents: [], disallows: [], allows: [], crawlDelay: 0 };
        groups.push(current);
      }
      current.agents.push(name);
    } else if (current) {
      // A bare "Disallow:" (empty value) means "disallow nothing" — drop it.
      if (field === 'disallow') {
        if (value) current.disallows.push(value);
      } else if (field === 'allow') current.allows.push(value);
      else if (field === 'crawl-delay') {
        const secs = Number(value);
        if (Number.isFinite(secs) && secs > 0) current.crawlDelay = secs;
      }
    }
  }

  // Pick the group with the most specific matching agent; '*' is the fallback.
  let picked = null;
  for (const g of groups) {
    if (g.agents.includes(ua) || g.agents.some((a) => ua.startsWith(a) && a !== '*')) {
      picked = g;
      break;
    }
  }
  if (!picked) picked = groups.find((g) => g.agents.includes('*'));

  if (!picked) return RobotsRules.empty();
  const byLen = (a, b) => b.length - a.length;
  return new RobotsRules({
    disallows: [...picked.disallows].sort(byLen),
    allows: [...picked.allows].sort(byLen),
    crawlDelay: picked.crawlDelay,
  });
}

class RobotsCache {
  constructor({ userAgent = DEFAULT_UA, timeoutMs = 8000, fetchImpl = fetch } = {}) {
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = new Map(); // origin -> RobotsRules
  }

  async rulesFor(origin) {
    if (this.cache.has(origin)) return this.cache.get(origin);
    const rules = await this._fetch(origin);
    this.cache.set(origin, rules);
    return rules;
  }

  async isAllowed(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    const rules = await this.rulesFor(url.origin);
    const path = url.pathname + url.search;
    return rules.isAllowed(path);
  }

  crawlDelayFor(origin) {
    const rules = this.cache.get(origin);
    return rules ? rules.crawlDelay : 0;
  }

  async _fetch(origin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'user-agent': this.userAgent },
        signal: controller.signal,
      });
      if (!res.ok) return RobotsRules.empty(); // fail open
      const text = await res.text();
      return parseRobots(text, this.userAgent);
    } catch {
      return RobotsRules.empty(); // fail open
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { RobotsCache, RobotsRules, parseRobots, DEFAULT_UA };
