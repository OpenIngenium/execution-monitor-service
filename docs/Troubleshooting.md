# Troubleshooting

See also: [Error Handling](Error-Handling.md) · [Security](Security.md) · [Configuration](Configuration.md) · [CI/CD](CI-CD.md)

This page lists failure modes that can be directly confirmed from the implementation, tests, or existing documentation in this repository. It intentionally does not speculate beyond what the code establishes.

## Publisher connection never completes ("hangs")

**Symptom**: a client connecting to `/api/v2/execution_event_publish` neither connects successfully nor receives a `connect_error`.

**Cause**: if the connection's query string has no `secret` parameter at all, `createPubAuthMiddleware` (`image/index.js:96-106`) returns without calling `next()` in either branch of its `if`. This is confirmed by the unit test *"does not call next when no secret is provided (documented behavior)"* (`image/tests/unit/index.test.js:202-209`). Compare this to sending `secret` with the wrong value, which *does* produce an explicit `'Authentication error.'` rejection.

**Fix**: always include a `secret` query parameter (even if testing with an intentionally wrong value) when connecting to the publish namespace — see [API Reference](API-Reference.md#publish-namespace) for the correct connection shape.

## Subscriber gets `'No authentication info was provided.'`

**Cause**: connecting to `/api/v2/execution_event_subscribe` without a `token` query parameter (`image/index.js:163-165`).

**Fix**: supply a valid RS256 JWT as `token` in the connection query, per [API Reference](API-Reference.md#subscribe-namespace).

## Subscriber gets `'Authentication error'`

**Cause**: `jwt.verify(token, PUBLIC_PEM, {algorithms:['RS256']})` threw (`image/index.js:156-162`) — e.g. token not signed with RS256, signature does not match `PUBLIC_PEM`, or the token is malformed/expired. The specific underlying error is written to the server log via `log.error('jwt.verify error: %s', e)` but is not sent to the client.

**Fix**: check server logs for the detailed `jwt.verify` error; confirm `PUBLIC_PEM` (see [Configuration](Configuration.md)) is the correct public key counterpart to whatever service signs the JWTs, and that the token was actually signed with RS256.

## Subscriber connects but receives no events

Two independent causes are established by the implementation (see [Data Flow](Data-Flow.md)):

1. **No room joined at connect and none joined afterward.** If `execution_id` was not supplied at connect time and neither `set-execution-id` nor `set-procedure-id` was emitted afterward, the socket is in no room and will never receive a broadcast (`image/index.js:176-183`).
2. **Room name mismatch.** For procedure events, the room is `` `${procedure_id}:${version}` `` on both the publish side (`image/index.js:135`) and the subscribe side (`image/index.js:196`); `version` is used as-is with no normalization, so a mismatch in type or value (e.g. `'1'` vs `1`, or an omitted `version` producing `"...:undefined"`) between publisher and subscriber will silently prevent delivery — there is no error logged for this case since both sides believe they succeeded.

## `PUBLIC_PEM`/`EMS_SECRET` not set

Both default to `''` (`image/index.js:245-246`) when the corresponding environment variable is unset. Per [Configuration](Configuration.md), an empty `PUBLIC_PEM` will cause **all** subscriber JWT verifications to fail with `'Authentication error'`, and an empty `EMS_SECRET` means a publisher supplying `?secret=` (i.e. empty string) will pass the shared-secret check.

## `npm run test:coverage` fails after a change

**Cause**: `image/jest.config.js` enforces a 100% coverage threshold on branches, functions, statements, and lines (`image/jest.config.js:23-30`). Any new code path (including an `if`/`else` branch) added without a corresponding test will drop coverage below 100% and fail the command — this is also what CI's `test` job runs (see [CI/CD](CI-CD.md)), so an uncovered branch fails the pipeline before the `docker` job even starts.

**Fix**: add tests for every new branch, following the patterns in [Testing](Testing.md) and [Extending EMS](Extending.md).

## No `CONTRIBUTING.md`

The repository is licensed under Apache License 2.0 (see [`LICENSE`](../LICENSE) at the repository root), but a `CONTRIBUTING.md` is not currently published in this repository.
