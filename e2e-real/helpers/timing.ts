/**
 * Timing utilities for E2E performance measurement.
 *
 * Uses `performance.now()` inside the app's webview context for accurate
 * wall-clock timing that isn't affected by WebDriver round-trip overhead.
 */

export interface TimedResult<T> {
    /** Wall-clock duration in milliseconds */
    duration: number;
    /** The return value of the executed action */
    result: T;
}

/**
 * Executes an async action and returns its wall-clock duration in ms.
 *
 * Timing is measured via `performance.now()` inside the app's webview,
 * so it reflects actual in-app time rather than WebDriver IPC overhead.
 *
 * @param fn - Async function to measure
 * @returns The action's result and its duration in milliseconds
 *
 * @example
 * ```ts
 * const { duration, result } = await measureAction(async () => {
 *     await openFile('README.md');
 *     return 'done';
 * });
 * console.log(`Took ${duration}ms`);
 * ```
 */
export async function measureAction<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
    const startTime = await browser.execute(() => performance.now());
    const result = await fn();
    const endTime = await browser.execute(() => performance.now());
    const duration = endTime - startTime;
    return { duration, result };
}
