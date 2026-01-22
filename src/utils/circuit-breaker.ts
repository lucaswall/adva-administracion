/**
 * Circuit Breaker pattern implementation for external API resilience
 * Prevents cascading failures when external services are down
 */

import type { Result } from '../types/index.js';
import { warn, info, debug } from './logger.js';
import { getCorrelationId } from './correlation.js';

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Name of the service (for logging) */
  name: string;
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close the circuit */
  resetTimeoutMs: number;
  /** Number of successful calls needed to close the circuit from half-open */
  successThreshold: number;
  /** Optional callback when state changes */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  successThreshold: 2,
};

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly timeUntilRetry: number
  ) {
    super(`Circuit breaker is open for ${serviceName}. Retry in ${Math.ceil(timeUntilRetry / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit Breaker implementation
 * Protects against cascading failures from external service outages
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number | null = null;
  private totalCalls: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Gets current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Gets the current state of the circuit
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Checks if the circuit should transition from open to half-open
   */
  private checkStateTransition(): void {
    if (this.state === 'open' && this.lastFailureTime) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
      }
    }
  }

  /**
   * Transitions to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      info(`Circuit breaker state change: ${oldState} -> ${newState}`, {
        module: 'circuit-breaker',
        service: this.config.name,
        correlationId: getCorrelationId(),
      });

      this.config.onStateChange?.(this.config.name, oldState, newState);
    }
  }

  /**
   * Records a successful call
   */
  private recordSuccess(): void {
    this.totalSuccesses++;
    this.successes++;
    this.failures = 0;

    if (this.state === 'half-open') {
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
        this.successes = 0;
      }
    }
  }

  /**
   * Records a failed call
   */
  private recordFailure(error: Error): void {
    this.totalFailures++;
    this.failures++;
    this.successes = 0;
    this.lastFailureTime = Date.now();

    warn(`Circuit breaker recorded failure`, {
      module: 'circuit-breaker',
      service: this.config.name,
      failures: this.failures,
      threshold: this.config.failureThreshold,
      error: error.message,
      correlationId: getCorrelationId(),
    });

    if (this.state === 'half-open') {
      // Immediate trip back to open on any failure in half-open state
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Executes a function with circuit breaker protection
   *
   * @param fn - The async function to execute
   * @returns Result with the function return value or error
   */
  async execute<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
    this.totalCalls++;
    this.checkStateTransition();

    // Check if circuit is open
    if (this.state === 'open') {
      const timeUntilRetry = this.lastFailureTime
        ? this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime)
        : 0;

      debug('Circuit breaker rejected call - circuit is open', {
        module: 'circuit-breaker',
        service: this.config.name,
        timeUntilRetry,
        correlationId: getCorrelationId(),
      });

      return {
        ok: false,
        error: new CircuitOpenError(this.config.name, Math.max(0, timeUntilRetry)),
      };
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return { ok: true, value: result };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordFailure(err);
      return { ok: false, error: err };
    }
  }

  /**
   * Manually resets the circuit breaker to closed state
   * Use with caution - typically for testing or manual intervention
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;

    info('Circuit breaker manually reset', {
      module: 'circuit-breaker',
      service: this.config.name,
    });
  }
}

/**
 * Registry of circuit breakers for different services
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Gets or creates a circuit breaker for a service
 *
 * @param name - Service name
 * @param config - Optional configuration overrides
 * @returns CircuitBreaker instance
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<Omit<CircuitBreakerConfig, 'name'>>
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);

  if (!breaker) {
    breaker = new CircuitBreaker({ name, ...config });
    circuitBreakers.set(name, breaker);
  }

  return breaker;
}

/**
 * Gets all circuit breaker statistics
 * Useful for health checks and monitoring
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of circuitBreakers) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

/**
 * Resets all circuit breakers (for testing)
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
}
