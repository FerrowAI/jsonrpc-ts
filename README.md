# jsonrpc-ts

```sh
npm install @ferrow/jsonrpc-ts
```
![CI](https://github.com/FerrowAI/jsonrpc-ts/actions/workflows/ci.yml/badge.svg)

Spec-correct JSON-RPC 2.0 framing — request/response/notification
builders, a validating parser, batch support, typed method-registry
dispatch with per-request error isolation, and an id-correlation helper.
Transport-agnostic (stdio, WebSocket, HTTP) — this is the protocol layer
MCP (Model Context Protocol) is built on. Zero runtime dependencies,
strict TypeScript.

## Quickstart

```ts
import { buildRequest, parseMessage, dispatchAll } from "jsonrpc-ts";

const handlers = {
  add: (params: { a: number; b: number }) => params.a + params.b,
};

const raw = JSON.stringify(buildRequest("add", { a: 2, b: 3 }, 1));
const parsed = parseMessage(raw);
const responses = await dispatchAll(handlers, parsed);
// responses[0] === { jsonrpc: "2.0", result: 5, id: 1 }
```

## API

### Builders

- `buildRequest(method, params?, id?): JsonRpcRequest` — `id` defaults to an auto-incrementing counter via `nextId()`.
- `buildNotification(method, params?): JsonRpcNotification`
- `buildSuccessResponse(id, result): JsonRpcSuccessResponse`
- `buildErrorResponse(id, code, message, data?): JsonRpcErrorResponse`
- `nextId(): number`

### Parsing / validation

- `parseMessage(raw: string): ParseResult` — parses single messages or batch (JSON array) requests. Malformed JSON produces `parseResult.parseError` (code `-32700`). Each batch entry is validated independently.
- `validateMessage(value: unknown): ParsedMessage` — validate one already-`JSON.parse`d value; returns `{ kind: "request"|"notification"|"response"|"invalid", ... }`.

### Dispatch

- `dispatch(handlers, parsed, context?): Promise<JsonRpcResponse | null>` — dispatch one `ParsedMessage`. Returns `null` for notifications (even on handler throw) and for responses (not dispatchable).
- `dispatchAll(handlers, parseResult, context?): Promise<JsonRpcResponse[]>` — dispatch a full parse result (single or batch). A handler throwing for one batch entry never affects the others.

### Id correlation

```ts
const correlator = new IdCorrelator();
const promise = correlator.register<number>(requestId); // send the request over your transport
// ...later, on incoming message:
correlator.resolveResponse(incomingResponse); // resolves/rejects `promise`
```

### Error codes

`ErrorCodes.ParseError` (-32700), `InvalidRequest` (-32600),
`MethodNotFound` (-32601), `InvalidParams` (-32602), `InternalError`
(-32603) — the standard JSON-RPC 2.0 reserved range.

## Limits

- This library covers **framing and dispatch only** — it does not include
  a transport (no stdio/WebSocket/HTTP client). Pair it with whichever
  transport your application uses.
- `IdCorrelator` is an in-memory map with no timeout/expiry — callers are
  responsible for handling requests that never receive a response (e.g.
  via their own timeout wrapping the returned promise).
- Batch validation follows the spec's "one malformed entry doesn't
  invalidate the batch" rule, but an empty batch array (`[]`) is itself
  treated as an `InvalidRequest`, per spec.

---
Part of the [ferrow-toolkit](https://github.com/FerrowAI/ferrow-toolkit) collection · Sponsored by [Ferrow](https://ferrow.ai)
