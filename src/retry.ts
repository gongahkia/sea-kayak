import { setTimeout as sleep } from "node:timers/promises";

export class ScrapeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class RetryableError extends ScrapeError {}
export class TerminalError extends ScrapeError {}

export function classifyHttpStatus(status: number): typeof ScrapeError {
  return status === 429 || (status >= 500 && status < 600) ? RetryableError : TerminalError;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<unknown>;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

export async function retry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1, maxDelay = 30, random = Math.random } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= maxAttempts) throw error;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay) * (0.75 + random() * 0.5);
      try { options.onRetry?.(error, attempt, delay); } catch { /* Reporting cannot stop a retry. */ }
      await (options.sleep ?? sleep)(delay * 1000);
    }
  }
}

export type OutcomeStatus = "pending" | "first_try" | "retried_ok" | "retried_fail" | "terminal";
export interface Outcome {
  status: OutcomeStatus;
  attempts: number;
  error: string;
  retries: { attempt: number; error: string; delay_s: number }[];
}

export class FeedOutcomes {
  readonly records: Record<string, Outcome> = Object.create(null);

  private record(url: string): Outcome {
    return this.records[url] ??= { status: "pending", attempts: 0, retries: [], error: "" };
  }

  recordAttempt(url: string, attempt: number, error: unknown, delay: number): void {
    this.record(url).retries.push({ attempt, error: errorText(error), delay_s: Math.round(delay * 100) / 100 });
  }

  recordResult(url: string, status: OutcomeStatus, attempts: number, error = ""): void {
    Object.assign(this.record(url), { status, attempts, ...(error ? { error } : {}) });
  }

  summary() {
    const urls = (status: OutcomeStatus) => Object.keys(this.records).filter(url => this.records[url].status === status);
    return {
      first_try: urls("first_try"), retried_ok: urls("retried_ok"),
      retried_fail: urls("retried_fail"), terminal: urls("terminal"), details: this.records,
    };
  }
}
