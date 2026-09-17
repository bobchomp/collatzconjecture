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

const CHUNK_SIZE = 500_000;
const total = subEnd - subStart + 1;

let n = subStart;
let processed = 0;
let maxSteps = { n: subStart, steps: -1 };
let maxPeak = { n: subStart, peak: -1 };
const topSteps = [];
const topPeak = [];
const anomalies = [];
const startTime = Date.now();

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

  const elapsed = Date.now() - startTime;
  if (n <= subEnd) {
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
