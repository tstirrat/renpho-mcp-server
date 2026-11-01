import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppLogger } from "../src/logger.js";

test("logs only to stderr and writes no files by default", () => {
  const logger = createAppLogger({ level: "info" });
  assert.equal(logger.transports.length, 1);
  const [sink] = logger.transports as unknown as Array<{
    stderrLevels: Record<string, boolean>;
  }>;
  for (const level of Object.keys(logger.levels)) {
    assert.equal(sink.stderrLevels[level], true, `${level} must use stderr`);
  }
  logger.close();
});

test("writes size-capped log files only when a directory is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "renpho-log-"));
  const logger = createAppLogger({ level: "info", logDir: dir });
  try {
    assert.equal(logger.transports.length, 3);
    const flushed = new Promise((resolve) => logger.on("finish", resolve));
    logger.error("boom");
    logger.end();
    await flushed;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(readdirSync(dir).sort(), [
      "renpho-combined.log",
      "renpho-error.log",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
