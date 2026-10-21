'use strict';

const { Frontier } = require('./frontier');
const { normalizeUrl, isHttpUrl, resolveLink, hostKey } = require('./url-utils');

module.exports = {
  Frontier,
  normalizeUrl,
  isHttpUrl,
  resolveLink,
  hostKey,
};
