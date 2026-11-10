# Architecture

See also: [Core Components](Core-Components.md) · [Data Flow](Data-Flow.md) · [API Reference](API-Reference.md)

## Overview

The entire service is assembled by a single factory function, `createApp(env)` (`image/index.js:218-263`), which is called once from `start(env)` (`image/index.js:268-278`). `createApp` builds and wires together, in order:

1. An Express `app`.
2. A Node `http.Server` wrapping that app.
3. A Socket.IO `Server` (`io`) attached to the HTTP server, configured with ping timing, `allowEIO3`, and permissive CORS.
4. A winston `Logger` (`log`).
5. Two HTTP routes on `app` (`GET /`, `GET /api/v2/health`).
6. Two Socket.IO namespaces on `io` (`io_em_pub`, `io_em_sub`), each with one auth middleware and one connection handler.

`createApp` returns all of these as a plain object (`{app, http, io, log, io_em_pub, io_em_sub}`), which is what makes the unit tests in `image/tests/unit/index.test.js` able to assert against every wired-up piece without starting a real server.

## Component diagram

```mermaid
flowchart TB
    subgraph Process["EMS Node.js process (image/index.js)"]
        ENV["env (process.env or injected object)"] --> createApp
        createApp -->|new| APP["Express app"]
        createApp -->|new, wraps APP| HTTP["http.Server"]
        createApp -->|new, attached to HTTP| IO["Socket.IO Server (io)"]
        createApp -->|createLogger(env)| LOG["winston Logger"]

        APP -->|app.get('/')| ROOT[rootHandler]
        APP -->|app.get('/api/v2/health')| HEALTH[healthHandler]

        IO -->|io.of(...)| PUBNS["io_em_pub namespace\n/api/v2/execution_event_publish"]
        IO -->|io.of(...)| SUBNS["io_em_sub namespace\n/api/v2/execution_event_subscribe"]

        PUBNS -->|use| PUBAUTH[createPubAuthMiddleware]
        PUBNS -->|on connection| PUBCONN["createPubConnectionHandler(io_em_sub, log)"]

        SUBNS -->|use| SUBAUTH[createSubAuthMiddleware]
        SUBNS -->|on connection| SUBCONN["createSubConnectionHandler(log)"]

        PUBCONN -.->|closure captures| SUBNS
        PUBCONN -->|io_em_sub.to(room).emit| SUBNS
    end
```

The key architectural point is the closure in `createApp` (`image/index.js:256-257`): `createPubConnectionHandler` is given a direct reference to the **subscribe namespace object**, not a message queue or event bus. This is what lets a publisher's message be broadcast into subscribe-namespace rooms — the two namespaces are coupled in-process, in memory, with no intermediary.

## Major components and responsibilities

| Component | Where | Responsibility |
|---|---|---|
| `createApp` | `image/index.js:218-263` | Assembles and wires every other component; the single source of truth for how the app is constructed |
| `start` | `image/index.js:268-278` | Calls `createApp`, then binds the HTTP server to `env.PORT` (default `3000`) |
| `createLogger` | `image/index.js:53-70` | Builds the winston logger used by every handler; reads `env.LOG_LEVEL` |
| `rootHandler` / `healthHandler` | `image/index.js:75-91` | Plain Express route handlers (static file, JSON health payload) |
| `createPubAuthMiddleware` | `image/index.js:96-106` | Socket.IO namespace middleware; gates connections to the publish namespace on a shared secret |
| `createPubConnectionHandler` | `image/index.js:111-147` | Per-socket handler on the publish namespace; listens for `execution-event`/`procedure-event` and forwards them into subscribe-namespace rooms |
| `createSubAuthMiddleware` | `image/index.js:152-167` | Socket.IO namespace middleware; gates connections to the subscribe namespace on a JWT |
| `createSubConnectionHandler` | `image/index.js:172-212` | Per-socket handler on the subscribe namespace; joins rooms on connect and on `set-execution-id`/`set-procedure-id` |

There is no separate "service", "controller", or "repository" layer — all responsibilities above are implemented as small, independently exported, independently testable functions in one file. This is why [Core Components](Core-Components.md) documents them individually rather than by class.

## Statelessness and absence of persistence

The repository contains no database client, cache client, queue client, or filesystem-based persistence for event data. Socket.IO's own in-memory room membership (`socket.join(...)`) is the only "state" the service holds, and it exists only for the lifetime of a socket connection. This matches the README's description of EMS as a stateless relay. If the process restarts, all room memberships are lost and clients must reconnect.

## Control flow of `createApp(env)`

1. Default `env` to `process.env` if not supplied (`image/index.js:219`).
2. Create the Express `app` and wrap it in an `http.Server` (`image/index.js:221-222`).
3. Resolve ping timing from `env.PING_TIMEOUT_SECS` / `env.PING_INTERVAL_SECS` via `parseTimeoutSecs`, converting seconds to milliseconds (`image/index.js:224-228`).
4. Construct the Socket.IO `Server` with `pingTimeout`, `pingInterval`, `allowEIO3: true`, and `cors: { origin: true, methods: ['GET', 'POST'] }` (`image/index.js:233-241`).
5. Create the logger via `createLogger(env)` (`image/index.js:243`).
6. Resolve `public_pem` and `ems_secret` from `env.PUBLIC_PEM` / `env.EMS_SECRET`, defaulting to `''` (`image/index.js:245-246`).
7. Register the two Express routes (`image/index.js:250-251`).
8. Create the two namespaces via `io.of(...)` and attach middleware + connection handler to each (`image/index.js:253-260`).
9. Return the assembled object.

## Why two namespaces instead of one

The repository does not include a written design-rationale document. From the implementation, the **observable effect** of using two namespaces is that publishers and subscribers use different authentication schemes (shared secret vs. JWT) and different capabilities (publishers only emit two event names; subscribers only join rooms and receive events) — Socket.IO namespaces are the mechanism used to isolate these two roles under one server/port. The *reason* this design was chosen (vs., e.g., two ports or a single namespace with role-based checks) is not documented in the repository and should be treated as unknown rather than inferred.
