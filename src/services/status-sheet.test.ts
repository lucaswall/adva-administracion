/**
 * Tests for status sheet service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectStatusMetrics, formatTimestampInTimezone } from './status-sheet.js';

// Mock dependencies
vi.mock('../routes/status.js', () => ({
  getServerStartTime: vi.fn(() => new Date('2024-01-01T00:00:00Z')),
  formatUptime: vi.fn(() => '1d 2h 30m'),
}));

vi.mock('../processing/queue.js', () => ({
  getProcessingQueue: vi.fn(() => ({
    getStats: () => ({
      pending: 2,
      running: 1,
      completed: 100,
      failed: 5,
    }),
  })),
}));

vi.mock('./watch-manager.js', () => ({
  getWatchManagerStatus: vi.fn(() => ({
    enabled: true,
    activeChannels: 1,
    channels: [],
    lastNotification: new Date('2024-01-01T12:00:00Z'),
    lastScan: new Date('2024-01-01T11:00:00Z'),
  })),
}));

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    nodeEnv: 'production',
    port: 3000,
  })),
}));

describe('Status Sheet Service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T02:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('collectStatusMetrics', () => {
    it('should collect all system metrics', () => {
      const metrics = collectStatusMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.lastPing).toBeInstanceOf(Date);
      expect(metrics.uptime).toBe('1d 2h 30m');
      expect(metrics.version).toBe('1.0.0');
      expect(metrics.environment).toBe('production');
    });

    it('should include queue statistics', () => {
      const metrics = collectStatusMetrics();

      expect(metrics.queueCompleted).toBe(100);
      expect(metrics.queueFailed).toBe(5);
      expect(metrics.queuePending).toBe(3); // pending + running
    });

    it('should include memory metrics as formatted strings', () => {
      const metrics = collectStatusMetrics();

      expect(metrics.heapUsed).toMatch(/^\d+MB$/);
      expect(metrics.heapTotal).toMatch(/^\d+MB$/);
      expect(metrics.rss).toMatch(/^\d+MB$/);
    });

    it('should include watch manager status', () => {
      const metrics = collectStatusMetrics();

      expect(metrics.watchEnabled).toBe(true);
      expect(metrics.activeChannels).toBe(1);
      expect(metrics.lastScan).toBeInstanceOf(Date);
    });
  });

  describe('formatTimestampInTimezone', () => {
    it('should format UTC timestamp in Argentina timezone', () => {
      const utcDate = new Date('2026-01-24T18:30:00.000Z'); // 6:30 PM UTC
      const formatted = formatTimestampInTimezone(utcDate, 'America/Argentina/Buenos_Aires');

      // Argentina is UTC-3, so 18:30 UTC = 15:30 ART
      expect(formatted).toBe('2026-01-24 15:30:00');
    });

    it('should format UTC timestamp in US Eastern timezone', () => {
      const utcDate = new Date('2026-01-24T18:30:00.000Z'); // 6:30 PM UTC
      const formatted = formatTimestampInTimezone(utcDate, 'America/New_York');

      // US Eastern is UTC-5 in January, so 18:30 UTC = 13:30 EST
      expect(formatted).toBe('2026-01-24 13:30:00');
    });

    it('should format UTC timestamp in UTC timezone', () => {
      const utcDate = new Date('2026-01-24T18:30:00.000Z');
      const formatted = formatTimestampInTimezone(utcDate, 'UTC');

      expect(formatted).toBe('2026-01-24 18:30:00');
    });

    it('should return empty string for null date', () => {
      const formatted = formatTimestampInTimezone(null, 'America/Argentina/Buenos_Aires');

      expect(formatted).toBe('');
    });

    it('should handle dates around midnight correctly', () => {
      const utcDate = new Date('2026-01-24T02:30:00.000Z'); // 2:30 AM UTC
      const formatted = formatTimestampInTimezone(utcDate, 'America/Argentina/Buenos_Aires');

      // Argentina is UTC-3, so 02:30 UTC = 23:30 previous day
      expect(formatted).toBe('2026-01-23 23:30:00');
    });
  });
});
