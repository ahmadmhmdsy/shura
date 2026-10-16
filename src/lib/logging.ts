// Logging and metrics utility for Shura app
// Provides structured logging, error tracking, and performance metrics

import { redactExternalError } from "@/lib/security/redact";

export interface LogEntry {
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export interface RunMetrics {
  appStartTime: number;
  sessionCount: number;
  messageCount: number;
  errorCount: number;
  lastError?: { message: string; timestamp: number };
  performanceMarks: Record<string, number>;
}

const METRICS_KEY = "shura-run-metrics";
const MAX_LOG_ENTRIES = 100;

// In-memory log buffer
let logBuffer: LogEntry[] = [];

// Run metrics
let metrics: RunMetrics = {
  appStartTime: Date.now(),
  sessionCount: 0,
  messageCount: 0,
  errorCount: 0,
  performanceMarks: {},
};

// Load metrics from localStorage
function loadMetrics(): void {
  try {
    const stored = localStorage.getItem(METRICS_KEY);
    if (stored) {
      metrics = { ...metrics, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn("[Shura] Failed to load metrics:", e);
  }
}

// Save metrics to localStorage
function saveMetrics(): void {
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
  } catch (e) {
    console.warn("[Shura] Failed to save metrics:", e);
  }
}

// Metrics load lazily on first use rather than at import time, so importing this
// module has no side effect (SSR and test environments included).
let metricsLoaded = false;
function ensureMetricsLoaded(): void {
  if (metricsLoaded) return;
  metricsLoaded = true;
  loadMetrics();
}

// Log a message
export function log(level: LogEntry["level"], message: string, context?: Record<string, unknown>, error?: Error): void {
  ensureMetricsLoaded();
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
    context,
    error,
  };

  // Add to buffer
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }

  // Log to console
  const prefix = `[Shura:${level.toUpperCase()}]`;
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  const errorStr = error ? ` ${redactExternalError(error)}` : "";

  switch (level) {
    case "debug":
      console.debug(prefix, message, contextStr, errorStr);
      break;
    case "info":
      console.info(prefix, message, contextStr, errorStr);
      break;
    case "warn":
      console.warn(prefix, message, contextStr, errorStr);
      break;
    case "error":
      console.error(prefix, message, contextStr, errorStr);
      break;
  }

  // Update error count
  if (level === "error") {
    metrics.errorCount++;
    metrics.lastError = { message: redactExternalError(message), timestamp: Date.now() };
    saveMetrics();
  }
}

// Convenience methods
export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>, error?: Error) => log("error", message, context, error),
};

// Performance marking
export function markPerformance(name: string): void {
  ensureMetricsLoaded();
  metrics.performanceMarks[name] = Date.now();
  saveMetrics();
}

// Get metrics
export function getMetrics(): RunMetrics {
  ensureMetricsLoaded();
  return { ...metrics };
}

// Get log buffer
export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

// Increment session count
export function incrementSessionCount(): void {
  ensureMetricsLoaded();
  metrics.sessionCount++;
  saveMetrics();
}

// Increment message count
export function incrementMessageCount(): void {
  ensureMetricsLoaded();
  metrics.messageCount++;
  saveMetrics();
}

// Reset metrics
export function resetMetrics(): void {
  ensureMetricsLoaded();
  metrics = {
    appStartTime: Date.now(),
    sessionCount: 0,
    messageCount: 0,
    errorCount: 0,
    performanceMarks: {},
  };
  saveMetrics();
}

// Safe execution wrapper with try/catch and logging
export function safeExecute<T>(fn: () => T, context: string, fallback?: T): T {
  try {
    markPerformance(`${context}-start`);
    const result = fn();
    markPerformance(`${context}-end`);
    return result;
  } catch (e) {
    logger.error(`Error in ${context}`, { context }, e as Error);
    return fallback as T;
  }
}

// Async safe execution wrapper
export async function safeExecuteAsync<T>(fn: () => Promise<T>, context: string, fallback?: T): Promise<T> {
  try {
    markPerformance(`${context}-start`);
    const result = await fn();
    markPerformance(`${context}-end`);
    return result;
  } catch (e) {
    logger.error(`Error in ${context}`, { context }, e as Error);
    return fallback as T;
  }
}

// Initialize app logging
let loggingInitialized = false;

/**
 * Idempotent on purpose: main.tsx initialises logging early so pre-render errors are
 * captured, while App keeps its call for tests that render the tree directly.
 * Re-registering the global listeners would report every unhandled error twice.
 */
export function initAppLogging(): void {
  if (loggingInitialized) return;
  loggingInitialized = true;
  markPerformance("app-start");
  logger.info("App started", { version: "0.1.0", userAgent: navigator.userAgent });

  // Log unhandled errors
  window.addEventListener("error", (event) => {
    logger.error("Unhandled error", { filename: event.filename, lineno: event.lineno, colno: event.colno }, event.error);
  });

  // Log unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("Unhandled promise rejection", { reason: redactExternalError(event.reason) });
  });

  // Log page visibility changes
  document.addEventListener("visibilitychange", () => {
    logger.debug("Page visibility changed", { hidden: document.hidden });
  });

  // Log before unload
  window.addEventListener("beforeunload", () => {
    logger.info("App unloading", { ...getMetrics() });
  });
}
