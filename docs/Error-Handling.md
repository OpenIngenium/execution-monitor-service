# Error Handling

See also: [Security](Security.md) · [Core Components](Core-Components.md) · [Troubleshooting](Troubleshooting.md)

## Socket.IO middleware errors

Both auth middlewares follow the same Socket.IO-idiomatic pattern: call `next()` to allow a connection, or `next(new Error(message))` to reject it.

| Middleware | Rejection message | Condition |
|---|---|---|
| `createPubAuthMiddleware` (`image/index.js:96-106`) | `'Authentication error.'` | `secret` query param present but does not match `EMS_SECRET` |
| `createSubAuthMiddleware` (`image/index.js:152-167`) | `'Authentication error'` | `jwt.verify` throws (invalid signature, malformed token, wrong algorithm, etc.) |
| `createSubAuthMiddleware` | `'No authentication info was provided.'` | `token` query param absent |

When Socket.IO middleware calls `next(err)`, Socket.IO's client-side library surfaces this as a `connect_error` event on the client socket (this is standard Socket.IO middleware behavior, not something implemented in this repository). **This repository does not implement or test any client-side handling of that event** — the demo page (`image/index.html`) does not register a `connect_error` handler, for example.

As documented in [Core Components](Core-Components.md), `createPubAuthMiddleware` has a fourth path — no `secret` query parameter at all — where **neither** `next()` nor `next(err)` is called. This is not an error being thrown or swallowed; it is simply that the function returns without invoking the callback Socket.IO expects, which leaves the handshake unresolved. See [Troubleshooting](Troubleshooting.md) for the practical symptom.

## Message-level error handling

Neither `createPubConnectionHandler` (`image/index.js:111-147`) nor `createSubConnectionHandler` (`image/index.js:172-212`) throws or propagates exceptions for malformed event payloads. Missing `execution_id`/`procedure_id` fields are handled by:

1. Logging a `log.warning(...)` call describing what was missing.
2. Returning without emitting/joining anything.

No error is sent back to the client that emitted the malformed message — from the sending client's perspective, a dropped message due to a missing ID is indistinguishable from a message that was never received by the server at all (no ack, no error event).

## Logging as the primary error-visibility mechanism

Every warning/error path in `image/index.js` goes through the winston logger created by `createLogger` (`image/index.js:53-70`), using the custom levels `critical`, `error`, `warning`, `info`, `debug`, `trace`. There is no separate error-tracking/alerting integration (e.g. Sentry) in the repository. Operators are expected to observe failures via stdout logs (the Console transport sends everything to stdout, including `error`/`critical`, per the comment at `image/index.js:64`).

## Process-level error handling

The repository does not register any `process.on('uncaughtException', ...)` or `process.on('unhandledRejection', ...)` handlers. An unhandled synchronous exception or promise rejection in this service would follow Node.js's default behavior (typically crashing the process); this repository provides no supervisory restart logic itself — that responsibility, if any, belongs to the container orchestrator running the image (not documented in this repository).

## Retries

There is no retry logic anywhere in `image/index.js` — not for JWT verification, not for message delivery, not for anything else. Socket.IO's own client-side reconnection behavior (a feature of the `socket.io-client` library, not this repository) is the only retry mechanism that would apply, and it is entirely client-controlled.

## User-facing error surface

The only user-facing (client-visible) errors are the three middleware rejection messages listed above, delivered via Socket.IO's `connect_error` mechanism. The HTTP surface (`GET /`, `GET /api/v2/health`) has no error branches in the handlers themselves — `rootHandler` and `healthHandler` (`image/index.js:75-91`) contain no `try/catch` and always execute their single code path.
