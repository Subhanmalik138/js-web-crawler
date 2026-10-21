'use strict';

const { writeFileSync } = require('fs');

/**
 * Reporting: turn raw page results into something a human (or CI) can use.
 *
 * buildReport summarizes a crawl: per-status counts, the broken-link list
 * with the pages that linked to them (that's what makes a broken-link
 * report actionable — you need the referrer to fix it), slowest pages, and
 * per-host distribution.
 *
 * writeSitemap emits a standard sitemap.xml of successfully crawled HTML
 * pages — the other classic crawler output, useful for SEO tooling.
 */

function buildReport(crawler, startedAt) {
  const pages = crawler.pages;
  const byStatus = {};
  const referrers = new Map(); // broken url -> Set<referrer url>
  const okPages = [];

  for (const p of pages) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    if (p.status === 'ok') okPages.push(p);
  }

  for (const p of okPages) {
    for (const link of p.links || []) {
      const target = pages.find((q) => q.url === link);
      if (target && target.status === 'broken') {
        if (!referrers.has(link)) referrers.set(link, new Set());
        referrers.get(link).add(p.url);
      }
    }
  }

  const broken = pages
    .filter((p) => p.status === 'broken')
    .map((p) => ({
      url: p.url,
      httpStatus: p.httpStatus,
      referredBy: [...(referrers.get(p.url) || [])],
    }));

  const slowest = [...pages]
    .filter((p) => typeof p.ms === 'number')
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10)
    .map((p) => ({ url: p.url, ms: p.ms }));

  const hosts = {};
  for (const p of pages) {
    try {
      const h = new URL(p.url).hostname;
      hosts[h] = (hosts[h] || 0) + 1;
    } catch {
      /* skip */
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    totals: {
      pages: pages.length,
      ...byStatus,
      skippedRobots: crawler.stats.skippedRobots,
      duplicateContent: crawler.stats.duplicateContent,
      errors: crawler.stats.errors,
    },
    brokenLinks: broken,
    slowestPages: slowest,
    pagesPerHost: hosts,
  };
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Write a sitemap.xml of the successfully crawled pages. Returns the path. */
function writeSitemap(pages, outPath = 'sitemap.xml') {
  const urls = pages
    .filter((p) => p.status === 'ok')
    .map((p) => `  <url>\n    <loc>${escapeXml(p.url)}</loc>\n  </url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  writeFileSync(outPath, xml, 'utf8');
  return outPath;
}

module.exports = { buildReport, writeSitemap };
