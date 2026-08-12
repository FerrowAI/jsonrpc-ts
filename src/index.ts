/**
 * jsonrpc-ts
 *
 * Spec-correct JSON-RPC 2.0 framing: request/response/notification
 * builders, a validating parser, batch support, a typed method-registry
 * dispatcher with per-request error isolation, and an id-correlation
 * helper for async transports. Transport-agnostic — pair it with stdio,
 * WebSocket, or HTTP. This is the protocol JSON-RPC layer MCP (Model
 * Context Protocol) is built on. Zero runtime dependencies.
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: P;
  id: JsonRpcId;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: P;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse<R = unknown> {
  jsonrpc: "2.0";
  result: R;
  id: JsonRpcId;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  error: JsonRpcError;
  id: JsonRpcId;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccessResponse<R> | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard JSON-RPC 2.0 reserved error codes. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

let idCounter = 0;

/** Generate a fresh numeric id, monotonically increasing within this process. */
export function nextId(): number {
  idCounter += 1;
  return idCounter;
}

export function buildRequest<P = unknown>(
  method: string,
  params?: P,
  id: JsonRpcId = nextId()
): JsonRpcRequest<P> {
  const req: JsonRpcRequest<P> = { jsonrpc: "2.0", method, id };
  if (params !== undefined) req.params = params;
  return req;
}

export function buildNotification<P = unknown>(method: string, params?: P): JsonRpcNotification<P> {
  const note: JsonRpcNotification<P> = { jsonrpc: "2.0", method };
  if (params !== undefined) note.params = params;
  return note;
}

export function buildSuccessResponse<R = unknown>(id: JsonRpcId, result: R): JsonRpcSuccessResponse<R> {
  return { jsonrpc: "2.0", result, id };
}

export function buildErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", error, id };
}

// ---- Validation ----

function isValidId(id: unknown): id is JsonRpcId {
  return typeof id === "string" || typeof id === "number" || id === null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ParsedMessage =
  | { kind: "request"; message: JsonRpcRequest }
  | { kind: "notification"; message: JsonRpcNotification }
  | { kind: "response"; message: JsonRpcResponse }
  | { kind: "invalid"; error: JsonRpcErrorResponse };

/** Validate a single already-parsed JSON value as a JSON-RPC 2.0 message. */
export function validateMessage(value: unknown): ParsedMessage {
  if (!isPlainObject(value)) {
    return { kind: "invalid", error: buildErrorResponse(null, ErrorCodes.InvalidRequest, "Request must be an object") };
  }
  if (value.jsonrpc !== "2.0") {
    return {
      kind: "invalid",
      error: buildErrorResponse(
        isValidId(value.id) ? (value.id as JsonRpcId) : null,
        ErrorCodes.InvalidRequest,
        'Missing or invalid "jsonrpc" version, expected "2.0"'
      ),
    };
  }

  // Response (has result or error, no method)
  if ("result" in value || "error" in value) {
    if (!("id" in value) || !isValidId(value.id)) {
      return { kind: "invalid", error: buildErrorResponse(null, ErrorCodes.InvalidRequest, "Response missing valid id") };
    }
    if ("error" in value) {
      const err = value.error;
      if (!isPlainObject(err) || typeof err.code !== "number" || typeof err.message !== "string") {
        return { kind: "invalid", error: buildErrorResponse(value.id as JsonRpcId, ErrorCodes.InvalidRequest, "Invalid error object") };
      }
    }
    return { kind: "response", message: value as unknown as JsonRpcResponse };
  }

  // Request or notification (has method)
  if (typeof value.method !== "string" || value.method.length === 0) {
    return {
      kind: "invalid",
      error: buildErrorResponse(
        "id" in value && isValidId(value.id) ? (value.id as JsonRpcId) : null,
        ErrorCodes.InvalidRequest,
        'Missing or invalid "method"'
      ),
    };
  }
  if ("params" in value && !isPlainObject(value.params) && !Array.isArray(value.params)) {
    return {
      kind: "invalid",
      error: buildErrorResponse(
        "id" in value && isValidId(value.id) ? (value.id as JsonRpcId) : null,
        ErrorCodes.InvalidParams,
        '"params" must be an object or array'
      ),
    };
  }

  if ("id" in value) {
    if (!isValidId(value.id)) {
      return { kind: "invalid", error: buildErrorResponse(null, ErrorCodes.InvalidRequest, "Invalid id") };
    }
    return { kind: "request", message: value as unknown as JsonRpcRequest };
  }
  return { kind: "notification", message: value as unknown as JsonRpcNotification };
}

export interface ParseResult {
  /** Parsed, validated single messages (in batch order for batch input). */
  messages: ParsedMessage[];
  /** True if the input was a batch (JSON array) request. */
  isBatch: boolean;
  /** Set if the raw text failed to parse as JSON at all (ParseError). */
  parseError?: JsonRpcErrorResponse;
}

/**
 * Parse raw JSON-RPC text (single message or batch array) into validated
 * ParsedMessage entries. Malformed JSON yields a `parseError`
 * (code -32700). Each entry in a batch is validated independently, so one
 * malformed entry does not invalidate the rest.
 */
export function parseMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      messages: [],
      isBatch: false,
      parseError: buildErrorResponse(null, ErrorCodes.ParseError, "Invalid JSON"),
    };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return {
        messages: [],
        isBatch: true,
        parseError: buildErrorResponse(null, ErrorCodes.InvalidRequest, "Batch array must not be empty"),
      };
    }
    return { messages: parsed.map(validateMessage), isBatch: true };
  }

  return { messages: [validateMessage(parsed)], isBatch: false };
}

// ---- Method registry / dispatch ----

export type MethodHandler<P = unknown, R = unknown> = (params: P, context?: unknown) => R | Promise<R>;

export type HandlerMap = Record<string, MethodHandler>;

/**
 * Dispatch a single parsed request/notification against a handler map.
 * Requests get a response (success or per-request isolated error);
 * notifications never produce a response, even on handler failure.
 */
export async function dispatch(
  handlers: HandlerMap,
  parsed: ParsedMessage,
  context?: unknown
): Promise<JsonRpcResponse | null> {
  if (parsed.kind === "invalid") return parsed.error;
  if (parsed.kind === "response") return null; // not dispatchable

  const { method, params } = parsed.message;
  const handler = handlers[method];
  const id = parsed.kind === "request" ? parsed.message.id : null;

  if (!handler) {
    if (parsed.kind === "notification") return null;
    return buildErrorResponse(id, ErrorCodes.MethodNotFound, `Method not found: ${method}`);
  }

  try {
    const result = await handler(params, context);
    if (parsed.kind === "notification") return null;
    return buildSuccessResponse(id, result);
  } catch (err) {
    if (parsed.kind === "notification") return null; // notifications never surface errors
    const message = err instanceof Error ? err.message : String(err);
    return buildErrorResponse(id, ErrorCodes.InternalError, message);
  }
}

/**
 * Dispatch a full parse result (single or batch) against a handler map.
 * Returns an array of responses (empty entries from notifications are
 * omitted). For a non-batch single request, this still returns an array
 * of length 0 or 1 — callers should serialize accordingly (single object
 * vs array) based on `parseResult.isBatch`.
 */
export async function dispatchAll(
  handlers: HandlerMap,
  parseResult: ParseResult,
  context?: unknown
): Promise<JsonRpcResponse[]> {
  if (parseResult.parseError) return [parseResult.parseError];
  const results = await Promise.all(parseResult.messages.map((m) => dispatch(handlers, m, context)));
  return results.filter((r): r is JsonRpcResponse => r !== null);
}

// ---- Id correlation helper (for async transports) ----

export interface PendingCall<R = unknown> {
  resolve: (value: R) => void;
  reject: (err: JsonRpcError) => void;
}

/**
 * Tracks in-flight requests by id so an async transport (WebSocket, etc)
 * can correlate incoming responses back to the promise that sent them.
 */
export class IdCorrelator {
  private pending = new Map<JsonRpcId, PendingCall>();

  /** Register a pending call for `id`, returning a promise that resolves/rejects when `resolve`/`reject` is invoked. */
  register<R = unknown>(id: JsonRpcId): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
  }

  /** Feed an incoming response; resolves or rejects the matching pending call, if any. Returns true if a match was found. */
  resolveResponse(response: JsonRpcResponse): boolean {
    const entry = this.pending.get(response.id);
    if (!entry) return false;
    this.pending.delete(response.id);
    if ("error" in response) {
      entry.reject(response.error);
    } else {
      entry.resolve(response.result);
    }
    return true;
  }

  /** Number of calls still awaiting a response. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
