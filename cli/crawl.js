#!/usr/bin/env node
'use strict';

/**
 * web-crawler CLI
 *
 *   node bin/crawl.js https://example.com --depth 2 --pages 200 \
 *       --concurrency 5 --delay 1000 --output report.json --sitemap
 *
 * Exits non-zero when broken links were found, so it can gate CI.
 */

const { writeFileSync } = require('fs');
const { Crawler } = require('../src/crawler');
const { buildReport, writeSitemap } = require('../src/reporter');

function parseArgs(argv) {
  const opts = {
    depth: 2,
    pages: 200,
    concurrency: 5,
    delay: 1000,
    timeout: 15000,
    sameHost: true,
    output: 'crawl-report.json',
    sitemap: false,
    seeds: [],
  };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    const num = (name) => {
      const v = Number(rest.shift());
      if (!Number.isFinite(v) || v < 0) {
        console.error(`error: --${name} needs a non-negative number`);
        process.exit(2);
      }
      return v;
    };
    switch (arg) {
      case '--depth': opts.depth = num('depth'); break;
      case '--pages': opts.pages = num('pages'); break;
      case '--concurrency': opts.concurrency = Math.max(1, Math.floor(num('concurrency'))); break;
      case '--delay': opts.delay = num('delay'); break;
      case '--timeout': opts.timeout = num('timeout'); break;
      case '--output': opts.output = rest.shift() || opts.output; break;
      case '--sitemap': opts.sitemap = true; break;
      case '--external': opts.sameHost = false; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`error: unknown flag ${arg}`);
          process.exit(2);
        }
        opts.seeds.push(arg);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: web-crawler <url...> [options]

Options:
  --depth N         max link depth from seeds (default 2)
  --pages N         max pages to crawl (default 200)
  --concurrency N   parallel workers (default 5)
  --delay MS        min ms between requests to the same host (default 1000;
                    robots.txt Crawl-delay wins when larger)
  --timeout MS      per-request timeout (default 15000)
  --external        follow links to other hosts (default: same host only)
  --output FILE     JSON report path (default crawl-report.json)
  --sitemap         also write sitemap.xml of crawled pages
  --help            show this help

Exit code is 1 when broken links were found.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.seeds.length === 0) {
    console.error('error: at least one seed URL is required');
    printHelp();
    process.exit(2);
  }

  const startedAt = Date.now();
  const crawler = new Crawler({
    maxDepth: opts.depth,
    maxPages: opts.pages,
    concurrency: opts.concurrency,
    politenessMs: opts.delay,
    timeoutMs: opts.timeout,
    sameHostOnly: opts.sameHost,
    onPage: (p) => {
      const mark = p.status === 'ok' ? '✓' : p.status === 'broken' ? `✗ ${p.httpStatus}` : `(${p.status})`;
      console.log(`${mark} ${p.url}`);
    },
  });

  const pages = await crawler.crawl(opts.seeds);
  const report = buildReport(crawler, startedAt);
  writeFileSync(opts.output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\ncrawled ${pages.length} pages in ${report.durationMs}ms → ${opts.output}`);

  if (opts.sitemap) {
    writeSitemap(pages, 'sitemap.xml');
    console.log('wrote sitemap.xml');
  }

  if (report.brokenLinks.length > 0) {
    console.log(`found ${report.brokenLinks.length} broken link(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err.message || err);
  process.exit(2);
});
