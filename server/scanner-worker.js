/**
 * One worker thread's share of a range scan. Reads/writes the same
 * SharedArrayBuffer-backed cache as every other worker in this scan
 * -- a benign race (two threads computing the same n at once) just
 * means duplicated work, never a wrong answer, since the computation
 * is a pure function of n and typed-array element writes at these
 * sizes can't tear. No locking needed.
 */
const { parentPort, workerData } = require("worker_threads");
const { makeScanner, insertTop } = require("./algo");

const { sharedStepsBuffer, sharedPeakBuffer, cacheCeiling, subStart, subEnd, stepLimit } = workerData;

const stepsCache = new Uint16Array(sharedStepsBuffer);
const peakCache = new Float32Array(sharedPeakBuffer);
const stepsFor = makeScanner(cacheCeiling, stepLimit, stepsCache, peakCache);

// CHUNK_SIZE controls responsiveness (how often we yield to the event
// loop / could notice an abort), not how often we report progress --
// on a fast multi-threaded server, 500k numbers can take single-digit
// milliseconds, so gating progress posts on chunk count alone made
// this worker post far faster than any UI could usefully redraw at
// (a client-side scatter-chart redraw on every message was the actual
// cause of reported lag on a 1B scan). POST_INTERVAL_MS caps posting
// by wall-clock time instead, same idea as the browser Worker's local
// scanner.
const CHUNK_SIZE = 500_000;
const POST_INTERVAL_MS = 150;
const total = subEnd - subStart + 1;

let n = subStart;
let processed = 0;
let maxSteps = { n: subStart, steps: -1 };
let maxPeak = { n: subStart, peak: -1 };
const topSteps = [];
const topPeak = [];
const anomalies = [];
const startTime = Date.now();
let lastPost = startTime;

function tick() {
  const chunkEnd = Math.min(subEnd, n + CHUNK_SIZE - 1);
  for (; n <= chunkEnd; n++) {
    const r = stepsFor(n);
    processed++;
    if (!r.converged) anomalies.push({ n, steps: r.steps });
    if (r.steps > maxSteps.steps) maxSteps = { n, steps: r.steps };
    if (r.peak > maxPeak.peak) maxPeak = { n, peak: r.peak };
    insertTop(topSteps, n, r.steps, "steps");
    insertTop(topPeak, n, r.peak, "peak");
  }

  const now = Date.now();
  const elapsed = now - startTime;
  if (n <= subEnd) {
    if (now - lastPost >= POST_INTERVAL_MS) {
      parentPort.postMessage({
        type: "progress",
        processed,
        total,
        elapsed,
        maxSteps,
        maxPeak,
        topSteps: topSteps.slice(),
        topPeak: topPeak.slice(),
        anomalyCount: anomalies.length,
      });
      lastPost = now;
    }
    setImmediate(tick);
  } else {
    parentPort.postMessage({
      type: "done",
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
