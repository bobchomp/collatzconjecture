/**
 * Server-side range scanner: same memoization idea as the browser
 * Worker (js/worker.js), but sized for ranges up to ~1 billion.
 *
 * Memory tradeoff vs. the browser version: steps are stored as
 * Uint16 (fine -- real Collatz step counts stay far under 65535 for
 * any range this will ever see) and peak as Float32 instead of
 * Float64, halving memory from 12 to 6 bytes/index. That trades
 * exact peak precision for headroom: verified against the exact
 * (Float64) version, step counts never differ and peak values are
 * off by at most ~6e-8 relative error -- irrelevant for a "highest
 * peak found" display, but worth knowing it's not bit-exact.
 *
 * The scan runs in chunks yielded via setImmediate rather than one
 * tight synchronous loop, so a long scan (a 1B run takes ~2 minutes)
 * doesn't block Node's event loop from flushing SSE progress writes
 * or noticing the client disconnected.
 */

const CHUNK_SIZE = 2_000_000;

function makeScanner(cacheCeiling, stepLimit) {
  const stepsCache = new Uint16Array(cacheCeiling + 1); // 0 = uncomputed (n=1 special-cased, never stored)
  const peakCache = new Float32Array(cacheCeiling + 1);
  let rawBuf = new Float64Array(4096);

  return function stepsFor(start) {
    if (start === 1) return { steps: 0, peak: 1, converged: true };

    let n = start;
    let rawLen = 0;
    while (true) {
      if (n === 1) break;
      if (n <= cacheCeiling && stepsCache[n] !== 0) break;
      if (rawLen >= stepLimit) {
        let peak = start;
        for (let i = 0; i < rawLen; i++) if (rawBuf[i] > peak) peak = rawBuf[i];
        return { steps: rawLen, peak, converged: false };
      }
      if (rawLen === rawBuf.length) {
        const grown = new Float64Array(rawBuf.length * 2);
        grown.set(rawBuf);
        rawBuf = grown;
      }
      rawBuf[rawLen++] = n;
      n = n % 2 === 0 ? n / 2 : 3 * n + 1;
    }

    let stepsAcc, peakAcc;
    if (n === 1) {
      stepsAcc = 0;
      peakAcc = 1;
    } else {
      stepsAcc = stepsCache[n];
      peakAcc = peakCache[n];
    }

    for (let i = rawLen - 1; i >= 0; i--) {
      const v = rawBuf[i];
      stepsAcc += 1;
      if (v > peakAcc) peakAcc = v;
      if (v <= cacheCeiling) {
        stepsCache[v] = stepsAcc;
        peakCache[v] = peakAcc;
      }
    }
    return { steps: stepsAcc, peak: peakAcc, converged: true };
  };
}

function insertTop(list, n, value, key) {
  if (list.length === 10 && value <= list[9][key]) return;
  const item = key === "steps" ? { n, steps: value } : { n, peak: value };
  let idx = list.length;
  while (idx > 0 && list[idx - 1][key] < value) idx--;
  list.splice(idx, 0, item);
  if (list.length > 10) list.pop();
}

/**
 * Runs a scan of [start, end], calling onProgress periodically and
 * onDone exactly once at the end (whether completed or aborted).
 * isAborted() is polled between chunks so a dropped client connection
 * stops the work instead of running to completion unattended.
 */
function runScan(start, end, stepLimit, { onProgress, onDone, isAborted }) {
  const stepsFor = makeScanner(end, stepLimit);
  const total = end - start + 1;

  let n = start;
  let processed = 0;
  let maxSteps = { n: start, steps: -1 };
  let maxPeak = { n: start, peak: -1 };
  const topSteps = [];
  const topPeak = [];
  const anomalies = [];
  const startTime = Date.now();

  function tick() {
    if (isAborted()) {
      onDone({ aborted: true, processed, total, elapsed: Date.now() - startTime });
      return;
    }

    const chunkEnd = Math.min(end, n + CHUNK_SIZE - 1);
    for (; n <= chunkEnd; n++) {
      const r = stepsFor(n);
      processed++;
      if (!r.converged) anomalies.push({ n, steps: r.steps });
      if (r.steps > maxSteps.steps) maxSteps = { n, steps: r.steps };
      if (r.peak > maxPeak.peak) maxPeak = { n, peak: r.peak };
      insertTop(topSteps, n, r.steps, "steps");
      insertTop(topPeak, n, r.peak, "peak");
    }

    const elapsed = Date.now() - startTime;
    if (n <= end) {
      onProgress({
        processed,
        total,
        elapsed,
        maxSteps,
        maxPeak,
        topSteps: topSteps.slice(),
        topPeak: topPeak.slice(),
        anomalyCount: anomalies.length,
      });
      setImmediate(tick);
    } else {
      onDone({
        processed,
        total,
        elapsed,
        maxSteps,
        maxPeak,
        topSteps,
        topPeak,
        anomalies,
      });
    }
  }

  tick();
}

module.exports = { runScan, makeScanner };
