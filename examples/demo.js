const {
  buildRequest,
  buildNotification,
  parseMessage,
  dispatchAll,
  ErrorCodes,
} = require("../dist/index.js");

const handlers = {
  add: (params) => params.a + params.b,
  echo: (params) => params,
  boom: () => {
    throw new Error("handler exploded");
  },
};

async function main() {
  // Single request round-trip
  const req = buildRequest("add", { a: 2, b: 3 }, 1);
  const raw = JSON.stringify(req);
  console.log("request:", raw);
  const parsed = parseMessage(raw);
  const responses = await dispatchAll(handlers, parsed);
  console.log("response:", JSON.stringify(responses[0]));

  // Batch: request + notification + error-producing call + unknown method
  const batch = [
    buildRequest("add", { a: 10, b: 20 }, "b1"),
    buildNotification("echo", { ignored: true }), // no response expected
    buildRequest("boom", undefined, "b2"),
    buildRequest("nonexistent", undefined, "b3"),
  ];
  const batchRaw = JSON.stringify(batch);
  const batchParsed = parseMessage(batchRaw);
  const batchResponses = await dispatchAll(handlers, batchParsed);
  console.log("batch responses count:", batchResponses.length, "(4 sent, 1 notification -> 3 responses)");
  console.log(JSON.stringify(batchResponses, null, 2));

  // Malformed input -> parse error
  const badParse = parseMessage("{not valid json");
  console.log("parse error code:", badParse.parseError.error.code, "===", ErrorCodes.ParseError);

  // Malformed message (missing jsonrpc version) -> validation error via dispatch
  const invalidMsgParsed = parseMessage(JSON.stringify({ method: "add", id: 99 }));
  const invalidResponses = await dispatchAll(handlers, invalidMsgParsed);
  console.log("invalid request error:", JSON.stringify(invalidResponses[0]));
}

main();
