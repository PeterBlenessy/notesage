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
        'webdriver:newSessionParameters': {
            // Attach to existing app instead of launching a new one
            alwaysMatch: {}
        }
    }],

    logLevel: 'warn',

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
