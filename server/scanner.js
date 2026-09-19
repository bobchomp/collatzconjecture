/**
 * Orchestrates a range scan across N worker threads (server-worker.js),
 * all sharing one SharedArrayBuffer-backed cache so every thread
 * benefits from every other thread's cached values -- not just its
 * own. Memory is the same as the single-threaded version (the cache
 * is shared, not duplicated); wall-clock time scales down roughly
 * with core count instead.
 *
 * Returns a `cancel()` function rather than polling an isAborted()
 * flag, since cancellation here means actually terminating worker
 * threads, not just breaking a loop.
 *
 * The cache doesn't have to cover the whole [start, end] range --
 * algo.js only caches/looks up values <= cacheCeiling and just walks
 * the raw trajectory (uncached) above that. Since a trajectory
 * starting well above cacheCeiling still falls below it within a
 * handful of halvings almost always, this keeps memory bounded by
 * cacheCeiling alone, letting `end` go far higher than memory would
 * otherwise allow -- at the cost of some lost cache reuse among
 * numbers that never dip below the ceiling.
 */
const path = require("path");
const { Worker } = require("worker_threads");
const { mergeTop } = require("./algo");

function splitRange(start, end, numWorkers) {
  const total = end - start + 1;
  const base = Math.floor(total / numWorkers);
  const ranges = [];
  let cursor = start;
  for (let i = 0; i < numWorkers; i++) {
    const subStart = cursor;
    const subEnd = i === numWorkers - 1 ? end : cursor + base - 1;
    ranges.push([subStart, subEnd]);
    cursor = subEnd + 1;
  }
  return ranges.filter(([s, e]) => e >= s);
}

function runScan(start, end, stepLimit, numWorkers, { onProgress, onDone, cacheCeiling = end }) {
  cacheCeiling = Math.min(cacheCeiling, end);
  const sharedStepsBuffer = new SharedArrayBuffer((cacheCeiling + 1) * 2); // Uint16
  const sharedPeakBuffer = new SharedArrayBuffer((cacheCeiling + 1) * 4); // Float32

  const subRanges = splitRange(start, end, numWorkers);
  const total = end - start + 1;
  const startTime = Date.now();

  const state = subRanges.map(([s, e]) => ({
    processed: 0,
    total: e - s + 1,
    maxSteps: { n: s, steps: -1 },
    maxPeak: { n: s, peak: -1 },
    topSteps: [],
    topPeak: [],
    anomalyCount: 0,
    anomalies: null, // filled in only once this worker's "done" message arrives
    done: false,
  }));

  function combinedSnapshot() {
    let processed = 0;
    let maxSteps = { n: start, steps: -1 };
    let maxPeak = { n: start, peak: -1 };
    let topSteps = [];
    let topPeak = [];
    let anomalyCount = 0;
    for (const w of state) {
      processed += w.processed;
      if (w.maxSteps.steps > maxSteps.steps) maxSteps = w.maxSteps;
      if (w.maxPeak.peak > maxPeak.peak) maxPeak = w.maxPeak;
      topSteps = mergeTop(topSteps, w.topSteps, "steps");
      topPeak = mergeTop(topPeak, w.topPeak, "peak");
      anomalyCount += w.anomalies ? w.anomalies.length : w.anomalyCount;
    }
    return { processed, total, elapsed: Date.now() - startTime, maxSteps, maxPeak, topSteps, topPeak, anomalyCount };
  }

  let settled = false;
  const workers = [];

  function finish(extra) {
    if (settled) return;
    settled = true;
    for (const w of workers) w.terminate();
    onDone({ ...combinedSnapshot(), anomalies: state.flatMap((w) => w.anomalies || []), ...extra });
  }

  subRanges.forEach(([subStart, subEnd], i) => {
    const worker = new Worker(path.join(__dirname, "scanner-worker.js"), {
      workerData: { sharedStepsBuffer, sharedPeakBuffer, cacheCeiling, subStart, subEnd, stepLimit },
    });
    workers.push(worker);

    worker.on("message", (msg) => {
      if (settled) return;
      const w = state[i];
      w.processed = msg.processed;
      w.maxSteps = msg.maxSteps;
      w.maxPeak = msg.maxPeak;
      w.topSteps = msg.topSteps;
      w.topPeak = msg.topPeak;

      if (msg.type === "done") {
        w.anomalies = msg.anomalies;
        w.done = true;
        if (state.every((s) => s.done)) finish({});
      } else {
        w.anomalyCount = msg.anomalyCount;
        onProgress(combinedSnapshot());
      }
    });

    worker.on("error", (err) => {
      finish({ error: err.message });
    });
  });

  return function cancel() {
    finish({ aborted: true });
  };
}

module.exports = { runScan, splitRange };
