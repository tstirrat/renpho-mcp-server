import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBodyComposition,
  formatDate,
  formatMeasurement,
  formatMeasurementList,
  resolveTimeZone,
} from "../src/utils/formatting.js";
import type {
  RenphoBodyComposition,
  RenphoMeasurement,
} from "../src/types/renpho.js";

for (const count of [0, 1, 20, 21, 100, 500]) {
  test(`formatMeasurementList renders all ${count} selected measurements`, () => {
    const measurements: RenphoMeasurement[] = Array.from(
      { length: count },
      (_, index) => ({
        id: `measurement-${index}`,
        time_stamp: 1_735_732_800 - index * 86_400,
        weight: 70 + index / 10,
        bodyfat: 20,
        muscle: 40,
        bmi: 22,
        user_id: `user-${index}`,
        scale_user_id: `scale-${index}`,
      }),
    );
    const original = structuredClone(measurements);

    const text = formatMeasurementList(measurements);

    assert.deepEqual(
      measurements,
      original,
      "formatting must not mutate the selected history",
    );

    if (count === 0) {
      assert.equal(text, "No measurements found.");
      return;
    }

    assert.ok(text.startsWith(`**Recent Measurements (${count})**\n\n`));
    const rows = text
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .slice(1);
    const expectedRows = measurements.map((measurement) => {
      const date = formatDate(measurement.time_stamp).split(",")[0];
      return `| ${date} | ${measurement.weight.toFixed(1)} kg | 20.0% | 40.0% | 22.0 | ${measurement.user_id} | ${measurement.scale_user_id} |`;
    });

    assert.equal(rows.length, count);
    assert.deepEqual(
      rows,
      expectedRows,
      "every row must appear exactly once in input order",
    );
    assert.ok(
      text.endsWith(`${expectedRows[count - 1]}\n`),
      "the final selected row must be present",
    );
    assert.doesNotMatch(text, /more measurements/);
  });
}

// 2026-11-01 20:31 UTC is 06:31 the next morning in Brisbane (UTC+10, no DST).
const READING = Date.UTC(2026, 10, 1, 20, 31) / 1000;

function normalise(text: string): string {
  return text.replace(/\s/g, " ");
}

test("formatDate prints the zone name and honours an explicit zone", () => {
  assert.equal(
    normalise(formatDate(READING, "UTC")),
    "Nov 1, 2026, 08:31 PM UTC",
  );
  assert.equal(
    normalise(formatDate(READING, "Australia/Brisbane")),
    "Nov 2, 2026, 06:31 AM GMT+10",
  );
});

test("formatMeasurementList buckets rows by day in the requested zone", () => {
  const measurement: RenphoMeasurement = {
    id: "m1",
    time_stamp: READING,
    weight: 70,
  };
  assert.match(formatMeasurementList([measurement], "UTC"), /\| Nov 1 \|/);
  assert.match(
    formatMeasurementList([measurement], "Australia/Brisbane"),
    /\| Nov 2 \|/,
  );
});

test("formatMeasurement and body composition use the requested zone", () => {
  const measurement: RenphoMeasurement = {
    id: "m1",
    time_stamp: READING,
    weight: 70,
  };
  assert.match(
    normalise(formatMeasurement(measurement, "Australia/Brisbane")),
    /^Date: Nov 2, 2026, 06:31 AM GMT\+10/,
  );
  assert.match(
    normalise(
      formatBodyComposition(
        {
          measurement,
          formatted: {},
          classifications: {},
        } as unknown as RenphoBodyComposition,
        "UTC",
      ),
    ),
    /Measured: Nov 1, 2026, 08:31 PM UTC/,
  );
});

test("resolveTimeZone accepts IANA names, ignores blanks and rejects typos", () => {
  assert.equal(resolveTimeZone(" Australia/Brisbane "), "Australia/Brisbane");
  assert.equal(resolveTimeZone(undefined), undefined);
  assert.equal(resolveTimeZone("  "), undefined);
  assert.throws(() => resolveTimeZone("Mars/Olympus"), /Invalid time zone/);
});
