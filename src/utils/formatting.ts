import {
  RenphoMeasurement,
  RenphoBodyComposition,
  RenphoWeightTrend,
  RenphoUser,
  RenphoScaleUser,
  RenphoSyncDiagnostics,
} from "../types/renpho.js";

// Returns the zone unchanged when it is a valid IANA name, undefined for an
// unset/blank value, and throws for anything else so a typo fails at startup
// instead of inside every tool call.
export function resolveTimeZone(timeZone?: string): string | undefined {
  const trimmed = timeZone?.trim();
  if (!trimmed) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    throw new Error(`Invalid time zone: ${trimmed}`);
  }
  return trimmed;
}

// Without an explicit zone this uses the host's, which is UTC on most servers.
// The zone name is always printed so a reader never has to guess.
export function formatDate(timestamp: number, timeZone?: string): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

function localParts(timestamp: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(timestamp * 1000));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  // longOffset yields "GMT", "GMT+10", or "GMT+05:30".
  const raw = get("timeZoneName").replace("GMT", "");
  let offset = "+00:00";
  if (raw) {
    const [h, m = "00"] = raw.slice(1).split(":");
    offset = `${raw[0]}${h.padStart(2, "0")}:${m}`;
  }
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    offset,
  };
}

// Unambiguous ISO 8601 timestamp with the UTC offset, e.g.
// 2026-11-13T06:06:00+10:00, rendered in the configured zone.
export function formatTimestamp(timestamp: number, timeZone?: string): string {
  const p = localParts(timestamp, timeZone);
  return `${p.date}T${p.time}${p.offset}`;
}

// Name of the zone times are rendered in (configured, else the host's).
export function zoneLabel(timeZone?: string): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function parseTimeOfDay(value: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time of day "${value}"; use HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface TimeFilter {
  before?: string; // local HH:MM, exclusive
  after?: string; // local HH:MM, inclusive
  firstPerDay?: boolean; // keep only the earliest reading of each local day
}

export function hasTimeFilter(f?: TimeFilter): boolean {
  return Boolean(f && (f.before || f.after || f.firstPerDay));
}

// Filters by local time of day. `before` is exclusive and `after` inclusive;
// when after > before the window wraps midnight.
export function filterByTimeOfDay<T extends { time_stamp: number }>(
  items: T[],
  filter: TimeFilter | undefined,
  timeZone?: string,
): T[] {
  if (!hasTimeFilter(filter)) return items;
  const before = filter!.before ? parseTimeOfDay(filter!.before) : undefined;
  const after = filter!.after ? parseTimeOfDay(filter!.after) : undefined;
  let out = items.filter((m) => {
    const p = localParts(m.time_stamp, timeZone);
    const t = p.hour * 60 + p.minute;
    if (before !== undefined && after !== undefined && after > before) {
      return t >= after || t < before;
    }
    if (before !== undefined && t >= before) return false;
    if (after !== undefined && t < after) return false;
    return true;
  });
  if (filter!.firstPerDay) {
    const earliest = new Map<string, T>();
    for (const m of out) {
      const day = localParts(m.time_stamp, timeZone).date;
      const cur = earliest.get(day);
      if (!cur || m.time_stamp < cur.time_stamp) earliest.set(day, m);
    }
    out = out.filter((m) => [...earliest.values()].includes(m));
  }
  return out;
}

export function describeTimeFilter(f?: TimeFilter): string {
  const parts: string[] = [];
  if (f?.after) parts.push(`at or after ${f.after}`);
  if (f?.before) parts.push(`before ${f.before}`);
  if (f?.firstPerDay) parts.push("first reading of each day only");
  return parts.join(", ");
}

export function formatUser(user: RenphoUser): string {
  let text = `User: ${user.account_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}\n`;
  text += `Email: ${user.email}\n`;
  if (user.height) text += `Height: ${user.height} cm\n`;
  if (user.weight_goal) text += `Weight Goal: ${user.weight_goal} kg\n`;
  if (user.measure_last_time)
    text += `App Last Measurement Time: ${user.measure_last_time}\n`;
  if (user.measure_last_weight)
    text += `App Last Measurement Weight: ${user.measure_last_weight}\n`;
  return text;
}

export function formatMeasurement(
  m: RenphoMeasurement,
  timeZone?: string,
): string {
  let text = `Date: ${formatDate(m.time_stamp, timeZone)}\n\n`;
  text += `**Core Metrics:**\n`;
  text += `- Weight: ${m.weight?.toFixed(1) || "N/A"} kg\n`;
  text += `- BMI: ${m.bmi?.toFixed(1) || "N/A"}\n`;
  text += `- Body Fat: ${m.bodyfat?.toFixed(1) || "N/A"}%\n`;
  text += `- Muscle Mass: ${m.muscle?.toFixed(1) || "N/A"}%\n`;
  text += `- Water: ${m.water?.toFixed(1) || "N/A"}%\n`;
  text += `- Bone Mass: ${m.bone?.toFixed(1) || "N/A"} kg\n`;

  if (m.visceral_fat || m.bmr || m.metabolic_age || m.body_age) {
    text += `\n**Metabolic:**\n`;
    if (m.visceral_fat) text += `- Visceral Fat: ${m.visceral_fat}\n`;
    if (m.bmr) text += `- BMR: ${m.bmr.toFixed(0)} kcal/day\n`;
    if (m.metabolic_age) text += `- Metabolic Age: ${m.metabolic_age} years\n`;
    else if (m.body_age) text += `- Body Age: ${m.body_age} years\n`;
  }

  if (m.protein || m.subcutaneous_fat || m.skeletal_muscle) {
    text += `\n**Extended:**\n`;
    if (m.protein) text += `- Protein: ${m.protein.toFixed(1)}%\n`;
    if (m.subcutaneous_fat)
      text += `- Subcutaneous Fat: ${m.subcutaneous_fat.toFixed(1)}%\n`;
    if (m.skeletal_muscle)
      text += `- Skeletal Muscle: ${m.skeletal_muscle.toFixed(1)}%\n`;
  }

  if (m.heart_rate) {
    text += `\n**Cardiovascular:**\n`;
    text += `- Heart Rate: ${m.heart_rate} bpm\n`;
    if (m.cardiac_index) text += `- Cardiac Index: ${m.cardiac_index}\n`;
  }

  text += formatAdvancedBodyComposition(m);
  text += `\n**Source:**\n`;
  if (m.measurement_source)
    text += `- Measurement Type: ${m.measurement_source}\n`;
  if (m.device_type) text += `- Device Type: ${m.device_type}\n`;
  if (m.user_id) text += `- Bound User ID: ${m.user_id}\n`;
  if (m.scale_user_id) text += `- Scale User ID: ${m.scale_user_id}\n`;
  if (m.method != null) text += `- Method: ${m.method}\n`;
  if (m.is_auto != null) text += `- Auto Source Flag: ${m.is_auto}\n`;
  if (m.is_new != null) text += `- New Flag: ${m.is_new ? "true" : "false"}\n`;

  return text;
}

function formatAdvancedBodyComposition(m: RenphoMeasurement): string {
  const metrics = Object.entries(m.body_composition || {});
  if (metrics.length === 0) return "";
  // Keep official field names: avoid guessing units for impedance/segment data.
  return (
    `\n**MorphoScan Body Composition (API field names):**\n` +
    metrics.map(([key, value]) => `- ${key}: ${value}\n`).join("")
  );
}

export function formatBodyComposition(
  bc: RenphoBodyComposition,
  timeZone?: string,
): string {
  let text = `**Body Composition Summary**\n`;
  text += `Measured: ${formatDate(bc.measurement.time_stamp, timeZone)}\n\n`;

  text += `| Metric | Value | Status |\n`;
  text += `|--------|-------|--------|\n`;
  text += `| Weight | ${bc.formatted.weight} | - |\n`;
  text += `| BMI | ${bc.formatted.bmi} | ${bc.classifications.bmi_category} |\n`;
  text += `| Body Fat | ${bc.formatted.bodyfat} | ${bc.classifications.bodyfat_category} |\n`;
  text += `| Muscle | ${bc.formatted.muscle} | - |\n`;
  text += `| Water | ${bc.formatted.water} | - |\n`;
  text += `| Bone Mass | ${bc.formatted.bone} | - |\n`;
  text += `| Visceral Fat | ${bc.formatted.visceral_fat} | ${bc.classifications.visceral_fat_category} |\n`;
  text += `| Metabolic Age | ${bc.formatted.metabolic_age} | - |\n`;
  text += `| BMR | ${bc.formatted.bmr} | - |\n`;

  text += formatAdvancedBodyComposition(bc.measurement);
  return text;
}

export function formatWeightTrend(
  trend: RenphoWeightTrend,
  timeZone?: string,
  filter?: TimeFilter,
): string {
  const at = (ts: number) => formatTimestamp(ts, timeZone);
  const changeIcon = trend.change > 0 ? "+" : "";
  const direction =
    trend.change > 0 ? "gained" : trend.change < 0 ? "lost" : "maintained";

  let text = `**Weight Trend (${trend.period})**\n`;
  text += `Times shown in ${zoneLabel(timeZone)}.\n`;
  if (hasTimeFilter(filter))
    text += `Filter: ${describeTimeFilter(filter)} (local time).\n`;
  text += `\n`;
  text += `You ${direction} ${Math.abs(trend.change).toFixed(1)} kg (${changeIcon}${trend.change_percent.toFixed(1)}%)\n\n`;
  text += `| Metric | Value | When |\n`;
  text += `|--------|-------|------|\n`;
  text += `| Start Weight | ${trend.start_weight.toFixed(1)} kg | ${at(trend.start_time)} |\n`;
  text += `| Current Weight | ${trend.end_weight.toFixed(1)} kg | ${at(trend.end_time)} |\n`;
  text += `| Min Weight | ${trend.min_weight.toFixed(1)} kg | ${at(trend.min_time)} |\n`;
  text += `| Max Weight | ${trend.max_weight.toFixed(1)} kg | ${at(trend.max_time)} |\n`;
  text += `| Avg Weight | ${trend.avg_weight.toFixed(1)} kg | - |\n`;
  text += `| Measurements | ${trend.measurement_count} | - |\n`;

  return text;
}

export function formatMeasurementList(
  measurements: RenphoMeasurement[],
  timeZone?: string,
  filter?: TimeFilter,
): string {
  if (measurements.length === 0) {
    return "No measurements found.";
  }

  let text = `**Recent Measurements (${measurements.length})**\n`;
  text += `Times are local time in ${zoneLabel(timeZone)} (ISO 8601 with UTC offset).\n`;
  if (hasTimeFilter(filter))
    text += `Filter: ${describeTimeFilter(filter)} (local time).\n`;
  text += `\n`;
  text += `| Time | Weight | Body Fat | Muscle | BMI | Bound User | Scale User |\n`;
  text += `|------|--------|----------|--------|-----|------------|------------|\n`;

  for (const m of measurements) {
    text += `| ${formatTimestamp(m.time_stamp, timeZone)} | ${m.weight?.toFixed(1) || "-"} kg | ${m.bodyfat?.toFixed(1) || "-"}% | ${m.muscle?.toFixed(1) || "-"}% | ${m.bmi?.toFixed(1) || "-"} | ${m.user_id || "-"} | ${m.scale_user_id || "-"} |\n`;
  }

  return text;
}

export function formatScaleUsers(scaleUsers: RenphoScaleUser[]): string {
  if (scaleUsers.length === 0) {
    return "No scale users found.";
  }

  let text = `**Scale Users (${scaleUsers.length})**\n\n`;
  text += `| Scale User ID | Table | Count |\n`;
  text += `|---------------|-------|-------|\n`;

  for (const scaleUser of scaleUsers) {
    text += `| ${scaleUser.user_id} | ${scaleUser.table_name || "-"} | ${scaleUser.count ?? "-"} |\n`;
  }

  return text;
}

export function formatSyncDiagnostics(
  diagnostics: RenphoSyncDiagnostics,
  timeZone?: string,
): string {
  let text = `**Sync Diagnostics**\n\n`;
  text += `Current user: ${diagnostics.user.account_name || diagnostics.user.email} (${diagnostics.user.id})\n`;
  text += `Scale tables: ${diagnostics.scale_tables.length}\n`;
  text += `Family members: ${diagnostics.family_members.length}\n`;

  if (diagnostics.latest_measurement_age_hours != null) {
    text += `Visible latest age: ${diagnostics.latest_measurement_age_hours.toFixed(1)} hours\n`;
  }

  text += `\n**Scale Tables**\n`;
  if (diagnostics.scale_tables.length === 0) {
    text += `- none discovered\n`;
  }
  for (const table of diagnostics.scale_tables) {
    text += `- ${table.table_name}: ${table.count} records, userIds=[${table.user_ids.join(", ")}]\n`;
  }

  if (diagnostics.device_categories.length > 0) {
    text += `\n**Device Data Categories (raw device/count keys)**\n`;
    for (const category of diagnostics.device_categories) {
      const status = category.handled ? "handled" : "not handled";
      const data = category.has_data ? "has data" : "no data";
      text += `- ${category.category}: ${status}, ${data} — ${category.detail}\n`;
    }
  }

  if (diagnostics.unhandled_device_categories_with_data.length > 0) {
    const names = diagnostics.unhandled_device_categories_with_data.map(
      (category) => category.category,
    );
    text += `\n**⚠ Unhandled device categories with data: ${names.join(", ")}**\n`;
    text += `This account has device data in categories this server does not read yet. `;
    text += `If measurements from a newer device (e.g. MorphoScan) are missing, they are likely stored here — `;
    text += `please include this diagnostics output when reporting the issue.\n`;
  }

  if (diagnostics.measurement_devices.length > 0) {
    text += `\n**Measurement Devices Seen In This Window**\n`;
    for (const device of diagnostics.measurement_devices) {
      const label =
        [device.scale_name, device.internal_model, device.mac]
          .filter(Boolean)
          .join(" / ") || "unknown device";
      text += `- ${label}: ${device.measurement_count} measurements, latest ${formatDate(device.latest_time_stamp, timeZone)}\n`;
    }
  }

  if (diagnostics.family_members.length > 0) {
    text += `\n**Family Members**\n`;
    for (const member of diagnostics.family_members) {
      const name =
        member.account_name ||
        [member.first_name, member.last_name].filter(Boolean).join(" ") ||
        member.email ||
        member.id;
      text += `- ${name} (${member.id || "unknown-id"})\n`;
    }
  }

  text += `\n**Visible Latest Measurement**\n`;
  text += diagnostics.visible_latest_measurement
    ? `${formatMeasurement(diagnostics.visible_latest_measurement, timeZone)}\n`
    : "No visible measurement found.\n";

  text += `\n**Latest Associated Measurement Across All Linked Scale Users**\n`;
  text += diagnostics.latest_associated_measurement
    ? `${formatMeasurement(diagnostics.latest_associated_measurement, timeZone)}\n`
    : "No associated measurements found.\n";

  if (diagnostics.hidden_associated_measurements.length > 0) {
    text += `\n**Associated Measurements Not Currently Selected For Current User**\n`;
    for (const measurement of diagnostics.hidden_associated_measurements) {
      text += `- ${formatDate(measurement.time_stamp, timeZone)} |${measurement.weight?.toFixed(1) || "N/A"} kg | bound=${measurement.user_id || "-"} | scale=${measurement.scale_user_id || "-"}\n`;
    }
  }

  return text;
}
