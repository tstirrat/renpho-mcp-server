import test from "node:test";
import assert from "node:assert/strict";
import { RenphoApiService } from "../src/services/renpho-api.js";

function hangUntilAborted(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

test("a hung Renpho request fails with a timeout instead of waiting forever", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", hangUntilAborted);
  const service = new RenphoApiService("a@example.invalid", "pw", {
    requestTimeoutMs: 20,
  });

  await assert.rejects(
    service.getCurrentUser(),
    /Request timed out calling renpho-aggregation\/user\/login/,
  );
  assert.ok(
    fetchMock.mock.calls[0].arguments[1]?.signal instanceof AbortSignal,
  );
});

test("non-timeout network failures keep the generic message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed: secret-host.internal");
  });
  const service = new RenphoApiService("a@example.invalid", "pw");

  await assert.rejects(
    service.getCurrentUser(),
    (error: Error) =>
      error.message === "Network error calling renpho-aggregation/user/login",
  );
});
