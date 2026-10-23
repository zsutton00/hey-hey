#!/usr/bin/env node
/**
 * Manual verification script for @napi-rs/keyring OS-keychain integration.
 *
 * Run this after `npm install -g @heyhey/cli` on each target platform:
 *
 *   node verify-keyring.mjs
 *
 * Or from the repo (uses the local node_modules):
 *
 *   node scripts/verify-keyring.mjs
 *
 * Expected output: all checks print OK. Any FAIL line means the native
 * binary did not load or keychain access is broken.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SERVICE = 'heyhey-cli-verify';
const ACCOUNT = `verify-test-${process.pid}`;
const VALUE = 'verify-secret-value';

let Entry;
try {
  ({ Entry } = require('@napi-rs/keyring'));
  console.log('OK  @napi-rs/keyring loaded (native binary resolved)');
} catch (err) {
  console.error('FAIL @napi-rs/keyring failed to load:', err.message);
  process.exit(1);
}

const entry = new Entry(SERVICE, ACCOUNT);

// store
try {
  entry.setPassword(VALUE);
  console.log('OK  store (setPassword)');
} catch (err) {
  console.error('FAIL store:', err.message);
  process.exit(1);
}

// retrieve
try {
  const retrieved = entry.getPassword();
  if (retrieved !== VALUE) {
    console.error(`FAIL retrieve: expected "${VALUE}", got "${String(retrieved)}"`);
    process.exit(1);
  }
  console.log('OK  retrieve (getPassword)');
} catch (err) {
  console.error('FAIL retrieve:', err.message);
  process.exit(1);
}

// delete
try {
  entry.deletePassword();
  console.log('OK  delete (deletePassword)');
} catch (err) {
  console.error('FAIL delete:', err.message);
  process.exit(1);
}

// confirm gone
try {
  const afterDelete = entry.getPassword();
  if (afterDelete !== null) {
    console.error(`FAIL post-delete retrieve: expected null, got "${String(afterDelete)}"`);
    process.exit(1);
  }
  console.log('OK  post-delete retrieve returns null');
} catch (err) {
  // Some platforms throw a "no entry" error instead of returning null — that's fine.
  const msg = err.message.toLowerCase();
  if (
    msg.includes('no matching entry') ||
    msg.includes('no entry') ||
    msg.includes('not found') ||
    msg.includes('could not be found')
  ) {
    console.log('OK  post-delete retrieve (no-entry error, treated as absent)');
  } else {
    console.error('FAIL post-delete retrieve threw unexpected error:', err.message);
    process.exit(1);
  }
}

console.log('\nAll keyring checks passed.');
