import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { RenphoApiService } from "../src/services/renpho-api.js";

const LOGIN = "renpho-aggregation/user/login";
const DEVICES = "renpho-aggregation/device/count";
const key = Buffer.from("ed*wijdi$h6fe3ew");

function encrypted(raw: string) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  const data = Buffer.concat([cipher.update(raw), cipher.final()]).toString(
    "base64",
  );
  return Response.json({ code: 101, data });
}

function mockRenpho(
  t: TestContext,
  loginReply: () => Response | Promise<Response> = () =>
    encrypted(
      '{"login":{"id":1,"token":"t","email":"fixture@example.invalid"}}',
    ),
) {
  const counts = { login: 0 };
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    const path = String(url).replace("https://cloud.renpho.com/", "");
    if (path === LOGIN) {
      counts.login += 1;
      return loginReply();
    }
    assert.equal(path, DEVICES);
    return encrypted('{"scale":[]}');
  });
  return counts;
}

test("concurrent callers share a single login", async (t) => {
  const counts = mockRenpho(t);
  const service = new RenphoApiService("a@example.invalid", "pw");

  await Promise.all(Array.from({ length: 5 }, () => service.getCurrentUser()));

  assert.equal(counts.login, 1);
});

test("a failed login does not wedge later attempts", async (t) => {
  let attempts = 0;
  const counts = mockRenpho(t, () => {
    attempts += 1;
    return attempts === 1
      ? Response.json({ code: 500 })
      : encrypted('{"login":{"id":1,"token":"t","email":"a@example.invalid"}}');
  });
  const service = new RenphoApiService("a@example.invalid", "pw");

  await assert.rejects(service.getCurrentUser(), /Authentication failed/);
  await service.getCurrentUser();

  assert.equal(counts.login, 2);
});

test("refreshSession reuses a recent login but still clears measurements", async (t) => {
  const counts = mockRenpho(t);
  const service = new RenphoApiService("a@example.invalid", "pw");
  await service.getCurrentUser();

  service.refreshSession();
  await service.getCurrentUser();

  assert.equal(counts.login, 1);
});

test("refreshSession forces a new login once the throttle window has passed", async (t) => {
  const counts = mockRenpho(t);
  const service = new RenphoApiService("a@example.invalid", "pw", {
    minReloginIntervalMs: 0,
  });
  await service.getCurrentUser();

  service.refreshSession();
  await service.getCurrentUser();

  assert.equal(counts.login, 2);
});

test("a session whose login was invalidated mid-flight is not cached", async (t) => {
  const counts = mockRenpho(t);
  const service = new RenphoApiService("a@example.invalid", "pw");

  const pending = service.getCurrentUser();
  service.invalidateCaches();
  await pending;
  await service.getCurrentUser();

  assert.equal(counts.login, 2);
});
