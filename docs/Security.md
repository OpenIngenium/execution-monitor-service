# Security

See also: [Configuration](Configuration.md) · [Error Handling](Error-Handling.md) · [API Reference](API-Reference.md)

This page documents security-relevant mechanisms **as implemented**. It does not assert that the service is secure overall — only what mechanisms exist and how they behave.

## Authentication

Two distinct schemes are used, one per namespace (see [Architecture](Architecture.md)):

### Publish namespace — shared secret

`createPubAuthMiddleware(emsSecret)` (`image/index.js:96-106`) compares `socket.handshake.query.secret` to `emsSecret` (from `EMS_SECRET`, see [Configuration](Configuration.md)) using `==`. Observations:

- The secret is transmitted as a **Socket.IO handshake query parameter**, i.e. as part of the connection URL. It is not sent as a header or in a request body. URLs containing query parameters can be logged by proxies, browser history, or access logs depending on deployment — the repository does not implement any redaction for this value.
- The comparison uses loose equality (`==`), not a constant-time comparison. Whether this matters depends on deployment/threat model, which is not documented in the repository.
- As noted in [Core Components](Core-Components.md), a connection attempt **without** a `secret` query parameter at all does not call `next()` in either branch — the middleware neither authenticates nor rejects it explicitly.

### Subscribe namespace — RS256 JWT

`createSubAuthMiddleware(publicPem, log)` (`image/index.js:152-167`) requires a `token` query parameter and verifies it with:

```js
jwt.verify(socket.handshake.query.token, publicPem, {algorithms: ['RS256']});
```

- The `algorithms: ['RS256']` option is passed explicitly, so `jsonwebtoken` will reject tokens signed with any other algorithm (this is a library-level guarantee of the `jsonwebtoken` package, not something this repository re-implements).
- `publicPem` comes from `PUBLIC_PEM` (see [Configuration](Configuration.md)); the repository does not include a mechanism for rotating or fetching this key remotely (e.g. no JWKS endpoint call) — it is a single static value read once per process from configuration.
- Verification failures are caught and logged (`log.error('jwt.verify error: %s', e)`), then surfaced to the client as a generic `Authentication error` — the underlying JWT error detail (expired, malformed, wrong signature, etc.) is not distinguished in the response to the client, only in the server log.
- The repository does not implement token issuance — EMS only verifies tokens; something else (not part of this repository) is responsible for signing and distributing JWTs, and their claims (e.g. subject, expiry, audience) are not inspected by this middleware beyond signature validity.

## Authorization

There is no role-based or per-execution authorization logic. Any subscriber presenting a valid JWT (per `PUBLIC_PEM`) may join **any** room by supplying any `execution_id` or `procedure_id`/`version` — the JWT is not checked against the requested `execution_id`/`procedure_id` in any way in this implementation. Room membership is purely a routing mechanism, not an access-control boundary.

## Secrets handling

`EMS_SECRET` and `PUBLIC_PEM` are read from environment variables with no additional handling (no secrets manager integration, no encryption at rest, no masking in logs beyond what is not explicitly logged). Neither the Dockerfile nor the GitHub Actions workflow sets or bakes in either value — they must be supplied at runtime by whatever deploys the container/process.

## Network-facing configuration

- **CORS** (`image/index.js:233-241`): `cors: { origin: true, methods: ['GET', 'POST'] }`. The inline comment states this is intentional: *"Socket.IO v3+ no longer allows all origins by default. Allow all origins (reflecting the request origin) to restore the previous permissive behavior."* In effect, this permits Socket.IO handshake requests from any origin.
- **`allowEIO3: true`** (`image/index.js:236`): per the inline comment, this keeps backward compatibility with Engine.IO v3 (i.e. older Socket.IO v2) clients.
- **Transport security (TLS)**: not configured anywhere in this repository (no HTTPS server setup, no certificate handling). TLS termination, if present, would be handled outside this codebase (e.g. a reverse proxy or load balancer); this is not documented in the repository.

## Input validation

Validation is limited to truthiness checks on `execution_id` / `procedure_id` fields before using them as Socket.IO room names (see [Core Components](Core-Components.md) and [Data Flow](Data-Flow.md)). There is no schema validation, length limiting, or sanitization of message payloads (`event`, `user_name`, or any other field) — arbitrary JSON-serializable data sent by an authenticated publisher is broadcast to subscribers unmodified.

## Summary of what is *not* established by the repository

- Rate limiting: not present.
- Encryption of data at rest: not applicable (no persistence).
- Audit logging beyond winston's connection/event logs: not present.
- Dependency vulnerability scanning: not configured in `.github/workflows/ci.yml` or elsewhere in the repository.
