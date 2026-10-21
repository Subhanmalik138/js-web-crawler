'use strict';

const { Frontier } = require('./frontier');
const { RobotsCache } = require('./robots');
const { extractLinks, pageHash } = require('./extractor');
const { hostKey } = require('./url-utils');

/**
 * The crawl engine: N workers pull URLs from the frontier and fetch them.
 *
 * Concurrency model — a fixed worker pool instead of unbounded promises.
 * Each worker loops: take a URL, enforce politeness, fetch, record, enqueue
 * discovered links. The pool drains when the frontier empties AND no worker
 * is in flight (new links may arrive while others fetch).
 *
 * Politeness — every host gets a minimum gap between requests:
 * `max(defaultDelayMs, robots Crawl-delay)`. The engine tracks the last
 * request timestamp per host and sleeps the difference before fetching.
 *
 * Safety rails — per-request timeout, a cap on response body size (a crawler
 * must never buffer a 2 GB "page" into memory), and content-hash dedupe so
 * mirror URLs don't bloat the report.
 */
class Crawler {
  constructor(options = {}) {
    const {
      maxDepth = 3,
      maxPages = 500,
      concurrency = 5,
      politenessMs = 1000,
      timeoutMs = 15000,
      maxBodyBytes = 5 * 1024 * 1024,
      sameHostOnly = true,
      userAgent = 'js-web-crawler/1.0',
      fetchImpl = fetch,
      onPage = null, // optional hook: (page) => void
    } = options;

    if (concurrency < 1) throw new Error('concurrency must be >= 1');

    this.opts = { maxDepth, maxPages, concurrency, politenessMs, timeoutMs, maxBodyBytes, sameHostOnly, userAgent, onPage };
    this.fetchImpl = fetchImpl;
    this.frontier = new Frontier({ maxDepth, maxPages });
    this.robots = new RobotsCache({ userAgent, fetchImpl });
    this.lastRequestAt = new Map(); // hostKey -> timestamp ms
    this.contentHashes = new Set();
    this.pages = []; // crawl results in completion order
    this.stats = { fetched: 0, skippedRobots: 0, duplicateContent: 0, errors: 0 };
    this._inFlight = 0;
  }

  async crawl(seedUrls) {
    const seeds = Array.isArray(seedUrls) ? seedUrls : [seedUrls];
    for (const seed of seeds) this.frontier.enqueue(seed, 0);

    const workers = [];
    for (let i = 0; i < this.opts.concurrency; i++) {
      workers.push(this._worker());
    }
    await Promise.all(workers);
    return this.pages;
  }

  async _worker() {
    for (;;) {
      const item = this.frontier.dequeue();
      if (!item) {
        // A null dequeue isn't enough to stop: other workers may still be
        // fetching pages whose links will refill the frontier.
        if (this._inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      this._inFlight++;
      try {
        await this._process(item);
      } finally {
        this._inFlight--;
      }
    }
  }

  async _process({ url, depth }) {
    // robots.txt gate
    let allowed;
    try {
      allowed = await this.robots.isAllowed(url);
    } catch {
      allowed = true; // fail open
    }
    if (!allowed) {
      this.stats.skippedRobots++;
      this._record({ url, depth, status: 'skipped', reason: 'robots.txt disallow' });
      return;
    }

    await this._enforcePoliteness(url);

    let res;
    const startedAt = Date.now();
    try {
      res = await this._fetchWithLimits(url);
    } catch (err) {
      this.stats.errors++;
      this._record({ url, depth, status: 'error', reason: String(err.message || err), ms: Date.now() - startedAt });
      return;
    }

    const page = {
      url,
      depth,
      status: 'ok',
      httpStatus: res.status,
      ms: Date.now() - startedAt,
      bytes: res.bytes,
      contentType: res.contentType,
      links: [],
    };

    this.stats.fetched++;

    if (res.status >= 400) {
      page.status = 'broken';
      this._record(page);
      return;
    }

    const isHtml = (res.contentType || '').includes('text/html');
    if (isHtml && res.body) {
      const hash = pageHash(res.body);
      if (this.contentHashes.has(hash)) {
        page.status = 'duplicate';
        this.stats.duplicateContent++;
        this._record(page);
        return;
      }
      this.contentHashes.add(hash);

      const links = extractLinks(res.body, url, { sameHostOnly: this.opts.sameHostOnly });
      page.links = links;
      for (const link of links) this.frontier.enqueue(link, depth + 1);
    }

    this._record(page);
  }

  _record(page) {
    this.pages.push(page);
    if (typeof this.opts.onPage === 'function') {
      try {
        this.opts.onPage(page);
      } catch {
        /* hooks must never break the crawl */
      }
    }
  }

  async _enforcePoliteness(url) {
    const host = hostKey(url);
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }
    const robotDelay = (this.robots.crawlDelayFor(origin) || 0) * 1000;
    const gap = Math.max(this.opts.politenessMs, robotDelay);
    const last = this.lastRequestAt.get(host) || 0;
    const wait = gap - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt.set(host, Date.now());
  }

  async _fetchWithLimits(url) {
    const { timeoutMs, maxBodyBytes, userAgent } = this.opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,*/*' },
        signal: controller.signal,
        redirect: 'follow',
      });
      const contentType = res.headers.get('content-type') || '';
      const reader = res.body.getReader();
      const chunks = [];
      let bytes = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBodyBytes) {
          truncated = true;
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        chunks.push(value);
      }
      const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
      return { status: res.status, contentType, bytes, body, truncated };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { Crawler };
