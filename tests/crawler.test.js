'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Crawler } = require('../src/crawler');
const { buildReport } = require('../src/reporter');

/**
 * End-to-end crawl against a local fixture site:
 *
 *   /            links to /a, /b, /missing, /private
 *   /a           links to /b and /dup (same body as /a → duplicate)
 *   /b           plain text, no links
 *   /missing     404
 *   /private     200 but disallowed by robots.txt
 *   /robots.txt  disallows /private
 */

const PAGE_A = '<html><body><a href="/b">b</a><a href="/dup">dup</a></body></html>';

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type });
      res.end(body);
    };
    switch (req.url) {
      case '/robots.txt':
        return send(200, 'text/plain', 'User-agent: *\nDisallow: /private\n');
      case '/':
        return send(200, 'text/html',
          '<html><body><a href="/a">a</a><a href="/b">b</a>' +
          '<a href="/missing">gone</a><a href="/private">priv</a></body></html>');
      case '/a':
      case '/dup':
        return send(200, 'text/html', PAGE_A);
      case '/b':
        return send(200, 'text/plain', 'just text');
      case '/missing':
        return send(404, 'text/plain', 'nope');
      case '/private':
        return send(200, 'text/html', '<html><body>secret</body></html>');
      default:
        return send(404, 'text/plain', 'nope');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('Crawler (fixture site)', () => {
  it('crawls pages, detects broken links, honors robots.txt, dedupes content', async () => {
    const crawler = new Crawler({
      maxDepth: 3,
      maxPages: 50,
      concurrency: 3,
      politenessMs: 0,
      timeoutMs: 5000,
      sameHostOnly: true,
    });
    const pages = await crawler.crawl([`${base}/`]);
    const byUrl = new Map(pages.map((p) => [p.url, p]));

    // robots.txt disallow is skipped, never fetched
    assert.equal(byUrl.get(`${base}/private`).status, 'skipped');
    assert.equal(byUrl.get(`${base}/private`).reason, 'robots.txt disallow');

    // 404 page is flagged broken
    assert.equal(byUrl.get(`${base}/missing`).status, 'broken');
    assert.equal(byUrl.get(`${base}/missing`).httpStatus, 404);

    // identical body under a different URL is a duplicate, not a re-crawl
    const dupes = pages.filter((p) => p.status === 'duplicate');
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].url, `${base}/dup`);

    // non-HTML page is recorded without link extraction
    assert.equal(byUrl.get(`${base}/b`).status, 'ok');
    assert.deepEqual(byUrl.get(`${base}/b`).links, []);

    assert.equal(crawler.stats.skippedRobots, 1);
    assert.equal(crawler.stats.duplicateContent, 1);
  });

  it('builds an actionable broken-link report with referrers', async () => {
    const crawler = new Crawler({ maxDepth: 2, politenessMs: 0, timeoutMs: 5000 });
    await crawler.crawl([`${base}/`]);
    const report = buildReport(crawler, Date.now());

    assert.equal(report.totals.pages, crawler.pages.length);
    assert.equal(report.brokenLinks.length, 1);
    assert.equal(report.brokenLinks[0].url, `${base}/missing`);
    assert.deepEqual(report.brokenLinks[0].referredBy, [`${base}/`]);
    assert.ok(report.slowestPages.length > 0);
    assert.ok(Object.keys(report.pagesPerHost).length === 1);
  });

  it('stays within the page budget', async () => {
    const crawler = new Crawler({ maxDepth: 5, maxPages: 2, politenessMs: 0, timeoutMs: 5000 });
    const pages = await crawler.crawl([`${base}/`]);
    assert.ok(pages.length <= 2);
  });
});
