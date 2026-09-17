/**
 * Pure Collatz scanning primitives shared by the single-process
 * scanner and each worker thread. No I/O, no worker_threads
 * awareness -- just the math, parameterized over whatever
 * steps/peak cache arrays the caller hands in (plain typed arrays
 * for a single thread, SharedArrayBuffer-backed views when running
 * across threads).
 */

function makeScanner(cacheCeiling, stepLimit, stepsCache, peakCache) {
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

/** Merges two already-sorted-descending top-10 lists into one top-10. */
function mergeTop(listA, listB, key) {
  const merged = [];
  let i = 0;
  let j = 0;
  while (merged.length < 10 && (i < listA.length || j < listB.length)) {
    const a = listA[i];
    const b = listB[j];
    if (a && (!b || a[key] >= b[key])) {
      merged.push(a);
      i++;
    } else {
      merged.push(b);
      j++;
    }
  }
  return merged;
}

module.exports = { makeScanner, insertTop, mergeTop };
