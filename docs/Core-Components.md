# Core Components

See also: [Architecture](Architecture.md) · [API Reference](API-Reference.md) · [Testing](Testing.md)

All application code lives in [`image/index.js`](../image/index.js) and is exported as a flat set of functions (`image/index.js:280-293`) so that each one can be unit-tested in isolation. This page documents every exported function.

## `String.prototype.format` — `image/index.js:12-15`

A small `sprintf`-style helper attached to the global `String` prototype: `'element id is {0}'.format(elem_id)`. Used throughout the logging calls in this file (e.g. `image/index.js:113`, `image/index.js:116`) and inside `formatLogMessage`. Not exported via `module.exports` — it is a global side effect of requiring `index.js`.

## `parseTimeoutSecs(value, defaultValue)` — `image/index.js:21-27`

Parses `value` with `parseInt`; returns `defaultValue` if the result is `NaN` (covers `undefined`, non-numeric strings, etc.). Used to read `PING_TIMEOUT_SECS` and `PING_INTERVAL_SECS` from the environment inside `createApp`.

## `isoTimestamp()` — `image/index.js:32-34`

Returns `new Date().toISOString()`. Passed to `winston.format.timestamp({format: isoTimestamp})` so every log line gets a real ISO-8601 timestamp instead of winston's default format.

## `formatLogMessage(info)` — `image/index.js:41-47`

The winston `printf` formatter. Produces lines shaped like:

```text
[INFO]: [2024-01-01T00:00:00.000Z] - some message
```

If `info.meta` is a non-empty object, it appends `\n\t` followed by `util.inspect(info.meta)`. If `info.message` is falsy, the message portion is omitted entirely (confirmed by the test `omits message and meta when message is empty and meta is undefined` in `image/tests/unit/index.test.js:110-119`).

## `createLogger(env)` — `image/index.js:53-70`

Builds the single winston logger instance used everywhere else in the app.

- **Custom severity levels**: `{critical: 0, error: 1, warning: 2, info: 3, debug: 4, trace: 5}` — this is *not* winston's default level set, so log calls must use one of these six names (`log.critical`, `log.error`, `log.warning`, `log.info`, `log.debug`, `log.trace`).
- **Level**: `env.LOG_LEVEL.toLowerCase()` if set, else `'debug'`.
- **Format pipeline**: `winston.format.splat()` → `winston.format.timestamp({format: isoTimestamp})` → `winston.format.printf(formatLogMessage)`.
- **Transport**: a single `winston.transports.Console` with `stderrLevels: []`, so *all* levels (including `critical`/`error`) go to stdout. The inline comment explains this is intentional — "to avoid the look of out of order logging" (`image/index.js:64`).

## `rootHandler(req, res)` — `image/index.js:75-77`

Express handler for `GET /`. Calls `res.sendFile(__dirname + '/index.html')`, i.e. it always serves `image/index.html` regardless of request path/query.

## `healthHandler(req, res)` — `image/index.js:82-91`

Express handler for `GET /api/v2/health`. Always responds `200` (no explicit status code call — Express defaults to 200) with `Content-Type: application/json` and body `{"status":"OK","message":""}`. The `message` field is hard-coded empty; nothing in the implementation currently populates it with diagnostic detail.

## `createPubAuthMiddleware(emsSecret)` — `image/index.js:96-106`

Returns a Socket.IO namespace middleware `(socket, next) => ...` used on `io_em_pub`.

- If `socket.handshake.query.secret` is present and equals `emsSecret`, calls `next()` (allow).
- If present but not equal, calls `next(new Error('Authentication error.'))` (reject).
- **If the `secret` query param is absent entirely, `next` is never called.** This is a real, test-confirmed behavior (`image/tests/unit/index.test.js:202-209`, test name *"does not call next when no secret is provided (documented behavior)"*), not an inference. Practically, a connection attempt with no `secret` query parameter will neither be accepted nor explicitly rejected by this middleware. See [Troubleshooting](Troubleshooting.md) for the operational implication.

## `createPubConnectionHandler(io_em_sub, log)` — `image/index.js:111-147`

Returns the `connection` handler for `io_em_pub`. Takes the **subscribe namespace** as a parameter (see [Architecture](Architecture.md#component-diagram)) so it can forward messages into it. For each connected publisher socket:

- Logs the connection (`log.info('io_em_pub new connection: %s', socket.handshake.address)`).
- On `execution-event` (payload expected shape: `{execution_id, event, user_name, ...}`):
  - If `msg.execution_id` is truthy: `io_em_sub.to(execution_id).emit('execution-event', msg)`.
  - Otherwise: logs a warning and drops the message — the publisher receives no error/ack either way (fire-and-forget `emit`, no acknowledgment callback used).
- On `procedure-event` (payload expected shape: `{procedure_id, version, event, user_name}`):
  - If `msg.procedure_id` is truthy: builds room name `` `${procedure_id}:${version}` `` and emits into it. Note `version` is **not** validated — if `version` is `undefined`, the room literally becomes `"proc-1:undefined"`.
  - Otherwise: logs a warning and drops the message.
- On `disconnect`: logs the reason.

## `createSubAuthMiddleware(publicPem, log)` — `image/index.js:152-167`

Returns the `connection` middleware for `io_em_sub`.

- If `socket.handshake.query.token` is present: calls `jwt.verify(token, publicPem, {algorithms: ['RS256']})` inside a `try/catch`.
  - Success → logs `'jwt.verify ok'`, calls `next()`.
  - Throws → logs the error via `log.error('jwt.verify error: %s', e)`, calls `next(new Error('Authentication error'))`.
- If `token` is absent: calls `next(new Error('No authentication info was provided.'))` immediately — unlike the publish middleware, this path *does* reject explicitly.
- The `algorithms: ['RS256']` option restricts `jwt.verify` to that single algorithm; tokens signed with other algorithms (including `none`/HS256) are rejected by the `jsonwebtoken` library itself.

## `createSubConnectionHandler(log)` — `image/index.js:172-212`

Returns the `connection` handler for `io_em_sub`. For each connected subscriber socket:

- Logs the connection.
- **At connect time**: if `socket.handshake.query.execution_id` is present, immediately `socket.join(execution_id)`; otherwise logs a warning (no room is joined — the subscriber connects but receives nothing until it joins a room some other way).
- On `set-execution-id` (payload `{execution_id}`): joins that room if `execution_id` is present, else warns.
- On `set-procedure-id` (payload `{procedure_id, version}`): joins room `` `${procedure_id}:${version}` `` if `procedure_id` is present, else warns. Like the publish side, `version` is not validated.
- On `connect`: logs `'io_em_sub socket connected.'`. **This registers a handler for a `connect` event on the server-side socket object.** Socket.IO's documented server API emits `connection`/`connect` at the *namespace* level when a new client connects (which is what triggers `createSubConnectionHandler` itself), not as a subsequent event *on* the already-connected `socket` instance. Whether/when this handler fires in a real deployment is not established by the repository; it is only exercised in tests by manually invoking the mock socket's `emit('connect')` (`image/tests/unit/index.test.js:370-376`). Treat this as an observed code path of unclear real-world significance rather than a documented feature.
- On `disconnect`: logs the reason.

## `createApp(env)` and `start(env)` — `image/index.js:218-278`

Documented in full in [Architecture](Architecture.md#control-flow-of-createappenv). `start` is the only function that actually calls `.listen()`; `createApp` never binds a port, which is why tests can call `createApp` freely without opening real sockets.

## Module entry point — `image/index.js:295-298`

```js
/* istanbul ignore if */
if (require.main === module) {
  start(process.env);
}
```

This is what makes `node index.js` (the `npm start` script) boot the server, while `require('../../index')` from the test suite does not — `require.main === module` is only true when the file is executed directly. The `istanbul ignore if` comment excludes this branch from the coverage report, which is why the [100% coverage threshold](Testing.md) is achievable without a test that spawns a real process.
