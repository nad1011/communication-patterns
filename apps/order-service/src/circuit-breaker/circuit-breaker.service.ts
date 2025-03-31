/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import * as CircuitBreaker from 'opossum';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers: Map<string, CircuitBreaker> = new Map();

  createBreaker(name: string, options: CircuitBreaker.Options = {}) {
    if (!this.breakers.has(name)) {
      const defaultOptions: CircuitBreaker.Options = {
        timeout: 5000, // If function takes longer than 5 seconds, trigger a failure
        errorThresholdPercentage: 50, // When 50% of requests fail, trip the circuit
        resetTimeout: 10000, // After 10 seconds, try again
        rollingCountTimeout: 10000, // Sets the duration of the statistical rolling window
        rollingCountBuckets: 10, // Sets the number of buckets the rolling window is divided into
        ...options,
      };

      const breaker = new CircuitBreaker(async function <
        T,
        Args extends unknown[],
      >(fn: (...args: Args) => Promise<T> | T, ...args: Args): Promise<T> {
        return fn(...args) as Promise<T>;
      }, defaultOptions);

      breaker?.on('open', () => {
        this.logger.warn(`Circuit Breaker '${name}' is open`);
      });

      breaker?.on('close', () => {
        this.logger.log(`Circuit Breaker '${name}' is closed`);
      });

      breaker?.on('halfOpen', () => {
        this.logger.log(`Circuit Breaker '${name}' is half open`);
      });

      breaker?.on('fallback', () => {
        this.logger.warn(`Circuit Breaker '${name}' fallback called`);
      });

      this.breakers.set(name, breaker);
    }

    return this.breakers.get(name);
  }

  async fire<T, Args extends unknown[]>(
    name: string,
    fn: (...args: Args) => Promise<T> | T,
    ...args: Args
  ): Promise<T> {
    const breaker = this.createBreaker(name);
    return (await breaker.fire(fn, ...args)) as T;
  }

  getState(name: string): string {
    const breaker = this.breakers.get(name);
    if (!breaker) return 'UNKNOWN';
    return breaker.toJSON().state.name;
  }

  getStats(name: string) {
    const breaker = this.breakers.get(name);
    if (!breaker) return null;
    return breaker.stats;
  }
}
