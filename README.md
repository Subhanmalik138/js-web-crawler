# js-web-crawler

A concurrent, polite web crawler with a CLI — zero dependencies.

Point it at a site and it crawls pages breadth-first, respects `robots.txt`, throttles itself per host, and hands you a JSON report of broken links (with the pages that link to them), slow pages, and per-host stats — plus a `sitemap.xml` of everything it successfully crawled. Exit code is non-zero when broken links are found, so it doubles as a CI link-checker.

## Why this exists

Most crawler tutorials stop at "fetch links recursively." A crawler you can actually point at a real site needs four things those tutorials skip: canonical URL dedupe (so `HTTP://x/a/` and `http://x/a?b=2&a=1#frag` don't get crawled twice), `robots.txt` compliance, per-host politeness, and a termination story for the worker pool when links keep arriving while workers are mid-flight. This project implements all four, with tests.

## Design decisions

1. **Zero dependencies.** Node 18+ ships `fetch`, `crypto`, and a built-in test runner — enough for a crawler. No install step, no supply-chain surface, and `npm test` works on a fresh checkout.
2. **Per-host round-robin frontier.** The frontier buckets URLs by host and rotates, so a crawl across several domains interleaves requests instead of hammering one server. Global dedupe happens on normalized URLs before anything is queued.
3. **Fixed worker pool, not unbounded promises.** N workers loop over the frontier; a worker only stops when the queue is empty *and* no other worker is in flight — otherwise late-discovered links would be silently dropped.
4. **Fail-open robots.txt.** A missing or unreachable `robots.txt` means "crawl allowed" (a missing file isn't a prohibition). Parsing honors `Disallow`/`Allow` with longest-match-wins, per-agent groups, and `Crawl-delay`, which overrides the default politeness gap when larger.
5. **Content-hash dedupe.** Pages are fingerprinted with SHA-256, so mirror URLs serving identical bodies (print views, session-ID URLs) are recorded once as duplicates instead of bloating the crawl.

## Usage

```bash
# crawl up to 200 pages, 2 deep, 5 parallel workers
node cli/crawl.js https://example.com --depth 2 --pages 200

# also write sitemap.xml; follow links to other hosts
node cli/crawl.js https://example.com --sitemap --external

# tighter politeness for a small server
node cli/crawl.js https://example.com --delay 2000 --concurrency 2
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | 2 | max link depth from the seeds |
| `--pages N` | 200 | max pages to crawl |
| `--concurrency N` | 5 | parallel workers |
| `--delay MS` | 1000 | min gap between requests to the same host (`robots.txt` `Crawl-delay` wins when larger) |
| `--timeout MS` | 15000 | per-request timeout |
| `--external` | off | follow links off the seed host(s) |
| `--output FILE` | `crawl-report.json` | where the JSON report goes |
| `--sitemap` | off | also write `sitemap.xml` |

The JSON report contains page totals by status, the broken-link list with referrers, the 10 slowest pages, and per-host counts. Exit code is `1` when broken links were found, `2` on usage errors.

As a library:

```js
const { Crawler, buildReport } = require('js-web-crawler');

const crawler = new Crawler({ maxDepth: 2, concurrency: 4, politenessMs: 500 });
const pages = await crawler.crawl(['https://example.com']);
const report = buildReport(crawler, Date.now());
```

## Running tests

```bash
npm test
```

31 tests, all with the built-in `node:test` runner — no test framework to install. The crawler suite spins up a local HTTP fixture site, so it covers robots.txt skipping, broken-link detection, duplicate-content dedupe, referrer tracking, and the page budget without touching the network.

## Project structure

```
src/
  crawler.js     worker-pool engine, politeness, fetch limits
  frontier.js    BFS queue: normalized-URL dedupe, per-host round-robin
  robots.js      robots.txt fetch/parse/cache
  extractor.js   link extraction, SHA-256 page fingerprinting
  reporter.js    JSON report builder, sitemap.xml writer
  url-utils.js   URL canonicalization
  index.js       public API
cli/crawl.js     CLI
tests/           node:test suites
```

## Tech stack

- JavaScript (Node.js ≥ 18), CommonJS
- No runtime dependencies; built-in `fetch`, `crypto`, `node:test`

## License

MIT — see [LICENSE](LICENSE).
