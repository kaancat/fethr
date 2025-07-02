/**
 * Simple circuit breaker implementation to prevent repeated API failures
 */

interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenAttempts: number;

  constructor(
    failureThreshold = 3,
    resetTimeout = 60000, // 1 minute
    halfOpenAttempts = 1
  ) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.halfOpenAttempts = halfOpenAttempts;
  }

  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    const state = this.getState(key);
    
    if (state.state === 'open') {
      const timeSinceLastFailure = Date.now() - state.lastFailureTime;
      
      if (timeSinceLastFailure < this.resetTimeout) {
        console.log(`[CircuitBreaker] ${key} is OPEN, using fallback`);
        if (fallback) {
          return fallback();
        }
        throw new Error(`Circuit breaker is OPEN for ${key}`);
      } else {
        // Move to half-open state
        console.log(`[CircuitBreaker] ${key} moving to HALF-OPEN`);
        state.state = 'half-open';
      }
    }

    try {
      const result = await fn();
      
      // Success - reset the circuit
      if (state.state === 'half-open' || state.failureCount > 0) {
        console.log(`[CircuitBreaker] ${key} succeeded, resetting circuit`);
        this.reset(key);
      }
      
      return result;
    } catch (error) {
      this.recordFailure(key);
      
      if (state.failureCount >= this.failureThreshold) {
        console.log(`[CircuitBreaker] ${key} reached failure threshold, opening circuit`);
        state.state = 'open';
      }
      
      if (fallback && state.state === 'open') {
        return fallback();
      }
      
      throw error;
    }
  }

  private getState(key: string): CircuitBreakerState {
    if (!this.states.has(key)) {
      this.states.set(key, {
        failureCount: 0,
        lastFailureTime: 0,
        state: 'closed'
      });
    }
    return this.states.get(key)!;
  }

  private recordFailure(key: string) {
    const state = this.getState(key);
    state.failureCount++;
    state.lastFailureTime = Date.now();
  }

  private reset(key: string) {
    const state = this.getState(key);
    state.failureCount = 0;
    state.lastFailureTime = 0;
    state.state = 'closed';
  }

  isOpen(key: string): boolean {
    const state = this.getState(key);
    return state.state === 'open';
  }

  getFailureCount(key: string): number {
    return this.getState(key).failureCount;
  }
}

// Export singleton instance
export const circuitBreaker = new CircuitBreaker();

// Export convenience functions
export async function withCircuitBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  return circuitBreaker.execute(key, fn, fallback);
}