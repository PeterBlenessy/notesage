import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
    runner: 'local',

    // The tauri-webdriver CLI exposes a W3C WebDriver endpoint
    hostname: 'localhost',
    port: 4444,
    path: '/',

    specs: ['./e2e-real/tests/**/*.test.ts'],

    maxInstances: 1,

    capabilities: [{
        browserName: 'webview',
        // Single session — all test files share one app instance
        maxInstances: 1,
        'webdriver:newSessionParameters': {
            alwaysMatch: {}
        }
    }],

    logLevel: 'warn',

    // Bound how long a single WebDriver request waits. The default (120s) means
    // a wedged tauri-plugin-webdriver session makes the FIRST failing spec hang
    // two full minutes before failing. 60s halves that while staying well above
    // any legitimate command (in-test waitUntil ceilings are ≤15s, and the app
    // is already running before wdio connects). The run-real-e2e.sh
    // restart-on-failure logic is what actually prevents the cascade; this just
    // makes the initial detection quicker.
    connectionRetryTimeout: 60000,

    framework: 'mocha',
    mochaOpts: {
        ui: 'bdd',
        timeout: 30000,
    },

    reporters: ['spec'],

    // TypeScript support via tsx
    autoCompileOpts: {
        tsNodeOpts: {
            project: './e2e-real/tsconfig.json',
        },
    },
};
