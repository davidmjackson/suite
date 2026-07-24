// index.js
const express = require('express');
const path = require('node:path');
const { createAuthClient: _create } = require('./lib/factory.js');

function createAuthClient(options) {
  const c = _create(options);
  c.staticAssets = express.static(path.join(__dirname, 'public'));
  return c;
}

module.exports = { createAuthClient };
