# Development

See also: [Configuration](Configuration.md) · [Testing](Testing.md) · [CI/CD](CI-CD.md)

## Prerequisites

- Node.js `24.22.1`, pinned in [`.nvmrc`](../.nvmrc) and matched by `image/package.json`'s `engines.node: ">=24.0.0"`. GitHub Actions uses this same file via `actions/setup-node`'s `node-version-file: '.nvmrc'` (see [CI/CD](CI-CD.md)).
- npm (bundled with Node.js).

If you use `nvm`, running `nvm use` from the repository root picks up `.nvmrc` automatically.

## Setup

```bash
git clone https://github.com/OpenIngenium/execution-monitor-service.git
cd execution-monitor-service/image
npm ci
```

All application code, scripts, and dependency manifests live under [`image/`](../image) — there is no root-level `package.json`. Every npm command below must be run with `image/` as the working directory.

## Running the server locally

```bash
cd image
npm start        # equivalent to: node index.js
```

This calls `start(process.env)` via the `require.main === module` guard at `image/index.js:296-298`, which in turn calls `createApp(process.env)` and then `server.http.listen(port, ...)`. With no environment variables set, it listens on port `3000` with `LOG_LEVEL=debug`, empty `EMS_SECRET`, and empty `PUBLIC_PEM` (see [Configuration](Configuration.md) for full defaults and their practical effects, e.g. subscriber auth will always fail with an empty `PUBLIC_PEM`).

Verify it's up:

```bash
curl http://localhost:3000/api/v2/health
# {"status":"OK","message":""}
```

Open `http://localhost:3000/` to load the static demo page (`image/index.html`), which lets you manually test a subscription (execution ID + JWT) against a running instance — see [API Reference](API-Reference.md#subscribe-namespace).

## Test, lint, and format commands

From `image/package.json`:

```bash
npm test               # jest
npm run test:watch     # jest --watch
npm run test:coverage  # jest --coverage
```

There is no linting, formatting, or type-checking tooling configured in this repository — no `.eslintrc*`, no `.prettierrc*`, no `tsconfig.json`, and no corresponding devDependencies or npm scripts in `image/package.json`. Code style is not enforced by tooling; see the existing code in `image/index.js` for the conventions actually followed (e.g. `var` declarations, `function` expressions rather than arrow functions in most places, JSDoc-style comments above each function).

## Debugging

There is no dedicated debug script (e.g. `--inspect`) defined in `image/package.json`. To debug locally with Node's built-in inspector:

```bash
cd image
node --inspect index.js
```

Because every handler and middleware factory is exported (`image/index.js:280-293`), individual pieces can also be exercised directly from a Node REPL or a scratch script via `require('./index')` without booting a full server — this is the same approach the unit tests use (see [Testing](Testing.md)).

Log output is controlled by `LOG_LEVEL` (see [Configuration](Configuration.md)); setting `LOG_LEVEL=trace` surfaces the most detail, including full JSON payloads of incoming `execution-event` messages (`image/index.js:117`).

## Making a change safely

1. Change `image/index.js` (or add files under `image/`).
2. Add/update tests in `image/tests/unit/index.test.js` (and, if needed, mock factories in `image/tests/unit/mocks/testHelpers.js`).
3. Run `npm run test:coverage` from `image/` — `image/jest.config.js` enforces a **100%** threshold on branches, functions, statements, and lines (`image/jest.config.js:23-30`); an uncovered branch fails the command with a non-zero exit code.
4. See [Testing](Testing.md) and [Extending EMS](Extending.md) for patterns to follow when adding new handlers/config.
