'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Frontier } = require('../src/frontier');

describe('Frontier', () => {
  it('dedupes equivalent URLs', () => {
    const f = new Frontier();
    assert.ok(f.enqueue('HTTP://EXAMPLE.COM/a/'));
    assert.equal(f.enqueue('http://example.com/a'), null); // same after normalization
    assert.equal(f.enqueue('http://example.com/a#x'), null);
    assert.equal(f.size(), 1);
  });

  it('enforces maxDepth', () => {
    const f = new Frontier({ maxDepth: 1 });
    assert.ok(f.enqueue('http://example.com/a', 1));
    assert.equal(f.enqueue('http://example.com/b', 2), null);
  });

  it('enforces maxPages', () => {
    const f = new Frontier({ maxPages: 2 });
    assert.ok(f.enqueue('http://example.com/1'));
    assert.ok(f.enqueue('http://example.com/2'));
    assert.equal(f.enqueue('http://example.com/3'), null);
  });

  it('round-robins across hosts instead of draining one', () => {
    const f = new Frontier();
    f.enqueue('http://a.com/1');
    f.enqueue('http://a.com/2');
    f.enqueue('http://b.com/1');
    const hosts = [f.dequeue(), f.dequeue(), f.dequeue()].map((i) => new URL(i.url).hostname);
    assert.deepEqual(hosts, ['a.com', 'b.com', 'a.com']);
    assert.ok(f.isEmpty());
  });

  it('returns null when empty', () => {
    const f = new Frontier();
    assert.equal(f.dequeue(), null);
    assert.ok(f.isEmpty());
  });

  it('rejects invalid URLs', () => {
    const f = new Frontier();
    assert.equal(f.enqueue('not a url'), null);
    assert.equal(f.size(), 0);
  });
});
