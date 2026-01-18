/**
 * Processing queue for managing concurrent file processing
 * Uses p-queue for rate limiting and concurrency control
 */
import PQueue from 'p-queue';
/**
 * Processing queue with rate limiting
 */
export class ProcessingQueue {
    queue;
    completed = 0;
    failed = 0;
    /**
     * Creates a new processing queue
     *
     * @param concurrency - Maximum concurrent operations (default: 3)
     * @param intervalMs - Interval for rate limiting in ms (default: 1000)
     * @param intervalCap - Max operations per interval (default: 10)
     */
    constructor(concurrency = 3, intervalMs = 1000, intervalCap = 10) {
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
    async add(task) {
        try {
            const result = await this.queue.add(task);
            this.completed++;
            return result;
        }
        catch (error) {
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
    async addAll(tasks) {
        return Promise.all(tasks.map(task => this.add(task)));
    }
    /**
     * Waits for all pending tasks to complete
     */
    async onIdle() {
        await this.queue.onIdle();
    }
    /**
     * Gets current queue statistics
     */
    getStats() {
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
    clear() {
        this.queue.clear();
        this.completed = 0;
        this.failed = 0;
    }
    /**
     * Pauses the queue
     */
    pause() {
        this.queue.pause();
    }
    /**
     * Resumes the queue
     */
    start() {
        this.queue.start();
    }
    /**
     * Checks if queue is paused
     */
    get isPaused() {
        return this.queue.isPaused;
    }
    /**
     * Gets the underlying p-queue size (pending + running)
     */
    get size() {
        return this.queue.size;
    }
}
/**
 * Global processing queue instance
 */
let globalQueue = null;
/**
 * Gets or creates the global processing queue
 */
export function getProcessingQueue() {
    if (!globalQueue) {
        globalQueue = new ProcessingQueue();
    }
    return globalQueue;
}
/**
 * Resets the global queue (for testing)
 */
export function resetProcessingQueue() {
    if (globalQueue) {
        globalQueue.clear();
    }
    globalQueue = null;
}
