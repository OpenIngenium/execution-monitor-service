# Execution Monitor Service

Real-time Socket.IO service that streams Ingenium procedure and execution events to connected clients.

[![CI](https://github.com/OpenIngenium/execution-monitor-service/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenIngenium/execution-monitor-service/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen)](image/package.json)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](#license)

> For an in-depth technical reference (architecture, internal APIs, data flow, security details, and more), see the [DeepWiki](docs/Home.md).

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development](#development)
- [Testing & CI](#testing--ci)
- [Docker](#docker)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Execution Monitor Service (EMS) is a small Node.js/Express application that relays real-time events about running Ingenium procedures and executions over [Socket.IO](https://socket.io/). Other Ingenium services **publish** execution and procedure lifecycle events to this service, and any number of clients (dashboards, CLIs, browser tools) **subscribe** to receive updates for a specific execution or procedure without polling a REST API.

It is intended to be run as a lightweight, stateless microservice — event data is not persisted, it is only broadcast to whoever is currently subscribed to the relevant room.

## Features

- **Real-time event streaming** over Socket.IO for `execution-event` and `procedure-event` messages.
- **Per-execution / per-procedure rooms** — subscribers only receive events for the execution ID (or procedure ID + version) they care about.
- **Two isolated namespaces** — a publish namespace (`/api/v2/execution_event_publish`) for trusted producers and a subscribe namespace (`/api/v2/execution_event_subscribe`) for consumers, each with its own authentication.
- **Shared-secret authentication** for publishers and **RS256 JWT verification** for subscribers.
- **Health check endpoint** (`/api/v2/health`) suitable for container/orchestrator liveness checks.
- **Structured logging** via [winston](https://github.com/winstonjs/winston) with configurable log level and custom severity levels (`critical`, `error`, `warning`, `info`, `debug`, `trace`).
- **Minimal browser demo page** (`image/index.html`) for manually testing a subscription without writing any code.

## Installation

### Prerequisites

- Node.js `>= 24.0.0` (see [`.nvmrc`](.nvmrc) / [`image/package.json`](image/package.json) `engines`)
- npm (bundled with Node.js)

### From source

```bash
git clone https://github.com/OpenIngenium/execution-monitor-service.git
cd execution-monitor-service/image
npm ci
```

## Quick Start

1. Install dependencies and start the server (defaults to port `3000`):

   ```bash
   cd image
   npm install
   npm start
   ```

2. Verify it is running:

   ```bash
   curl http://localhost:3000/api/v2/health
   # {"status":"OK","message":""}
   ```

3. Open [`image/index.html`](image/index.html) in a browser (served at `http://localhost:3000/`) to subscribe to an execution using the demo form, or connect a Socket.IO client directly — see [Usage](#usage) below.

## Usage

### HTTP endpoints

| Method | Path                | Description                                              |
| ------ | ------------------- | ---------------------------------------------------------- |
| `GET`  | `/`                 | Serves the static demo page (`image/index.html`).        |
| `GET`  | `/api/v2/health`   | Health check. Returns `{"status":"OK","message":""}`.    |

### Publishing events

Producers connect to the **publish** namespace and authenticate with a shared secret (`EMS_SECRET`) passed as a query parameter. The examples below use the [`socket.io-client`](https://www.npmjs.com/package/socket.io-client) library, which any Socket.IO v4-compatible client (Node.js, browser, etc.) can substitute — it is not a dependency of this service itself.

```js
const { io } = require('socket.io-client');

const publisher = io('http://localhost:3000/api/v2/execution_event_publish', {
  query: { secret: process.env.EMS_SECRET }
});

publisher.emit('execution-event', {
  execution_id: 'exec-123',
  event: 'started',
  user_name: 'jdoe'
});

publisher.emit('procedure-event', {
  procedure_id: 'proc-456',
  version: '1',
  event: 'step-completed',
  user_name: 'jdoe'
});
```

- `execution-event` messages are broadcast to subscribers in the room named after `execution_id`.
- `procedure-event` messages are broadcast to subscribers in the room named `` `${procedure_id}:${version}` ``.

### Subscribing to events

Consumers connect to the **subscribe** namespace and authenticate with an RS256-signed JWT (verified against `PUBLIC_PEM`):

```js
const { io } = require('socket.io-client');

const subscriber = io('http://localhost:3000/api/v2/execution_event_subscribe', {
  query: {
    execution_id: 'exec-123',
    token: jwtToken
  }
});

subscriber.on('execution-event', (msg) => {
  console.log('execution-event:', msg);
});
```

A subscriber can also join additional rooms after connecting:

```js
subscriber.emit('set-execution-id', { execution_id: 'exec-789' });
subscriber.emit('set-procedure-id', { procedure_id: 'proc-456', version: '1' });
```

## Configuration

The service is configured entirely through environment variables:

| Variable             | Description                                                                                  | Default   |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| `PORT`               | HTTP port the server listens on.                                                             | `3000`    |
| `LOG_LEVEL`          | Winston log level: `critical`, `error`, `warning`, `info`, `debug`, `trace`.                  | `debug`   |
| `PING_TIMEOUT_SECS`  | Socket.IO `pingTimeout`, in seconds.                                                          | `30`      |
| `PING_INTERVAL_SECS` | Socket.IO `pingInterval`, in seconds.                                                         | `35`      |
| `MAX_HTTP_BUFFER_SIZE` | Socket.IO `maxHttpBufferSize`, in bytes. Increase if large event payloads (e.g. large `import_procedure_section` results) are being dropped with `transport error` disconnects. | `5000000000` (5GB) |
| `EMS_SECRET`         | Shared secret required by clients connecting to `/api/v2/execution_event_publish`.            | `''`      |
| `PUBLIC_PEM`         | RSA public key (PEM) used to verify RS256 JWTs presented on `/api/v2/execution_event_subscribe`. | `''`      |

## Project Structure

```text
.
├── .github/workflows/ci.yml   # CI pipeline: tests + Docker build
├── Dockerfile                  # Container image definition
├── docs/                        # DeepWiki: in-depth technical documentation
└── image/                      # Application source (Docker build context)
    ├── index.js                # Express + Socket.IO server
    ├── index.html               # Minimal browser demo/test client
    ├── package.json
    ├── jest.config.js
    └── tests/unit/              # Jest unit tests
```

See the [DeepWiki](docs/Home.md) for a page-by-page breakdown of the architecture, internal functions, Socket.IO events, and configuration behavior.

## Development

All application code and scripts live under [`image/`](image/).

```bash
cd image
npm install       # install dependencies (including devDependencies)
npm start         # run the server (node index.js)
npm test          # run the Jest test suite
npm run test:watch      # run tests in watch mode
npm run test:coverage   # run tests with a coverage report
```

## Testing & CI

- Tests are written with [Jest](https://jestjs.io/) and live in [`image/tests/unit`](image/tests/unit). External collaborators (`express`, `http`, `socket.io`, `winston`, `jsonwebtoken`) are mocked, so tests do not perform real network, filesystem, or timer I/O.
- [`image/jest.config.js`](image/jest.config.js) enforces a **100%** coverage threshold for branches, functions, statements, and lines.
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request targeting `devel` or `main`:
  - **Test** — sets up Node.js using [`.nvmrc`](.nvmrc), runs `npm ci` and `npm run test:coverage` in `image/`.
  - **Docker Build** — builds the Docker image (`docker build -t execution-monitor-service:<sha> .`) after the Test job succeeds.

## Docker

```bash
docker build -t execution-monitor-service .
docker run -p 3000:3000 execution-monitor-service
```

The [`Dockerfile`](Dockerfile) builds from the public `node:24.22.1-slim` image and installs only production dependencies (`npm ci --omit=dev`).

## Contributing

1. Clone the repository and create a branch off `devel`.
2. Install dependencies and run the test suite before submitting changes:

   ```bash
   cd image
   npm ci
   npm run test:coverage
   ```

3. Open a pull request targeting `devel` or `main` — these are the branches CI runs against (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

No `CONTRIBUTING.md` is currently published in this repository.

## License

This project is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).
