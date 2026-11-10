# Extending EMS

See also: [Core Components](Core-Components.md) · [Testing](Testing.md) · [Development](Development.md)

## Contribution workflow (from the README)

1. Clone the repository and create a branch off `devel`.
2. Install dependencies and run the full test suite before submitting changes: `cd image && npm ci && npm run test:coverage`.
3. Open a pull request targeting `devel` or `main` — these are the branches [CI](CI-CD.md) runs against.

No `CONTRIBUTING.md` exists in this repository at the time of writing (confirmed absent at the repository root and not present anywhere else in the tree).

## Extension points, by pattern actually used in the code

There is no plugin system, hook registry, or dynamic module loading in this repository — extension means editing `image/index.js` directly, following the existing decomposition into small, exported, independently-testable functions (see [Core Components](Core-Components.md)).

### Adding a new HTTP route

Follow the `rootHandler`/`healthHandler` pattern (`image/index.js:75-91`):

1. Write a plain `(req, res) => {...}` handler function.
2. Register it in `createApp` next to the existing routes: `app.get('/your/path', yourHandler);` (`image/index.js:250-251`).
3. Add the handler to `module.exports` (`image/index.js:280-293`) so it can be unit-tested directly, the same way `rootHandler`/`healthHandler` are tested in `image/tests/unit/index.test.js:159-179`.

### Adding a new Socket.IO event

Follow the `execution-event`/`procedure-event` pattern inside `createPubConnectionHandler` (`image/index.js:111-147`) or the `set-execution-id`/`set-procedure-id` pattern inside `createSubConnectionHandler` (`image/index.js:172-212`):

1. Register `socket.on('your-event', function(msg) {...})` inside the relevant connection-handler factory.
2. Validate whatever field the routing depends on (following the existing truthiness-check + `log.warning` pattern for missing fields).
3. If the event should be relayed to subscribers, call `io_em_sub.to(room).emit('your-event', msg)` using the same room-naming convention already in use (`execution_id`, or `` `${id}:${version}` ``).
4. Add a test in `image/tests/unit/index.test.js` using `createMockSocket`/`createMockNamespace` from `image/tests/unit/mocks/testHelpers.js`, mirroring the existing `describe('createPubConnectionHandler', ...)` / `describe('createSubConnectionHandler', ...)` blocks.

### Adding a new configuration value

Follow the `PING_TIMEOUT_SECS`/`EMS_SECRET` pattern (see [Configuration](Configuration.md)):

1. Read it from the `env` parameter inside `createApp` (or wherever it's needed), with an explicit default — do not read `process.env` directly inside inner functions, since that would break the dependency-injection pattern the tests rely on.
2. Document the new variable in the README's Configuration table and in [Configuration](Configuration.md) here.
3. Add test cases covering both the provided-value and default-value branches, matching the style of the existing `createApp`/`parseTimeoutSecs` tests.

### Adding tests

New tests belong in `image/tests/unit/index.test.js` (or a new file under `image/tests/unit/` matching Jest's configured `testMatch: ['**/tests/unit/**/*.test.js']`, per `image/jest.config.js:4-6`). Reuse the mock factories in `image/tests/unit/mocks/testHelpers.js` rather than creating ad hoc mocks, to keep mocking style consistent across the suite. Any new or modified code must keep the suite at **100%** coverage on branches/functions/statements/lines (`image/jest.config.js:23-30`) or `npm run test:coverage` — and therefore CI — will fail.

## What extension looks like for external integrations

The repository does not currently integrate with any external system beyond what a generic Socket.IO/JWT-verifying producer-consumer relay requires (no database, no message broker, no third-party API calls in `image/index.js`). Adding such an integration is not covered by any existing pattern in this codebase and is not documented here to avoid speculating about an architecture the repository does not implement.
