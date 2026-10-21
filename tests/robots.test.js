'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseRobots, RobotsCache } = require('../src/robots');

describe('parseRobots', () => {
  it('disallows matching prefixes', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private\n');
    assert.equal(r.isAllowed('/public'), true);
    assert.equal(r.isAllowed('/private/page'), false);
  });

  it('gives the longest match precedence, allow winning ties', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\n');
    assert.equal(r.isAllowed('/a/other'), false);
    assert.equal(r.isAllowed('/a/b/c'), true);
  });

  it('treats a bare Disallow: as allow-all', () => {
    const r = parseRobots('User-agent: *\nDisallow:\n');
    assert.equal(r.isAllowed('/anything'), true);
  });

  it('parses crawl-delay', () => {
    const r = parseRobots('User-agent: *\nCrawl-delay: 5\nDisallow: /x\n');
    assert.equal(r.crawlDelay, 5);
  });

  it('prefers the most specific user-agent group', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /a\n\nUser-agent: js-web-crawler\nDisallow: /b\n',
      'js-web-crawler/1.0'
    );
    assert.equal(r.isAllowed('/a'), true);
    assert.equal(r.isAllowed('/b'), false);
  });

  it('ignores comments and blank lines', () => {
    const r = parseRobots('# comment\n\nUser-agent: * # inline\nDisallow: /x # nope\n');
    assert.equal(r.isAllowed('/x'), false);
    assert.equal(r.isAllowed('/y'), true);
  });
});

describe('RobotsCache', () => {
  it('caches rules per origin and fails open on fetch errors', async () => {
    let calls = 0;
    const stubFetch = async () => {
      calls++;
      return { ok: true, text: async () => 'User-agent: *\nDisallow: /secret\n' };
    };
    const cache = new RobotsCache({ fetchImpl: stubFetch });
    assert.equal(await cache.isAllowed('http://h.com/secret/x'), false);
    assert.equal(await cache.isAllowed('http://h.com/open'), true);
    assert.equal(await cache.isAllowed('http://h.com/secret/y'), false);
    assert.equal(calls, 1); // fetched once, then cached
  });

  it('fails open when robots.txt is missing', async () => {
    const stubFetch = async () => ({ ok: false, status: 404 });
    const cache = new RobotsCache({ fetchImpl: stubFetch });
    assert.equal(await cache.isAllowed('http://h.com/anything'), true);
  });
});
