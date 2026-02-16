import { CountingSemaphore } from "./semaphore";
import { getLogger } from "./helpers";
import { describe, expect, it } from "vitest";

describe("Initialization test", () => {
  it("initialize semaphore", () => {
    const logger = getLogger("info");
    const semaphore = new CountingSemaphore("test", 5, logger);
    expect(semaphore.max).toBe(5);
    expect(semaphore.logger).toBe(logger);
    expect(semaphore.label).toBe("test");
  });
  it("initialize semaphore with negative value", () => {
    const logger = getLogger("info");
    expect(() => new CountingSemaphore("test", -1, logger)).toThrow(
      "The test semaphore was created with a max value of -1 but the max value cannot be less than 1",
    );
  });
});

describe("Acquire and release tests", () => {
  it("test acquire and release on less than max", async () => {
    const logger = getLogger("info");
    const semaphore = new CountingSemaphore("test", 5, logger);
    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    async function runOperation() {
      // Wait until lock is acquired to do anything
      const lock = await semaphore.acquire();

      // Simulated operation that takes 1 second to finish
      await pause(10);

      // Done with the resource now, release the lock to let others use it
      lock.release();
    }
    const start = Date.now();
    for (let i = 0; i < 4; i++) {
      await runOperation();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
  it("test acquire and release on more than max", async () => {
    const logger = getLogger("info");
    const semaphore = new CountingSemaphore("test", 5, logger);
    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    async function runOperation() {
      // Wait until lock is acquired to do anything
      const lock = await semaphore.acquire();

      // Simulated operation that takes 1 second to finish
      await pause(10);

      // Done with the resource now, release the lock to let others use it
      lock.release();
    }
    const start = Date.now();
    for (let i = 0; i < 6; i++) {
      await runOperation();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(60);
  });
});
