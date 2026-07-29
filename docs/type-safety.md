# Type safety

ONYX uses the TypeScript compiler as a required no-emit quality gate while executing source files directly on Node.js.

## Compiler baseline

- strict type checking;
- exact optional property semantics;
- unchecked indexed-access detection;
- NodeNext module and resolution behavior;
- explicit `.ts` imports without emitted output;
- Node.js 24 type definitions, aligned with the minimum supported runtime.

Exact optional properties are important for contract fidelity: an omitted JSON field and a present field containing `undefined` are not modeled as equivalent. Aggregate construction and DTO mapping therefore omit absent optional fields rather than materializing them with undefined values.

## Commands

```bash
npm ci
npm run typecheck
npm run check
```

`npm run check` performs artifact validation, type checking, and runtime tests. GitHub Actions installs the lockfile with `npm ci` before running the same command on Node.js 24.
