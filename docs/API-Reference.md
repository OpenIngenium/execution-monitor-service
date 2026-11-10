# API Reference

See also: [Architecture](Architecture.md) · [Core Components](Core-Components.md) · [Data Flow](Data-Flow.md) · [Configuration](Configuration.md)

EMS exposes three kinds of interfaces: plain HTTP routes, Socket.IO namespace/event contracts, and the internal JS module API used by the test suite.

## HTTP endpoints

Registered in `createApp` (`image/index.js:250-251`).

| Method | Path | Handler | Behavior |
|---|---|---|---|
| `GET` | `/` | `rootHandler` (`image/index.js:75-77`) | Serves `image/index.html` unconditionally. |
| `GET` | `/api/v2/health` | `healthHandler` (`image/index.js:82-91`) | Returns `200`, `Content-Type: application/json`, body `{"status":"OK","message":""}`. |

No other HTTP routes exist. There is no REST API for executions/procedures in this repository — event delivery is Socket.IO-only, per the README's description of this service.

## Publish namespace

Socket.IO namespace path: `/api/v2/execution_event_publish`.

Middleware: `createPubAuthMiddleware(emsSecret)` (`image/index.js:96-106`). Connection handler: `createPubConnectionHandler(io_em_sub, log)` (`image/index.js:111-147`).

**Connecting** — pass the shared secret as a query parameter:

```js
const { io } = require('socket.io-client');

const publisher = io('http://localhost:3000/api/v2/execution_event_publish', {
  query: { secret: process.env.EMS_SECRET }
});
```

**Client → server events (accepted by the service):**

| Event | Payload shape (as read by the handler) | Effect |
|---|---|---|
| `execution-event` | `{ execution_id, event, user_name, ... }` | Broadcast verbatim to the subscribe-namespace room named `execution_id`. Dropped with a warning log if `execution_id` is missing. |
| `procedure-event` | `{ procedure_id, version, event, user_name }` | Broadcast verbatim to the subscribe-namespace room named `` `${procedure_id}:${version}` ``. Dropped with a warning log if `procedure_id` is missing. |

The service does not validate any fields beyond checking `execution_id` / `procedure_id` truthiness — `event`, `user_name`, and the rest of the payload are passed through unmodified to subscribers.

There are no server → client events on this namespace; publishing is fire-and-forget (no ack payload, no error event sent back to the publisher on a dropped message).

## Subscribe namespace

Socket.IO namespace path: `/api/v2/execution_event_subscribe`.

Middleware: `createSubAuthMiddleware(publicPem, log)` (`image/index.js:152-167`). Connection handler: `createSubConnectionHandler(log)` (`image/index.js:172-212`).

**Connecting** — pass an RS256 JWT and, optionally, an initial `execution_id`:

```js
const { io } = require('socket.io-client');

const subscriber = io('http://localhost:3000/api/v2/execution_event_subscribe', {
  query: {
    execution_id: 'exec-123', // optional; joins this room immediately on connect
    token: jwtToken           // required; verified with jwt.verify(token, PUBLIC_PEM, {algorithms:['RS256']})
  }
});
```

**Client → server events (accepted by the service):**

| Event | Payload shape | Effect |
|---|---|---|
| `set-execution-id` | `{ execution_id }` | Joins the room named `execution_id`. Warns if missing. |
| `set-procedure-id` | `{ procedure_id, version }` | Joins the room named `` `${procedure_id}:${version}` ``. Warns if `procedure_id` is missing. |

**Server → client events (emitted by the service):**

| Event | Payload | When |
|---|---|---|
| `execution-event` | Whatever the publisher sent | The socket is in the room named by that message's `execution_id`. |
| `procedure-event` | Whatever the publisher sent | The socket is in the room named `` `${procedure_id}:${version}` ``. |

A subscriber can join any number of rooms over the lifetime of one connection by repeatedly emitting `set-execution-id` / `set-procedure-id`; there is no corresponding "leave room" event exposed.

## Internal module API (`module.exports` in `image/index.js:280-293`)

These are not a public HTTP/Socket.IO surface — they are the functions the app is decomposed into, exported so `image/tests/unit/index.test.js` can call and assert on each independently. See [Core Components](Core-Components.md) for full behavior of each:

```js
module.exports = {
  parseTimeoutSecs,
  isoTimestamp,
  formatLogMessage,
  createLogger,
  rootHandler,
  healthHandler,
  createPubAuthMiddleware,
  createPubConnectionHandler,
  createSubAuthMiddleware,
  createSubConnectionHandler,
  createApp,
  start
};
```

`createApp(env)` and `start(env)` are the two entry points a developer would use to embed or test this server programmatically — `createApp` for wiring without binding a port (used throughout the test suite), `start` for actually listening (used by the `npm start` script via the `require.main === module` guard at `image/index.js:296-298`).
