/**
 * Range-scan worker: exhaustively runs the Collatz process over every
 * integer in [start, end] and streams back aggregate stats, so the UI
 * thread never blocks even for multi-million-number scans.
 *
 * Uses a memoized scanner rather than walking every trajectory from
 * scratch: as numbers are scanned in order, every value a trajectory
 * passes through at or below `end` gets its "steps to 1" and "peak
 * from here" cached, so later numbers whose trajectories fall back
 * into already-scanned territory finish in one lookup instead of a
 * full walk. This turns an O(range x average trajectory length) scan
 * into something close to O(range) and is what makes 10-20 million
 * numbers practical in a browser tab.
 *
 * Peak values are tracked as doubles (not BigInt, unlike the explorer's
 * single-number path): exact up to 2^53, comfortably past the largest
 * peaks seen anywhere in the scannable range here.
 */
let stopped = false;

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === "start") {
    stopped = false;
    runScan(msg.start, msg.end, msg.stepLimit);
  } else if (msg.type === "stop") {
    stopped = true;
  }
};

/**
 * Builds a memoized `stepsFor(n)` for n in [1, cacheCeiling]. Any
 * trajectory value above cacheCeiling is still walked (just not
 * cached), so correctness never depends on the cache's size — only
 * speed does.
 */
function makeScanner(cacheCeiling, stepLimit) {
  const stepsCache = new Uint32Array(cacheCeiling + 1); // 0 = uncomputed (n=1 is special-cased, never stored)
  const peakCache = new Float64Array(cacheCeiling + 1);
  let rawBuf = new Float64Array(4096);

  return function stepsFor(start) {
    if (start === 1) return { steps: 0, peak: 1, converged: true };

    let n = start;
    let rawLen = 0;
    while (true) {
      if (n === 1) break;
      if (n <= cacheCeiling && stepsCache[n] !== 0) break;
      if (rawLen >= stepLimit) {
        // Safety cap: this particular walk hasn't come down to a
        // known value within the allowed step budget. Don't pollute
        // the cache with an incomplete result.
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

function runScan(start, end, stepLimit) {
  const total = end - start + 1;
  let processed = 0;

  let maxSteps = { n: start, steps: -1 };
  let maxPeak = { n: start, peak: -1 };
  const topSteps = [];
  const topPeak = [];
  const anomalies = [];

  const stepsFor = makeScanner(end, stepLimit);

  const startTime = performance.now();
  let lastPost = startTime;

  for (let n = start; n <= end; n++) {
    if (stopped) {
      postMessage({ type: "stopped", processed, total, elapsed: performance.now() - startTime });
      return;
    }

    const result = stepsFor(n);
    processed++;
    if (!result.converged) anomalies.push({ n, steps: result.steps });
    if (result.steps > maxSteps.steps) maxSteps = { n, steps: result.steps };
    if (result.peak > maxPeak.peak) maxPeak = { n, peak: result.peak };

    insertTop(topSteps, n, result.steps, "steps");
    insertTop(topPeak, n, result.peak, "peak");

    const now = performance.now();
    if (now - lastPost > 120 || processed === total) {
      postMessage({
        type: "progress",
        processed,
        total,
        elapsed: now - startTime,
        maxSteps,
        maxPeak,
        topSteps: topSteps.slice(),
        topPeak: topPeak.slice(),
        anomalyCount: anomalies.length,
        currentN: n,
      });
      lastPost = now;
    }
  }

  postMessage({
    type: "done",
    processed,
    total,
    elapsed: performance.now() - startTime,
    maxSteps,
    maxPeak,
    topSteps,
    topPeak,
    anomalies,
  });
}
