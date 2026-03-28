# Performance Benchmark: Small Document

A brief note on **build optimization** and *deployment strategies* for modern web apps.

## Key Metrics

- First contentful paint: `< 1.2s`
- Time to interactive: **under 3 seconds**
- Bundle size target: *150KB gzipped*

### Task List

- [x] Configure tree shaking
- [x] Enable code splitting
- [ ] Set up CDN caching
- [ ] Run #lighthouse audit

> Premature optimization is the root of all evil. Focus on measurable bottlenecks first.

## Quick Reference

| Metric | Target | Current |
| --- | --- | --- |
| FCP | 1.2s | 1.4s |
| TTI | 3.0s | 2.8s |
| LCP | 2.5s | 3.1s |

---

Reviewed by @sarah. See [Tauri docs](https://v2.tauri.app) for details on #performance tuning.

```javascript
const config = { minify: true, treeshake: true };
export default config;
```

1. Run the #benchmark suite against production builds
2. Compare results with the previous release baseline
3. File any regressions as high-priority tickets

The @devops team should integrate these checks into the CI pipeline before the next #release cycle.
