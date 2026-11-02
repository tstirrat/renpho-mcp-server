import { resolveTimeZone } from './utils/formatting.js';

export interface RenphoConfig {
  email: string;
  password: string;
  logLevel: string;
  logDir?: string;
  timeZone?: string;
}

export function loadConfig(): RenphoConfig {
  const email = process.env.RENPHO_EMAIL;
  const password = process.env.RENPHO_PASSWORD;

  if (!email || !password) {
    throw new Error('RENPHO_EMAIL and RENPHO_PASSWORD environment variables are required');
  }

  return {
    email,
    password,
    logLevel: process.env.LOG_LEVEL || 'info',
    logDir: process.env.LOG_DIR || undefined,
    timeZone: resolveTimeZone(process.env.RENPHO_TIMEZONE)
  };
}
