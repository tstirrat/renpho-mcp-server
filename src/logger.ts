import { join } from "node:path";
import { createLogger, format, transports, type Logger } from "winston";

const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 3;

export interface LoggerOptions {
  level: string;
  logDir?: string;
}

// stdout carries the MCP protocol under the stdio transport, so every level
// goes to stderr. File logging is opt-in (LOG_DIR) and size-capped, so a
// service manager's working directory is never written to implicitly.
export function createAppLogger({ level, logDir }: LoggerOptions): Logger {
  const sinks: Logger["transports"] = [
    new transports.Console({
      stderrLevels: [
        "error",
        "warn",
        "info",
        "http",
        "verbose",
        "debug",
        "silly",
      ],
    }),
  ];

  if (logDir) {
    const rotation = {
      maxsize: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
      tailable: true,
    };
    sinks.push(
      new transports.File({
        filename: join(logDir, "renpho-error.log"),
        level: "error",
        ...rotation,
      }),
      new transports.File({
        filename: join(logDir, "renpho-combined.log"),
        ...rotation,
      }),
    );
  }

  return createLogger({
    level,
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: sinks,
  });
}
