import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Logger } from "winston";
import type { RenphoApiService } from "./services/renpho-api.js";
import {
  formatUser,
  formatMeasurement,
  formatBodyComposition,
  formatWeightTrend,
  formatMeasurementList,
  formatScaleUsers,
  formatSyncDiagnostics,
  resolveTimeZone,
  filterByTimeOfDay,
  hasTimeFilter,
  parseTimeOfDay,
  type TimeFilter,
} from "./utils/formatting.js";

export const SERVER_NAME = "renpho-mcp-server";
export const SERVER_VERSION = "1.2.1";

// Builds a fully registered MCP server. It owns no transport and no global
// state, so a caller may create one per request (stateless HTTP) or one for
// the process lifetime (stdio) while sharing a single RenphoApiService.
// `timeZone` (IANA name, e.g. "Australia/Brisbane") controls how measurement
// times are printed; it defaults to the host's zone.
const timeFilterShape = {
  before: z
    .string()
    .optional()
    .describe(
      'Only readings taken before this local time of day, "HH:MM" 24h (e.g. "10:00" for fasted morning weigh-ins). Local = the server\'s configured time zone.',
    ),
  after: z
    .string()
    .optional()
    .describe(
      'Only readings taken at or after this local time of day, "HH:MM" 24h. If after is later than before, the window wraps midnight.',
    ),
  first_per_day: z
    .boolean()
    .optional()
    .describe(
      "Keep only the earliest reading of each local day (drops duplicate/evening weigh-ins).",
    ),
};

function toTimeFilter(a: {
  before?: string;
  after?: string;
  first_per_day?: boolean;
}): TimeFilter {
  if (a.before) parseTimeOfDay(a.before);
  if (a.after) parseTimeOfDay(a.after);
  return { before: a.before, after: a.after, firstPerDay: a.first_per_day };
}

export interface ServerOptions {
  timeZone?: string;
}

export function createServer(
  renphoApi: RenphoApiService,
  logger: Pick<Logger, "error">,
  options: ServerOptions = {},
): McpServer {
  const timeZone = resolveTimeZone(options.timeZone);
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.tool(
    "get_current_user",
    "Get current Renpho user information",
    async () => {
      try {
        const user = await renphoApi.getCurrentUser();
        return {
          content: [
            {
              type: "text" as const,
              text: formatUser(user),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get current user", {
          error: (error as Error).message,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_scale_users",
    "Get linked Renpho scale-user IDs and table mappings discovered from the account",
    async () => {
      try {
        const scaleUsers = await renphoApi.getScaleUsers();
        return {
          content: [
            {
              type: "text" as const,
              text: formatScaleUsers(scaleUsers),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get scale users", {
          error: (error as Error).message,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_latest_measurement",
    "Get the most recent body composition measurement from Renpho scale",
    async () => {
      try {
        const measurement = await renphoApi.getLatestMeasurement();
        if (!measurement) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No measurements found.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatMeasurement(measurement, timeZone),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get latest measurement", {
          error: (error as Error).message,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_body_composition",
    "Get detailed body composition analysis with health classifications",
    async () => {
      try {
        const composition = await renphoApi.getBodyComposition();
        if (!composition) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No body composition data available.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatBodyComposition(composition, timeZone),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get body composition", {
          error: (error as Error).message,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_weight_trend",
    {
      days: z
        .number()
        .min(1)
        .max(365)
        .default(30)
        .describe("Number of days to analyze (default: 30)"),
      ...timeFilterShape,
    },
    async (args: {
      days: number;
      before?: string;
      after?: string;
      first_per_day?: boolean;
    }) => {
      const { days } = args;
      try {
        const filter = toTimeFilter(args);
        const trend = await renphoApi.getWeightTrend(
          days,
          hasTimeFilter(filter)
            ? (ms) => filterByTimeOfDay(ms, filter, timeZone)
            : undefined,
        );
        if (!trend) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No weight data available for the past ${days} days.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatWeightTrend(trend, timeZone, filter),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get weight trend", {
          error: (error as Error).message,
          days,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_measurements",
    {
      days: z
        .number()
        .min(1)
        .max(365)
        .default(30)
        .describe("Number of days to retrieve (default: 30)"),
      limit: z
        .number()
        .min(1)
        .max(500)
        .default(100)
        .describe("Maximum number of measurements (default: 100)"),
      ...timeFilterShape,
    },
    async (args: {
      days: number;
      limit: number;
      before?: string;
      after?: string;
      first_per_day?: boolean;
    }) => {
      const { days, limit } = args;
      try {
        const filter = toTimeFilter(args);
        const startTimestamp = Math.floor(
          (Date.now() - days * 24 * 60 * 60 * 1000) / 1000,
        );
        // With a time filter, fetch the widest window first so the limit
        // applies to matching readings rather than to the unfiltered list.
        const filtering = hasTimeFilter(filter);
        const fetched = await renphoApi.getMeasurements(
          undefined,
          startTimestamp,
          filtering ? 500 : limit,
        );
        const measurements = filtering
          ? filterByTimeOfDay(fetched, filter, timeZone).slice(0, limit)
          : fetched;
        return {
          content: [
            {
              type: "text" as const,
              text: formatMeasurementList(measurements, timeZone, filter),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get measurements", {
          error: (error as Error).message,
          days,
          limit,
        });
        throw error;
      }
    },
  );

  server.tool(
    "get_sync_diagnostics",
    {
      days: z
        .number()
        .min(1)
        .max(30)
        .default(7)
        .describe(
          "How many recent days to inspect for hidden or delayed measurements (default: 7). Also reports every raw device/count category on the account (including ones this server does not read yet) and the device model behind each recent measurement.",
        ),
    },
    async ({ days }: { days: number }) => {
      try {
        const diagnostics = await renphoApi.getSyncDiagnostics(days);
        return {
          content: [
            {
              type: "text" as const,
              text: formatSyncDiagnostics(diagnostics, timeZone),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to get sync diagnostics", {
          error: (error as Error).message,
          days,
        });
        throw error;
      }
    },
  );

  server.tool(
    "refresh_data",
    "Clear Renpho auth/measurement caches and re-fetch account state. Useful after taking a new measurement or after the mobile app syncs.",
    async () => {
      try {
        renphoApi.refreshSession();
        const user = await renphoApi.getCurrentUser();
        return {
          content: [
            {
              type: "text" as const,
              text: `Renpho cache cleared and session refreshed for ${user.email}.`,
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to refresh data", {
          error: (error as Error).message,
        });
        throw error;
      }
    },
  );

  server.tool(
    "health_check",
    "Check the health status of the Renpho MCP server and API connection",
    async () => {
      try {
        const user = await renphoApi.getCurrentUser();
        return {
          content: [
            {
              type: "text" as const,
              text: `Renpho MCP Server Health Check\n\nStatus: Healthy\nTimestamp: ${new Date().toISOString()}\nAPI Connection: OK\nUser: ${user.email}\nVersion: ${SERVER_VERSION}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Renpho MCP Server Health Check\n\nStatus: Unhealthy\nTimestamp: ${new Date().toISOString()}\nAPI Connection: Failed\nError: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
