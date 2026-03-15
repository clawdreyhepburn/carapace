/**
 * Vitest wrappers for standalone test scripts.
 * Each script is imported inside a test() block.
 * process.exit(1) is intercepted and turned into a test failure.
 */
import { test, vi, expect } from 'vitest';

// Intercept process.exit — throw on non-zero, no-op on zero
const originalExit = process.exit;
function mockExit(code) {
  if (code && code !== 0) {
    throw new Error(`Test script exited with code ${code}`);
  }
  // For exit(0), just don't actually exit
}

function withMockedExit(fn) {
  return async () => {
    process.exit = mockExit;
    try {
      await fn();
    } finally {
      process.exit = originalExit;
    }
  };
}

test('shell-gate', withMockedExit(async () => {
  await import('./test-shell-gate.mjs');
}), { timeout: 30000 });

test('llm-proxy', withMockedExit(async () => {
  await import('./test-llm-proxy.mjs');
}), { timeout: 30000 });

test('adversarial', withMockedExit(async () => {
  await import('./test-adversarial.mjs');
}), { timeout: 60000 });

test('block-myself', withMockedExit(async () => {
  await import('./test-block-myself.mjs');
}), { timeout: 30000 });

test('cedarling', withMockedExit(async () => {
  await import('./test-cedarling.mjs');
}), { timeout: 30000 });

test('cedarling2', withMockedExit(async () => {
  await import('./test-cedarling2.mjs');
}), { timeout: 30000 });
