# Configuration

See also: [Core Components](Core-Components.md) · [Security](Security.md) · [Development](Development.md)

EMS is configured entirely through environment variables, read inside `createApp(env)` and `start(env)` (`image/index.js:218-278`). There are no configuration files (no `.env.example`, no YAML/JSON config, no config-loading library such as `dotenv` or `convict` in `image/package.json`).

## Configuration loading pattern

Every function that needs configuration accepts an explicit `env` parameter and falls back to `process.env` if one is not supplied:

```js
function createApp(env) {
  env = env || process.env;
  ...
}

function start(env) {
  env = env || process.env;
  var server = createApp(env);
  ...
}
```

This is a dependency-injection pattern used specifically for testability: `image/tests/unit/index.test.js` calls `index.createApp({...})` and `index.start({...})` with plain literal objects, so tests never need to mutate real process environment variables. In production, `image/index.js:296-298` calls `start(process.env)` when the module is run directly.

## Environment variables

| Variable | Read at | Parsing / default | Effect |
|---|---|---|---|
| `PORT` | `start` (`image/index.js:271`) | `env.PORT \|\| 3000` — no numeric parsing; if set, passed to `http.Server#listen` as-is | HTTP/Socket.IO listen port |
| `LOG_LEVEL` | `createLogger` (`image/index.js:56`) | `env.LOG_LEVEL.toLowerCase()` if defined, else `'debug'` | winston log level; must be one of `critical`, `error`, `warning`, `info`, `debug`, `trace` (the custom level set defined at `image/index.js:55`) |
| `PING_TIMEOUT_SECS` | `createApp` (`image/index.js:224`) | `parseTimeoutSecs(value, 30)` — `parseInt`, falls back to `30` if `NaN` | Socket.IO `pingTimeout`, converted to ms (`× 1000`) |
| `PING_INTERVAL_SECS` | `createApp` (`image/index.js:225`) | `parseTimeoutSecs(value, 35)` — falls back to `35` if `NaN` | Socket.IO `pingInterval`, converted to ms |
| `EMS_SECRET` | `createApp` (`image/index.js:246`) | `env.EMS_SECRET \|\| ''` | Shared secret checked by `createPubAuthMiddleware` against the publish namespace's `?secret=` query param |
| `PUBLIC_PEM` | `createApp` (`image/index.js:245`) | `env.PUBLIC_PEM \|\| ''` | RSA public key (PEM text) passed to `jwt.verify(..., publicPem, {algorithms:['RS256']})` in `createSubAuthMiddleware` |

There is no configuration precedence to document beyond "environment variable, or the hard-coded default above" — there are no config files, CLI flags, or secondary sources that could override or be overridden.

## Practical implications of the defaults

- **`EMS_SECRET` defaulting to `''`**: if left unset, any publisher connecting with `?secret=` (an empty string) will match. A publisher connecting with **no** `secret` query param at all hits the "middleware never calls `next()`" behavior documented in [Core Components](Core-Components.md#createpubauthmiddlewareemssecret--imageindexjs96-106) regardless of what `EMS_SECRET` is set to.
- **`PUBLIC_PEM` defaulting to `''`**: `jwt.verify` will be called with an empty-string key; any token will fail verification (RS256 verification against an empty key throws), so subscribers cannot authenticate until a real PEM is configured.
- **`PORT` is not validated as numeric** — if set to a non-numeric string, the value is passed directly to `http.Server#listen`, whose behavior in that case is Node.js's own, not something this repository controls or tests (the test suite only asserts that `listen` is called with the raw `env.PORT` value, e.g. `image/tests/unit/index.test.js:434-438`).

## Where to set these in practice

- **Local development**: export the variables in your shell before `npm start`, e.g. `EMS_SECRET=devsecret PORT=3000 npm start` from `image/`.
- **Docker**: pass `-e` flags to `docker run` (the `Dockerfile` does not hard-code any of these — see [CI/CD](CI-CD.md#docker-image)).
- **CI**: the GitHub Actions workflow does not set any of these variables — the `test` job runs `npm run test:coverage`, which exercises `createApp`/`createLogger`/etc. purely through explicit literal `env` objects passed in the test file, not through real environment variables.
