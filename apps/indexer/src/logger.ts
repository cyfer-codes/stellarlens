/**
 * Minimal structured JSON logger for the indexer.
 *
 * Emits one JSON object per line: `{ level, msg, ...context }`.
 * No external dependency is used; this keeps the change dependency-free
 * pending maintainer sign-off on a logging library.
 *
 * Level filtering is controlled by the `LOG_LEVEL` env var
 * (`debug` | `info` | `warn` | `error`), defaulting to `info`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = 'info';

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
  );
}

function resolveLevelFromEnv(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (isLogLevel(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_LEVEL;
}

let currentLevel: LogLevel = resolveLevelFromEnv();

/**
 * Set the active log level. Useful for tests and for runtime reconfiguration.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the currently active log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Re-read `LOG_LEVEL` from the environment and apply it.
 */
export function refreshLogLevelFromEnv(): LogLevel {
  currentLevel = resolveLevelFromEnv();
  return currentLevel;
}

/**
 * A sink receives the already-serialized JSON line and the level.
 * Defaults to writing to stdout/stderr.
 */
export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
};

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function normalizeContext(context?: LogContext): LogContext {
  if (!context) {
    return {};
  }
  const normalized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    normalized[key] = serializeError(value);
  }
  return normalized;
}

/**
 * Create a logger. By default it uses the module-level level and the
 * default sink. Tests can pass a custom sink to capture output.
 */
export function createLogger(options?: {
  level?: LogLevel;
  sink?: LogSink;
}): Logger {
  const sink = options?.sink ?? defaultSink;
  const fixedLevel = options?.level;

  const emit = (level: LogLevel, msg: string, context?: LogContext): void => {
    const activeLevel = fixedLevel ?? currentLevel;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel]) {
      return;
    }

    const entry: Record<string, unknown> = {
      level,
      msg,
      ...normalizeContext(context),
    };

    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      // Fallback for circular or otherwise unserializable context.
      line = JSON.stringify({
        level,
        msg,
        logError: 'failed to serialize log context',
      });
    }

    sink(line, level);
  };

  return {
    debug: (msg, context) => emit('debug', msg, context),
    info: (msg, context) => emit('info', msg, context),
    warn: (msg, context) => emit('warn', msg, context),
    error: (msg, context) => emit('error', msg, context),
  };
}

/**
 * Shared logger instance used across the indexer.
 */
export const logger: Logger = createLogger();