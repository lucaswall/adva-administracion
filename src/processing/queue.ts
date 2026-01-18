/**
 * Processing queue for managing concurrent file processing
 * Uses p-queue for rate limiting and concurrency control
 */

import PQueue from 'p-queue';

/**
 * Queue statistics
 */
export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

/**
 * Processing queue with rate limiting
 */
export class ProcessingQueue {
  private queue: PQueue;
  private completed: number = 0;
  private failed: number = 0;

  /**
   * Creates a new processing queue
   *
   * @param concurrency - Maximum concurrent operations (default: 3)
   * @param intervalMs - Interval for rate limiting in ms (default: 1000)
   * @param intervalCap - Max operations per interval (default: 10)
   */
  constructor(
    concurrency: number = 3,
    intervalMs: number = 1000,
    intervalCap: number = 10
  ) {
    this.queue = new PQueue({
      concurrency,
      interval: intervalMs,
      intervalCap,
    });
  }

  /**
   * Adds a task to the queue
   *
   * @param task - Async function to execute
   * @returns Promise that resolves when task completes
   */
  async add<T>(task: () => Promise<T>): Promise<T> {
    try {
      const result = await this.queue.add(task);
      this.completed++;
      return result as T;
    } catch (error) {
      this.failed++;
      throw error;
    }
  }

  /**
   * Adds multiple tasks and waits for all to complete
   *
   * @param tasks - Array of async functions
   * @returns Promise that resolves when all tasks complete
   */
  async addAll<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(tasks.map(task => this.add(task)));
  }

  /**
   * Waits for all pending tasks to complete
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Gets current queue statistics
   */
  getStats(): QueueStats {
    return {
      pending: this.queue.pending,
      running: this.queue.size - this.queue.pending,
      completed: this.completed,
      failed: this.failed,
    };
  }

  /**
   * Clears the queue and resets statistics
   */
  clear(): void {
    this.queue.clear();
    this.completed = 0;
    this.failed = 0;
  }

  /**
   * Pauses the queue
   */
  pause(): void {
    this.queue.pause();
  }

  /**
   * Resumes the queue
   */
  start(): void {
    this.queue.start();
  }

  /**
   * Checks if queue is paused
   */
  get isPaused(): boolean {
    return this.queue.isPaused;
  }

  /**
   * Gets the underlying p-queue size (pending + running)
   */
  get size(): number {
    return this.queue.size;
  }
}

/**
 * Global processing queue instance
 */
let globalQueue: ProcessingQueue | null = null;

/**
 * Gets or creates the global processing queue
 */
export function getProcessingQueue(): ProcessingQueue {
  if (!globalQueue) {
    globalQueue = new ProcessingQueue();
  }
  return globalQueue;
}

/**
 * Resets the global queue (for testing)
 */
export function resetProcessingQueue(): void {
  if (globalQueue) {
    globalQueue.clear();
  }
  globalQueue = null;
}
