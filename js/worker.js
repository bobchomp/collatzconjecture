/**
 * Range-scan worker: exhaustively runs the Collatz process over every
 * integer in [start, end] and streams back aggregate stats, so the UI
 * thread never blocks even for multi-million-number scans.
 */
importScripts("collatz.js");

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

function insertTop(list, item, key) {
  list.push(item);
  list.sort((a, b) => b[key] - a[key]);
  if (list.length > 10) list.length = 10;
}

function runScan(start, end, stepLimit) {
  const total = end - start + 1;
  let processed = 0;

  let maxSteps = { n: start, steps: -1 };
  let maxPeak = { n: start, peak: -1 };
  const topSteps = [];
  const topPeak = [];
  const anomalies = [];
  let usedBigIntCount = 0;

  const startTime = performance.now();
  let lastPost = startTime;

  for (let n = start; n <= end; n++) {
    if (stopped) {
      postMessage({ type: "stopped", processed, total, elapsed: performance.now() - startTime });
      return;
    }

    const result = Collatz.collatzStatsFast(n, stepLimit);
    processed++;
    if (result.usedBigInt) usedBigIntCount++;
    if (!result.converged) anomalies.push({ n, steps: result.steps });
    if (result.steps > maxSteps.steps) maxSteps = { n, steps: result.steps };
    if (result.peak > maxPeak.peak) maxPeak = { n, peak: result.peak };

    insertTop(topSteps, { n, steps: result.steps }, "steps");
    insertTop(topPeak, { n, peak: result.peak }, "peak");

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
    usedBigIntCount,
  });
}
