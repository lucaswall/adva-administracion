/**
 * Unit tests for processing queue
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProcessingQueue,
  getProcessingQueue,
  resetProcessingQueue,
} from '../../../src/processing/queue.js';

describe('ProcessingQueue', () => {
  let queue: ProcessingQueue;

  beforeEach(() => {
    queue = new ProcessingQueue();
  });

  afterEach(() => {
    queue.clear();
  });

  describe('constructor', () => {
    it('creates queue with default settings', () => {
      const q = new ProcessingQueue();
      expect(q).toBeDefined();
      expect(q.isPaused).toBe(false);
      expect(q.size).toBe(0);
    });

    it('accepts custom concurrency', () => {
      const q = new ProcessingQueue(5);
      expect(q).toBeDefined();
    });

    it('accepts custom interval settings', () => {
      const q = new ProcessingQueue(3, 2000, 5);
      expect(q).toBeDefined();
    });
  });

  describe('add', () => {
    it('executes task and increments completed count', async () => {
      const task = vi.fn(async () => 'result');

      const result = await queue.add(task);

      expect(result).toBe('result');
      expect(task).toHaveBeenCalledOnce();
      expect(queue.getStats().completed).toBe(1);
      expect(queue.getStats().failed).toBe(0);
    });

    it('increments failed count on error', async () => {
      const task = vi.fn(async () => {
        throw new Error('Task failed');
      });

      await expect(queue.add(task)).rejects.toThrow('Task failed');

      expect(queue.getStats().completed).toBe(0);
      expect(queue.getStats().failed).toBe(1);
    });

    it('executes multiple tasks sequentially', async () => {
      const results: number[] = [];
      const task1 = async () => { results.push(1); return 1; };
      const task2 = async () => { results.push(2); return 2; };
      const task3 = async () => { results.push(3); return 3; };

      await Promise.all([
        queue.add(task1),
        queue.add(task2),
        queue.add(task3),
      ]);

      expect(results).toHaveLength(3);
      expect(queue.getStats().completed).toBe(3);
    });

    it('respects concurrency limits', async () => {
      const q = new ProcessingQueue(1); // Only 1 concurrent task
      const executionOrder: number[] = [];

      const createTask = (id: number) => async () => {
        executionOrder.push(id);
        await new Promise(resolve => setTimeout(resolve, 10));
        return id;
      };

      const promises = [
        q.add(createTask(1)),
        q.add(createTask(2)),
        q.add(createTask(3)),
      ];

      await Promise.all(promises);

      // With concurrency 1, tasks run one at a time
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(q.getStats().completed).toBe(3);
    });
  });

  describe('addAll', () => {
    it('executes multiple tasks', async () => {
      const tasks = [
        async () => 1,
        async () => 2,
        async () => 3,
      ];

      const results = await queue.addAll(tasks);

      expect(results).toEqual([1, 2, 3]);
      expect(queue.getStats().completed).toBe(3);
    });

    it('returns results in order', async () => {
      const tasks = [
        async () => 'first',
        async () => 'second',
        async () => 'third',
      ];

      const results = await queue.addAll(tasks);

      expect(results[0]).toBe('first');
      expect(results[1]).toBe('second');
      expect(results[2]).toBe('third');
    });

    it('handles empty array', async () => {
      const results = await queue.addAll([]);

      expect(results).toEqual([]);
      expect(queue.getStats().completed).toBe(0);
    });

    it('fails if any task fails', async () => {
      const tasks = [
        async () => 1,
        async () => { throw new Error('Failed'); },
        async () => 3,
      ];

      await expect(queue.addAll(tasks)).rejects.toThrow('Failed');

      expect(queue.getStats().failed).toBeGreaterThan(0);
    });
  });

  describe('onIdle', () => {
    it('resolves when queue is empty', async () => {
      const task = async () => 'done';

      queue.add(task);
      await queue.onIdle();

      expect(queue.size).toBe(0);
    });

    it('waits for running tasks to complete', async () => {
      let taskCompleted = false;
      const task = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        taskCompleted = true;
        return 'done';
      };

      queue.add(task);
      await queue.onIdle();

      expect(taskCompleted).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns correct initial stats', () => {
      const stats = queue.getStats();

      expect(stats.pending).toBe(0);
      expect(stats.running).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('returns correct completed count', async () => {
      await queue.add(async () => 'done');

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
    });

    it('returns correct failed count', async () => {
      await queue.add(async () => { throw new Error('fail'); }).catch(() => {});

      const stats = queue.getStats();
      expect(stats.failed).toBe(1);
    });

    it('tracks both completed and failed', async () => {
      await queue.add(async () => 'success');
      await queue.add(async () => { throw new Error('fail'); }).catch(() => {});
      await queue.add(async () => 'success2');

      const stats = queue.getStats();
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
    });
  });

  describe('pause and start', () => {
    it('pauses queue processing', () => {
      queue.pause();

      expect(queue.isPaused).toBe(true);
    });

    it('resumes queue processing', () => {
      queue.pause();
      queue.start();

      expect(queue.isPaused).toBe(false);
    });

    it('reports isPaused correctly', () => {
      expect(queue.isPaused).toBe(false);

      queue.pause();
      expect(queue.isPaused).toBe(true);

      queue.start();
      expect(queue.isPaused).toBe(false);
    });
  });

  describe('clear', () => {
    it('clears pending tasks', async () => {
      // Add tasks but don't await them
      queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'slow';
      });
      queue.add(async () => 'fast');

      queue.clear();

      expect(queue.size).toBe(0);
    });

    it('resets statistics', async () => {
      await queue.add(async () => 'done');
      await queue.add(async () => { throw new Error('fail'); }).catch(() => {});

      queue.clear();

      const stats = queue.getStats();
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('size', () => {
    it('reports queue size', () => {
      expect(queue.size).toBe(0);
    });
  });
});

describe('getProcessingQueue', () => {
  afterEach(() => {
    resetProcessingQueue();
  });

  it('returns singleton instance', () => {
    const q1 = getProcessingQueue();
    const q2 = getProcessingQueue();

    expect(q1).toBe(q2);
  });

  it('creates new instance on first call', () => {
    const q = getProcessingQueue();

    expect(q).toBeDefined();
    expect(q).toBeInstanceOf(ProcessingQueue);
  });

  it('reuses same instance across calls', async () => {
    const q1 = getProcessingQueue();
    await q1.add(async () => 'test');

    const q2 = getProcessingQueue();
    const stats = q2.getStats();

    expect(stats.completed).toBe(1);
  });
});

describe('resetProcessingQueue', () => {
  afterEach(() => {
    resetProcessingQueue();
  });

  it('resets the singleton to null', () => {
    const q1 = getProcessingQueue();

    resetProcessingQueue();
    const q2 = getProcessingQueue();

    expect(q1).not.toBe(q2);
  });

  it('clears existing queue', async () => {
    const q = getProcessingQueue();
    await q.add(async () => 'test');

    resetProcessingQueue();
    const newQ = getProcessingQueue();
    const stats = newQ.getStats();

    expect(stats.completed).toBe(0);
  });
});
