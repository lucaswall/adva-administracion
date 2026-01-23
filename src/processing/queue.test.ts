/**
 * Tests for processing queue
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessingQueue } from './queue.js';

describe('ProcessingQueue', () => {
  let queue: ProcessingQueue;

  beforeEach(() => {
    queue = new ProcessingQueue(2); // concurrency of 2 for testing
  });

  afterEach(() => {
    queue.clear();
  });

  describe('getStats', () => {
    it('should show correct stats when queue is empty', () => {
      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.running).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('should track completed tasks', async () => {
      await queue.add(async () => {
        return 'done';
      });

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('should track failed tasks', async () => {
      await expect(
        queue.add(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      const stats = queue.getStats();
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(1);
    });

    it('should show running and pending tasks correctly', async () => {
      // Add tasks that will block
      let resolveBlocker: () => void;
      const blocker = new Promise<void>((resolve) => {
        resolveBlocker = resolve;
      });

      // Add 3 tasks with concurrency of 2
      // First 2 should be running, 3rd should be pending
      const promise1 = queue.add(async () => {
        await blocker;
        return 'task1';
      });

      const promise2 = queue.add(async () => {
        await blocker;
        return 'task2';
      });

      const promise3 = queue.add(async () => {
        await blocker;
        return 'task3';
      });

      // Give queue time to start processing
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queue.getStats();

      // With concurrency 2:
      // - 2 tasks should be running
      // - 1 task should be pending (waiting)
      expect(stats.running).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.completed).toBe(0);

      // Release blocker and wait for completion
      resolveBlocker!();
      await Promise.all([promise1, promise2, promise3]);

      const finalStats = queue.getStats();
      expect(finalStats.running).toBe(0);
      expect(finalStats.pending).toBe(0);
      expect(finalStats.completed).toBe(3);
    });

    it('should never show negative running count', async () => {
      let resolveBlocker: () => void;
      const blocker = new Promise<void>((resolve) => {
        resolveBlocker = resolve;
      });

      // Add multiple tasks
      const promises = Array.from({ length: 5 }, (_, i) =>
        queue.add(async () => {
          await blocker;
          return `task${i}`;
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queue.getStats();

      // Running should always be >= 0
      expect(stats.running).toBeGreaterThanOrEqual(0);
      expect(stats.pending).toBeGreaterThanOrEqual(0);

      resolveBlocker!();
      await Promise.all(promises);
    });
  });

  describe('addAll', () => {
    it('should process all tasks and track stats', async () => {
      const tasks = [
        async () => 1,
        async () => 2,
        async () => 3,
      ];

      const results = await queue.addAll(tasks);

      expect(results).toEqual([1, 2, 3]);

      const stats = queue.getStats();
      expect(stats.completed).toBe(3);
      expect(stats.failed).toBe(0);
    });

    it('should track failed tasks in batch', async () => {
      const tasks = [
        async () => 1,
        async () => {
          throw new Error('fail');
        },
        async () => 3,
      ];

      await expect(queue.addAll(tasks)).rejects.toThrow('fail');

      const stats = queue.getStats();
      // One task failed, but the successful ones still completed
      expect(stats.failed).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should reset all statistics', async () => {
      await queue.add(async () => 'test');

      expect(queue.getStats().completed).toBe(1);

      queue.clear();

      const stats = queue.getStats();
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.running).toBe(0);
    });
  });

  describe('pause and start', () => {
    it('should pause and resume queue', async () => {
      queue.pause();
      expect(queue.isPaused).toBe(true);

      queue.start();
      expect(queue.isPaused).toBe(false);
    });
  });
});
