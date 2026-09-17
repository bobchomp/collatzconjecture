/**
 * Core Collatz math, shared by the main thread and the range-scan worker.
 * Exposed as `Collatz` on the global object (window or the worker's self).
 */
(function (global) {
  const MAX_SAFE = Number.MAX_SAFE_INTEGER;

  /** One Collatz step on a BigInt. */
  function nextBigInt(n) {
    return n % 2n === 0n ? n / 2n : 3n * n + 1n;
  }

  /**
   * Full trajectory for a BigInt starting value, capped at maxSteps.
   * Returns the sequence (as BigInts), step count, peak value, and
   * whether it actually reached 1 (false only if the step cap was hit).
   */
  function collatzSequenceBigInt(start, maxSteps) {
    if (start <= 0n) throw new RangeError("n must be a positive integer");
    let n = start;
    const sequence = [n];
    let peak = n;
    let steps = 0;
    while (n !== 1n && steps < maxSteps) {
      n = nextBigInt(n);
      steps++;
      sequence.push(n);
      if (n > peak) peak = n;
    }
    return { sequence, steps, peak, converged: n === 1n };
  }

  /**
   * Stats-only trajectory (no sequence array) for a plain-number start.
   * Falls back to BigInt mid-flight if a value would exceed
   * Number.MAX_SAFE_INTEGER, so large peaks stay exact rather than
   * silently losing precision in float arithmetic.
   */
  function collatzStatsFast(startNum, maxSteps) {
    let n = startNum;
    let steps = 0;
    let peak = startNum;

    while (n !== 1 && steps < maxSteps) {
      const candidate = n % 2 === 0 ? n / 2 : 3 * n + 1;
      if (candidate > MAX_SAFE) {
        const big = collatzStatsBigIntOnly(BigInt(candidate < 0 ? 0 : Math.round(candidate)), maxSteps - steps - 1);
        const bigPeakNum = Number(big.peak);
        return {
          steps: steps + 1 + big.steps,
          peak: Math.max(peak, bigPeakNum),
          converged: big.converged,
          usedBigInt: true,
        };
      }
      n = candidate;
      steps++;
      if (n > peak) peak = n;
    }
    return { steps, peak, converged: n === 1, usedBigInt: false };
  }

  function collatzStatsBigIntOnly(startBig, maxSteps) {
    let n = startBig;
    let steps = 0;
    let peak = n;
    while (n !== 1n && steps < maxSteps) {
      n = nextBigInt(n);
      steps++;
      if (n > peak) peak = n;
    }
    return { steps, peak, converged: n === 1n };
  }

  global.Collatz = {
    nextBigInt,
    collatzSequenceBigInt,
    collatzStatsFast,
  };
})(typeof window !== "undefined" ? window : self);
