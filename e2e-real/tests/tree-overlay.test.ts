/**
 * QuietSidebar Projects section — keyboard navigation E2E tests.
 *
 * These tests drive the real Tauri app under WKWebView/WebKit to catch
 * timing-sensitive focus bugs (e.g., the ArrowUp re-render race in
 * ProjectsSection.tsx) that don't surface in jsdom unit tests.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import { tauriInvoke } from '../helpers/actions';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const TEST_PROJECT = path.join(FIXTURES_DIR, 'test-project');
const PROJECT_NAME = path.basename(TEST_PROJECT); // "test-project"

async function addTestProject(): Promise<void> {
    const root = await browser.$('#root');
    await root.waitForExist({ timeout: 10_000 });

    await browser.waitUntil(
        async () =>
            browser.execute(() =>
                Boolean((window as unknown as Record<string, unknown>).__E2E_WORKSPACE_STORE__),
            ),
        {
            timeout: 10_000,
            timeoutMsg: '__E2E_WORKSPACE_STORE__ not available — app may not be in e2e-testing mode',
            interval: 200,
        },
    );

    const tree = await tauriInvoke<unknown[]>('list_directory', { path: TEST_PROJECT });

    await browser.execute(
        (projectPath: string, fileTree: unknown) => {
            const w = window as unknown as Record<string, { getState: () => Record<string, unknown> }>;
            const state = w.__E2E_WORKSPACE_STORE__.getState();
            (state.addProject as (p: string, t: unknown) => void)(projectPath, fileTree);
        },
        TEST_PROJECT,
        tree,
    );

    await browser.waitUntil(
        async () => {
            const rows = await browser.$$('[role="treeitem"]');
            for (const row of rows) {
                const label = (await row.getAttribute('aria-label')) ?? '';
                if (label.toLowerCase().includes(PROJECT_NAME)) return true;
            }
            return false;
        },
        {
            timeout: 5_000,
            timeoutMsg: `Project row for "${PROJECT_NAME}" did not appear in sidebar within 5s`,
            interval: 100,
        },
    );
}

async function cleanupTestProject(): Promise<void> {
    await browser.execute((projectPath: string) => {
        const w = window as unknown as Record<string, { getState: () => Record<string, unknown> }>;
        const state = w.__E2E_WORKSPACE_STORE__.getState();
        (state.removeProject as (p: string) => void)(projectPath);
    }, TEST_PROJECT);
    await browser.pause(200);
}

async function focusTreeitem(labelIncludes: string): Promise<void> {
    await browser.execute((label: string) => {
        const rows = document.querySelectorAll<HTMLElement>('[role="treeitem"]');
        for (const row of rows) {
            if ((row.getAttribute('aria-label') ?? '').toLowerCase().includes(label.toLowerCase())) {
                row.focus();
                return;
            }
        }
    }, labelIncludes);
}

async function getActiveFocusLevel(): Promise<string | null> {
    return browser.execute(
        () => document.activeElement?.getAttribute('aria-level') ?? null,
    ) as Promise<string | null>;
}

async function getActiveAriaLabel(): Promise<string> {
    return browser.execute(
        () => document.activeElement?.getAttribute('aria-label') ?? '',
    ) as Promise<string>;
}

describe('QuietSidebar Projects section — keyboard navigation', () => {
    before(async () => {
        await addTestProject();
    });

    after(async () => {
        await cleanupTestProject();
    });

    // ---------------------------------------------------------------
    // Test 1: ArrowRight expands a project row
    // ---------------------------------------------------------------
    it('expands a project row with ArrowRight', async () => {
        await focusTreeitem(PROJECT_NAME);

        // Ensure collapsed first
        const row = await browser.$(`[role="treeitem"][aria-level="1"]`);
        const expanded = await row.getAttribute('aria-expanded');
        if (expanded === 'true') {
            await browser.keys(['ArrowLeft']); // collapse
            await browser.waitUntil(
                async () => (await row.getAttribute('aria-expanded')) !== 'true',
                { timeout: 2_000, timeoutMsg: 'Row did not collapse before test' },
            );
        }

        await browser.keys(['ArrowRight']);

        await browser.waitUntil(
            async () => (await row.getAttribute('aria-expanded')) === 'true',
            {
                timeout: 3_000,
                timeoutMsg: 'aria-expanded did not become "true" within 3s after ArrowRight',
            },
        );
        console.log('[tree-nav] Test 1 passed: ArrowRight expanded the project row');
    });

    // ---------------------------------------------------------------
    // Test 2: ArrowDown / ArrowUp navigate focus through expanded rows
    //
    // This is the regression test for issue #349 — the ArrowUp re-render
    // race caused focus to stall on the child row or jump to document.body
    // under WebKit/WKWebView. The fix (el.focus() before setFocusedRowId)
    // ensures the DOM focus call completes before React re-renders.
    // ---------------------------------------------------------------
    it('navigates focus with ArrowDown and ArrowUp through expanded rows', async () => {
        // Ensure project is expanded and focused
        await focusTreeitem(PROJECT_NAME);
        const projectRow = await browser.$(`[role="treeitem"][aria-level="1"]`);
        const expanded = await projectRow.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await browser.keys(['ArrowRight']);
            await browser.waitUntil(
                async () => (await projectRow.getAttribute('aria-expanded')) === 'true',
                { timeout: 3_000, timeoutMsg: 'Project did not expand' },
            );
        }

        // ArrowDown: focus must move to first child (aria-level="2")
        await browser.keys(['ArrowDown']);

        await browser.waitUntil(
            async () => (await getActiveFocusLevel()) === '2',
            {
                timeout: 10_000,
                timeoutMsg: 'Focus did not move to aria-level="2" within 10s after ArrowDown',
                interval: 100,
            },
        );
        const childLabel = await getActiveAriaLabel();
        console.log(`[tree-nav] Test 2a: ArrowDown landed focus on child: "${childLabel}"`);

        // ArrowUp from first child: focus must return to the parent project row (aria-level="1")
        // This is the critical path for issue #349.
        await browser.keys(['ArrowUp']);

        await browser.waitUntil(
            async () => (await getActiveFocusLevel()) === '1',
            {
                timeout: 10_000,
                timeoutMsg:
                    'Focus did not return to aria-level="1" within 10s after ArrowUp — issue #349 regression',
                interval: 100,
            },
        );
        console.log('[tree-nav] Test 2b: ArrowUp returned focus to project row (aria-level=1) — issue #349 fix verified');
    });

    // ---------------------------------------------------------------
    // Test 3: ArrowLeft on a child row returns focus to the project row
    // ---------------------------------------------------------------
    it('ArrowLeft on a child row returns focus to the parent project row', async () => {
        await focusTreeitem(PROJECT_NAME);
        const projectRow = await browser.$(`[role="treeitem"][aria-level="1"]`);
        const expanded = await projectRow.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await browser.keys(['ArrowRight']);
            await browser.waitUntil(
                async () => (await projectRow.getAttribute('aria-expanded')) === 'true',
                { timeout: 3_000, timeoutMsg: 'Project did not expand' },
            );
        }

        await browser.keys(['ArrowDown']); // move to first child
        await browser.waitUntil(
            async () => (await getActiveFocusLevel()) === '2',
            { timeout: 3_000, timeoutMsg: 'ArrowDown did not land on child' },
        );

        await browser.keys(['ArrowLeft']); // back to parent
        await browser.waitUntil(
            async () => (await getActiveFocusLevel()) === '1',
            {
                timeout: 5_000,
                timeoutMsg: 'Focus did not return to aria-level="1" within 5s after ArrowLeft',
            },
        );
        console.log('[tree-nav] Test 3: ArrowLeft returned focus to project row');
    });

    // ---------------------------------------------------------------
    // Test 4: Two-step ArrowLeft collapses the project
    // ---------------------------------------------------------------
    it('ArrowLeft on the project row collapses it', async () => {
        await focusTreeitem(PROJECT_NAME);
        const projectRow = await browser.$(`[role="treeitem"][aria-level="1"]`);
        const expanded = await projectRow.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await browser.keys(['ArrowRight']);
            await browser.waitUntil(
                async () => (await projectRow.getAttribute('aria-expanded')) === 'true',
                { timeout: 3_000, timeoutMsg: 'Project did not expand' },
            );
        }

        await browser.keys(['ArrowLeft']); // collapse

        await browser.waitUntil(
            async () => (await projectRow.getAttribute('aria-expanded')) !== 'true',
            {
                timeout: 3_000,
                timeoutMsg: 'Project did not collapse after ArrowLeft',
            },
        );
        console.log('[tree-nav] Test 4: ArrowLeft collapsed the project row');
    });
});
