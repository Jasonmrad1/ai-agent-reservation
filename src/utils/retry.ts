export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  onRetry?: (error: any, attempt: number) => void;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const backoffFactor = options.backoffFactor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 5000;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt > maxRetries) {
        throw error;
      }

      if (options.onRetry) {
        options.onRetry(error, attempt);
      }

      // Calculate exponential backoff with jitter
      const exponentialDelay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
      const jitter = cappedDelay * 0.2 * (Math.random() - 0.5); // ±10% jitter
      const delay = Math.max(0, cappedDelay + jitter);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
