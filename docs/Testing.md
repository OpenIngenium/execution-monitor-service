# Testing

See also: [Core Components](Core-Components.md) · [CI/CD](CI-CD.md) · [Development](Development.md)

## Framework and layout

Tests use [Jest](https://jestjs.io/) `^30.4.2` (`image/package.json`). There is a single test file:

```text
image/tests/unit/index.test.js       Full unit-test suite for image/index.js
image/tests/unit/mocks/testHelpers.js  Shared mock factories used by that suite
```

`image/jest.config.js` configures:

- `testEnvironment: 'node'`.
- `testMatch: ['**/tests/unit/**/*.test.js']` — only files under `tests/unit/` matching `*.test.js` are run.
- `collectCoverageFrom: ['**/*.js', '!**/node_modules/**', '!**/tests/**', '!**/coverage/**', '!jest.config.js']` — coverage is measured against all JS in `image/` except node_modules, tests, coverage output, and the Jest config itself. In practice this means `image/index.js` is the only file coverage is measured against.
- `coverageReporters: ['text', 'text-summary', 'lcov', 'html']`.
- `coverageThreshold.global`: **100%** for `branches`, `functions`, `statements`, and `lines` (`image/jest.config.js:23-30`). `npm run test:coverage` (i.e. `jest --coverage`) exits non-zero if any metric falls below 100%.

There are no integration or end-to-end tests in this repository — only the unit suite described above. There are no test fixtures beyond the inline literals in the test file itself.

## Mocking strategy

Every external collaborator is mocked at the top of `image/tests/unit/index.test.js` via `jest.mock(...)`:

```js
jest.mock('express', () => jest.fn());
jest.mock('http', () => ({Server: jest.fn()}));
jest.mock('socket.io', () => ({Server: jest.fn()}));
jest.mock('winston', () => ({ createLogger: jest.fn(), format: {...}, transports: {Console: jest.fn()} }));
jest.mock('jsonwebtoken', () => ({verify: jest.fn(), sign: jest.fn()}));
```

No real network sockets, HTTP servers, timers, or filesystem I/O occur during the test run. `beforeEach` (`image/tests/unit/index.test.js:49-61`) resets all mocks and installs default mock return values (e.g. `socketIo.Server` returns an object whose `.of()` yields `{use, on}` stubs).

### Mock factories — `image/tests/unit/mocks/testHelpers.js`

| Factory | Simulates | Notable behavior |
|---|---|---|
| `createMockLogger()` | The winston logger returned by `createLogger` | Plain `jest.fn()` for each of the six custom levels |
| `createMockSocket(handshake)` | A Socket.IO server-side socket | Captures handlers passed to `.on(event, handler)` in a `handlers` map; exposes `.emit(event, ...args)` that looks up and invokes the captured handler directly — this is how tests simulate a client sending `execution-event`, `set-procedure-id`, etc. without a real transport |
| `createMockNamespace()` | The `io_em_sub` namespace passed into `createPubConnectionHandler` | `.to(room)` returns an object whose `.emit` is the same shared `jest.fn()`, so tests can assert both the room name and the emitted payload |
| `createMockResponse()` | An Express `res` object | Stubs `sendFile`, `setHeader`, `end` |

This mock-socket pattern (`socket.on` records handlers, `socket.emit` replays them) is the mechanism that lets the suite test event-driven code (`createPubConnectionHandler`, `createSubConnectionHandler`) as plain synchronous function calls.

## What is covered

Every exported function in `image/index.js` has a corresponding `describe` block in `image/tests/unit/index.test.js`, including edge cases actually present in the implementation:

- `parseTimeoutSecs`: numeric string, non-numeric string, `undefined`.
- `formatLogMessage`: message + meta present, both empty, empty meta object.
- `createPubAuthMiddleware`: matching secret, mismatched secret, and the no-secret-provided case (asserts `next` is *not* called — see [Core Components](Core-Components.md)).
- `createPubConnectionHandler`: forwarding + warning branches for both `execution-event` and `procedure-event`, plus `disconnect` logging.
- `createSubAuthMiddleware`: valid token, `jwt.verify` throwing, and missing token.
- `createSubConnectionHandler`: room joins/warnings at connect time and via `set-execution-id`/`set-procedure-id`, plus `connect`/`disconnect` logging.
- `createApp`: full wiring assertions (routes, namespaces, middleware, CORS/ping options) and the `env`-omitted (`process.env`) fallback branch.
- `start`: default port, environment-provided port, and the `env`-omitted fallback branch.

## Running tests

```bash
cd image
npm test                # single run
npm run test:watch      # watch mode
npm run test:coverage   # single run + coverage report (text summary + HTML in image/coverage/, gitignored)
```

## CI enforcement

The GitHub Actions `test` job (`.github/workflows/ci.yml`) runs `npm run test:coverage` in `image/` on every push/PR to `devel` or `main`; a coverage regression below 100% on any metric fails CI before the `docker` job (which `needs: test`) ever runs. See [CI/CD](CI-CD.md) for the full pipeline.
