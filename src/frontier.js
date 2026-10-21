'use strict';

const { normalizeUrl, hostKey } = require('./url-utils');

/**
 * The crawl frontier: a breadth-first queue with two properties that keep
 * a crawler well-behaved and efficient:
 *
 * 1. Global dedupe — every URL is normalized before entering; the `seen`
 *    set guarantees no URL is ever queued twice, no matter how many pages
 *    link to it.
 * 2. Per-host round-robin — URLs are bucketed by host so the engine can
 *    interleave requests across hosts instead of hammering one server.
 *
 * Depth and page budgets are enforced at enqueue time.
 */
class Frontier {
  constructor({ maxDepth = 3, maxPages = 500 } = {}) {
    this.maxDepth = maxDepth;
    this.maxPages = maxPages;
    this.seen = new Set();
    this.byHost = new Map(); // hostKey -> Array<{url, depth}>
    this.hostOrder = []; // round-robin rotation of host keys
    this.queued = 0;
    this.accepted = 0;
  }

  /**
   * Offer a URL to the frontier. Returns the normalized URL when accepted,
   * or null when rejected (invalid, duplicate, over budget).
   */
  enqueue(raw, depth = 0) {
    if (depth > this.maxDepth) return null;
    const url = normalizeUrl(raw);
    if (!url) return null;
    if (this.seen.has(url)) return null;
    if (this.accepted >= this.maxPages) return null;

    this.seen.add(url);
    this.accepted++;
    const host = hostKey(url);
    if (!this.byHost.has(host)) {
      this.byHost.set(host, []);
      this.hostOrder.push(host);
    }
    this.byHost.get(host).push({ url, depth });
    this.queued++;
    return url;
  }

  /**
   * Dequeue the next URL, rotating across hosts. Returns
   * { url, depth } or null when the frontier is empty.
   */
  dequeue() {
    while (this.hostOrder.length > 0) {
      const host = this.hostOrder.shift();
      const queue = this.byHost.get(host);
      const item = queue.shift();
      if (queue.length > 0) this.hostOrder.push(host); // still work left; rotate
      else this.byHost.delete(host);
      if (item) {
        this.queued--;
        return item;
      }
    }
    return null;
  }

  isEmpty() {
    return this.queued === 0;
  }

  size() {
    return this.queued;
  }
}

module.exports = { Frontier };
