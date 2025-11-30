import { UpdateProgress } from '@/types';

/**
 * Creates a throttled progress callback that limits update frequency.
 *
 * Updates fire immediately if:
 * - Progress changed by >= minChange (default 1%)
 * - Stage changed (stage transitions always update)
 * - minInterval milliseconds passed since last update (default 100ms)
 *
 * Includes flush() method to ensure final update is sent.
 */
export function createProgressThrottle(
  fn: (progress: UpdateProgress) => void,
  minInterval: number = 100,
  minChange: number = 1
): ((progress: UpdateProgress) => void) & { flush: () => void } {
  let lastCallTime = 0;
  let lastProgress = -1;
  let lastStage = '';
  let pendingUpdate: UpdateProgress | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = (update: UpdateProgress) => {
    const now = Date.now();
    const progress = update.progress ?? 0;
    const stage = update.stage ?? '';
    const progressChange = Math.abs(progress - lastProgress);
    const stageChanged = stage !== lastStage;
    const timePassed = now - lastCallTime >= minInterval;

    // Update immediately if: stage changed, progress changed enough, or time passed
    const shouldCallNow = stageChanged || progressChange >= minChange || timePassed;

    if (shouldCallNow) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCallTime = now;
      lastProgress = progress;
      lastStage = stage;
      pendingUpdate = null;
      fn(update);
    } else {
      // Queue for later
      pendingUpdate = update;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (pendingUpdate) {
            lastCallTime = Date.now();
            lastProgress = pendingUpdate.progress ?? 0;
            lastStage = pendingUpdate.stage ?? '';
            fn(pendingUpdate);
            pendingUpdate = null;
          }
          timeoutId = null;
        }, minInterval);
      }
    }
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (pendingUpdate) {
      fn(pendingUpdate);
      pendingUpdate = null;
    }
  };

  return throttled;
}
