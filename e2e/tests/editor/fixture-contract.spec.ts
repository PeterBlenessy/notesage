/**
 * Red test: validates the two-layer fixture contract.
 *
 * These tests import the new fixture that doesn't exist yet — they must fail
 * (red) before implementation and pass (green) after.
 *
 * Each test covers one acceptance criterion from issue #141.
 */
import { test, expect } from '@playwright/test';
import { tauriTest } from '../../fixtures';

/**
 * AC: e2e/fixtures/ exports a two-layer fixture consumed via Playwright
 * test.extend() — specs no longer call setupTauriMock() directly.
 */
test('fixture module exports tauriTest via test.extend', async () => {
  // tauriTest must be a Playwright Test object (not undefined)
  expect(tauriTest).toBeDefined();
  // It must expose .extend() — meaning it IS a Playwright test object
  expect(typeof tauriTest.extend).toBe('function');
});

/**
 * AC: waitForAppReady is exposed by the fixture and is a function.
 */
tauriTest('waitForAppReady is available as a fixture', async ({ waitForAppReady }) => {
  expect(typeof waitForAppReady).toBe('function');
});

/**
 * AC: Per-test temporary directories are created via mkdtemp and provided
 * as a fixture value, and cleaned up after each test.
 */
tauriTest('workspace fixture provides a real tmpdir path', async ({ workspaceDir }) => {
  // workspaceDir must be a non-empty string
  expect(typeof workspaceDir).toBe('string');
  expect(workspaceDir.length).toBeGreaterThan(0);
  // Must be an absolute path (starts with /)
  expect(workspaceDir.startsWith('/')).toBe(true);
});
