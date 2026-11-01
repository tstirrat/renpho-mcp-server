import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, SERVER_VERSION } from "../src/server.js";
import type { RenphoApiService } from "../src/services/renpho-api.js";

const logger = { error: () => undefined } as never;

function fakeApi() {
  const calls = { getCurrentUser: 0 };
  const api = {
    getCurrentUser: async () => {
      calls.getCurrentUser += 1;
      return { id: "1", email: "fixture@example.invalid" };
    },
  } as unknown as RenphoApiService;
  return { api, calls };
}

async function connect(server: McpServer) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

test("createServer registers every tool without a transport", async () => {
  const client = await connect(createServer(fakeApi().api, logger));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "get_body_composition",
    "get_current_user",
    "get_latest_measurement",
    "get_measurements",
    "get_scale_users",
    "get_sync_diagnostics",
    "get_weight_trend",
    "health_check",
    "refresh_data",
  ]);
  await client.close();
});

test("independent servers can share one RenphoApiService", async () => {
  const { api, calls } = fakeApi();
  const first = await connect(createServer(api, logger));
  const second = await connect(createServer(api, logger));

  const results = await Promise.all([
    first.callTool({ name: "health_check", arguments: {} }),
    second.callTool({ name: "health_check", arguments: {} }),
  ]);

  assert.equal(calls.getCurrentUser, 2);
  for (const result of results) {
    const [content] = result.content as Array<{ text: string }>;
    assert.match(content.text, new RegExp(`Version: ${SERVER_VERSION}`));
  }
  await Promise.all([first.close(), second.close()]);
});

test("tool input validation still rejects out-of-range arguments", async () => {
  const client = await connect(createServer(fakeApi().api, logger));
  const result = await client
    .callTool({ name: "get_weight_trend", arguments: { days: 9999 } })
    .catch((error: Error) => error);
  const text = JSON.stringify(result);
  assert.match(text, /365/);
  await client.close();
});
