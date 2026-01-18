/**
 * Processing queue for managing concurrent file processing
 * Uses p-queue for rate limiting and concurrency control
 */
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
export declare class ProcessingQueue {
    private queue;
    private completed;
    private failed;
    /**
     * Creates a new processing queue
     *
     * @param concurrency - Maximum concurrent operations (default: 3)
     * @param intervalMs - Interval for rate limiting in ms (default: 1000)
     * @param intervalCap - Max operations per interval (default: 10)
     */
    constructor(concurrency?: number, intervalMs?: number, intervalCap?: number);
    /**
     * Adds a task to the queue
     *
     * @param task - Async function to execute
     * @returns Promise that resolves when task completes
     */
    add<T>(task: () => Promise<T>): Promise<T>;
    /**
     * Adds multiple tasks and waits for all to complete
     *
     * @param tasks - Array of async functions
     * @returns Promise that resolves when all tasks complete
     */
    addAll<T>(tasks: Array<() => Promise<T>>): Promise<T[]>;
    /**
     * Waits for all pending tasks to complete
     */
    onIdle(): Promise<void>;
    /**
     * Gets current queue statistics
     */
    getStats(): QueueStats;
    /**
     * Clears the queue and resets statistics
     */
    clear(): void;
    /**
     * Pauses the queue
     */
    pause(): void;
    /**
     * Resumes the queue
     */
    start(): void;
    /**
     * Checks if queue is paused
     */
    get isPaused(): boolean;
    /**
     * Gets the underlying p-queue size (pending + running)
     */
    get size(): number;
}
/**
 * Gets or creates the global processing queue
 */
export declare function getProcessingQueue(): ProcessingQueue;
/**
 * Resets the global queue (for testing)
 */
export declare function resetProcessingQueue(): void;
