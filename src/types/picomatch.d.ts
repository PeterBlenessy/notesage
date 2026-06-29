// Minimal ambient types for `picomatch` (v4 ships no bundled `.d.ts`, and we
// keep `@types/picomatch` out of the dependency tree). Mirrors the precedent in
// `markdown-it-task-lists.d.ts`. Only the surface we use is declared.
declare module "picomatch" {
  interface PicomatchOptions {
    /** Match dotfiles (paths beginning with `.`). */
    dot?: boolean;
    /** Case-insensitive matching. */
    nocase?: boolean;
    /** Match the basename of the path when the pattern has no slashes. */
    basename?: boolean;
    /** Treat the pattern as a substring match (`*pattern*`). */
    contains?: boolean;
  }

  type Matcher = (test: string) => boolean;

  function picomatch(glob: string | string[], options?: PicomatchOptions): Matcher;

  export default picomatch;
}
