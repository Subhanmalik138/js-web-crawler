'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractLinks, pageHash } = require('../src/extractor');

describe('extractLinks', () => {
  it('extracts and normalizes links from anchors and media', () => {
    const html = `
      <a href="/about">About</a>
      <a href='http://example.com/B/'>B</a>
      <img src="/img/logo.png">
      <a href="mailto:a@b.com">mail</a>
      <a href="#top">top</a>`;
    const links = extractLinks(html, 'http://example.com/');
    assert.deepEqual(new Set(links), new Set([
      'http://example.com/about',
      'http://example.com/B',
      'http://example.com/img/logo.png',
    ]));
  });

  it('dedupes repeated links', () => {
    const html = '<a href="/x">1</a><a href="/x">2</a>';
    assert.deepEqual(extractLinks(html, 'http://example.com/'), ['http://example.com/x']);
  });

  it('restricts to the same host when asked', () => {
    const html = '<a href="/in">in</a><a href="http://other.com/out">out</a>';
    const links = extractLinks(html, 'http://example.com/', { sameHostOnly: true });
    assert.deepEqual(links, ['http://example.com/in']);
  });

  it('returns [] for an invalid base URL', () => {
    assert.deepEqual(extractLinks('<a href="/x">x</a>', 'not a url'), []);
  });
});

describe('pageHash', () => {
  it('is stable and distinguishes content', () => {
    assert.equal(pageHash('abc'), pageHash('abc'));
    assert.notEqual(pageHash('abc'), pageHash('abd'));
  });
});
