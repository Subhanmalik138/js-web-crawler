'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, isHttpUrl, resolveLink, hostKey } = require('../src/url-utils');

describe('normalizeUrl', () => {
  it('lowercases scheme and host', () => {
    assert.equal(normalizeUrl('HTTP://EXAMPLE.COM/Path'), 'http://example.com/Path');
  });

  it('drops default ports', () => {
    assert.equal(normalizeUrl('http://example.com:80/a'), 'http://example.com/a');
    assert.equal(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
    assert.equal(normalizeUrl('http://example.com:8080/a'), 'http://example.com:8080/a');
  });

  it('strips fragments and redundant trailing slashes', () => {
    assert.equal(normalizeUrl('http://example.com/a/#frag'), 'http://example.com/a');
    assert.equal(normalizeUrl('http://example.com/a/'), 'http://example.com/a');
    assert.equal(normalizeUrl('http://example.com/'), 'http://example.com/');
  });

  it('sorts query params so ordering cannot duplicate', () => {
    assert.equal(
      normalizeUrl('http://example.com/?b=2&a=1'),
      normalizeUrl('http://example.com/?a=1&b=2')
    );
  });

  it('rejects non-http(s) and invalid URLs', () => {
    assert.equal(normalizeUrl('ftp://example.com/x'), null);
    assert.equal(normalizeUrl('not a url'), null);
    assert.equal(normalizeUrl('mailto:a@b.com'), null);
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    assert.equal(isHttpUrl('https://example.com'), true);
    assert.equal(isHttpUrl('http://example.com/x'), true);
    assert.equal(isHttpUrl('javascript:alert(1)'), false);
    assert.equal(isHttpUrl('/relative/path'), false);
  });
});

describe('resolveLink', () => {
  it('resolves relative hrefs against the base', () => {
    assert.equal(resolveLink('/about', 'http://example.com/a/b'), 'http://example.com/about');
    assert.equal(resolveLink('c', 'http://example.com/a/b'), 'http://example.com/a/c');
  });

  it('drops non-crawlable schemes', () => {
    assert.equal(resolveLink('mailto:a@b.com', 'http://example.com/'), null);
    assert.equal(resolveLink('javascript:void(0)', 'http://example.com/'), null);
    assert.equal(resolveLink('#section', 'http://example.com/'), null);
  });
});

describe('hostKey', () => {
  it('includes non-default ports', () => {
    assert.equal(hostKey('http://example.com:8080/a'), 'example.com:8080');
    assert.equal(hostKey('https://example.com/a'), 'example.com');
  });
});
