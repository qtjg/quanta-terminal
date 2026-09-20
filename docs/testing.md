# Testing plan for quanta-terminal

quanta-terminal does not yet have an automated test suite. This document is
the plan for when one is added.

## Planned layout

- `__tests__/unit/` — pure-function unit tests (utility modules, formatters)
- `__tests__/components/` — React component tests (rendering, interaction)
- `__tests__/integration/` — Next.js route and API integration tests
- `e2e/` — end-to-end Playwright or Cypress flows

`__tests__/` is used instead of `tests/` because the latter is ignored by
`.gitignore` (it collides with a Next.js build-output directory name).

## When adding the first tests

- Pick a test runner. The Next.js ecosystem default is **Vitest** for
  unit/component tests and **Playwright** for E2E. Both work with the existing
  TypeScript + Tailwind setup.
- Add `test`, `test:unit`, `test:e2e` scripts to `package.json`.
- Wire CI (`.github/workflows/`) to run `test:unit` on every push.
- Update this document with the actual run commands.
