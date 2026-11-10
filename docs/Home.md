# Execution Monitor Service — DeepWiki

This is the developer-facing technical knowledge base for the **Execution Monitor Service (EMS)**. It explains *how the system actually works* so that a developer with no prior exposure to the codebase can understand, run, debug and extend it.

For the public-facing "what is this / how do I get started" introduction, see the top-level [`README.md`](../README.md). This wiki does not repeat that content — it goes underneath it.

## Wiki map

| Page | Answers |
|---|---|
| [Architecture](Architecture.md) | What are the major components, and how do they connect? |
| [Core Components](Core-Components.md) | What does each function in `index.js` actually do? |
| [API Reference](API-Reference.md) | What HTTP endpoints and Socket.IO events exist, and what do they expect? |
| [Data Flow](Data-Flow.md) | What happens, step by step, from a publisher emitting an event to a subscriber receiving it? |
| [Configuration](Configuration.md) | What environment variables exist, what do they default to, and how are they read? |
| [Development](Development.md) | How do I set up, run, and modify this service locally? |
| [Testing](Testing.md) | How is the test suite structured, and how is 100% coverage enforced? |
| [CI/CD](CI-CD.md) | What does the GitHub Actions workflow actually do? |
| [Security](Security.md) | How does authentication work, and what are its actual properties/limits? |
| [Error Handling](Error-Handling.md) | How are auth failures, malformed messages, and missing config handled? |
| [Extending EMS](Extending.md) | How do I safely add an endpoint, event, or config option? |
| [Troubleshooting](Troubleshooting.md) | What are known, code-confirmed failure modes and their causes? |

## What this service does (observed implementation)

EMS is a single-process Node.js service (Express + Socket.IO) whose entire behavior is implemented in one module, [`image/index.js`](../image/index.js). It relays two message types — `execution-event` and `procedure-event` — from a small set of trusted **publishers** to any number of **subscribers**, in real time, without persisting anything to disk or a database. There is no database, cache, or background job system anywhere in this repository.

Two Socket.IO namespaces are created on the same HTTP server (`image/index.js:253-254`):

| Namespace | Purpose | Auth mechanism |
|---|---|---|
| `/api/v2/execution_event_publish` | Producers send `execution-event` / `procedure-event` messages | Shared secret query param (`EMS_SECRET`) |
| `/api/v2/execution_event_subscribe` | Consumers receive events for rooms they join | RS256 JWT query param (`PUBLIC_PEM`) |

Two plain HTTP routes are also registered on the same Express `app` (`image/index.js:250-251`):

- `GET /` — serves the static demo page `image/index.html`.
- `GET /api/v2/health` — liveness check, returns `{"status":"OK","message":""}`.

## Repository structure

```text
.
├── .github/workflows/ci.yml   Test + Docker-build pipeline (GitHub Actions)
├── Dockerfile                 Container image definition (production build)
├── README.md                  Public-facing overview and quick start
├── .nvmrc                     Pinned Node.js version (24.22.1) used by nvm and CI
└── image/                     Application source AND Docker build context
    ├── index.js               Entire application: HTTP routes, Socket.IO namespaces, logger, entry point
    ├── index.html             Static jQuery/Socket.IO demo client served at GET /
    ├── package.json           Dependencies, scripts (start/test/test:watch/test:coverage)
    ├── jest.config.js         Jest config; enforces 100% coverage on branches/functions/statements/lines
    └── tests/unit/
        ├── index.test.js      Full unit-test suite for index.js (mocks all I/O)
        └── mocks/testHelpers.js  Shared mock factories (logger, socket, namespace, response)
```

`image/` is both the npm package root **and** the Docker build context (`Dockerfile` does `COPY ./image /app`) — this is why application dependencies (`image/package.json`) are separate from anything at the repository root.

There is exactly one source file that contains application logic: `image/index.js`. Everything else in the repository (Dockerfile, CI workflow, tests) exists to build, run, verify, or deploy that one file.

## Key terminology used throughout this wiki

These names come directly from the code and are used consistently across this wiki:

- **Publish namespace** — the Socket.IO namespace object stored as `io_em_pub`, mounted at `/api/v2/execution_event_publish`.
- **Subscribe namespace** — the Socket.IO namespace object stored as `io_em_sub`, mounted at `/api/v2/execution_event_subscribe`.
- **Room** — a Socket.IO room on the subscribe namespace, named either after an `execution_id` or as `` `${procedure_id}:${version}` ``.
- **`env`** — the plain object (defaulting to `process.env`) that every configuration-reading function accepts as a parameter, enabling the functions to be unit-tested without mutating real environment variables.
