(function () {
  "use strict";

  // ---------- Theme toggle ----------
  const themeBtn = document.getElementById("themeToggle");
  const THEME_KEY = "collatz-theme";
  function applyTheme(mode) {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    themeBtn.textContent = "Theme: " + mode[0].toUpperCase() + mode.slice(1);
  }
  function cycleTheme() {
    const order = ["system", "light", "dark"];
    const current = localStorage.getItem(THEME_KEY) || "system";
    const next = order[(order.indexOf(current) + 1) % order.length];
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* private-browsing storage can throw; theme just won't persist */
    }
    applyTheme(next);
    requestAnimationFrame(() => {
      if (lineChart) lineChart.render();
      if (scatterChart) scatterChart.render();
    });
  }
  themeBtn.addEventListener("click", cycleTheme);
  (function initTheme() {
    let saved = "system";
    try {
      saved = localStorage.getItem(THEME_KEY) || "system";
    } catch (e) {
      /* ignore */
    }
    applyTheme(saved);
  })();

  // ---------- Explorer (single number) ----------
  const numberInput = document.getElementById("numberInput");
  const exploreBtn = document.getElementById("exploreBtn");
  const explorerError = document.getElementById("explorerError");
  const explorerStats = document.getElementById("explorerStats");
  const chartControls = document.getElementById("chartControls");
  const lineChartFigure = document.getElementById("lineChartFigure");
  const lineYAxisTitle = document.getElementById("lineYAxisTitle");
  const sequenceDetails = document.getElementById("sequenceDetails");
  const sequenceValues = document.getElementById("sequenceValues");
  const logToggle = document.getElementById("logToggle");

  const EXPLORER_STEP_CAP = 200000;

  const lineChart = Charts.LineChart(document.getElementById("lineChart"), document.getElementById("lineTooltip"));
  let logScaleOn = false;

  logToggle.addEventListener("click", () => {
    logScaleOn = !logScaleOn;
    logToggle.setAttribute("aria-pressed", String(logScaleOn));
    lineYAxisTitle.textContent = logScaleOn ? "Sequence value (log scale)" : "Sequence value";
    lineChart.setLogScale(logScaleOn);
  });

  function parsePositiveBigInt(text) {
    const trimmed = text.trim().replace(/[,_\s]/g, "");
    if (!/^\d+$/.test(trimmed)) return null;
    const value = BigInt(trimmed);
    if (value <= 0n) return null;
    return value;
  }

  function runExplorer() {
    explorerError.textContent = "";
    const raw = numberInput.value;
    const n = parsePositiveBigInt(raw);
    if (n === null) {
      explorerError.textContent = "Enter a positive whole number (digits only).";
      explorerStats.hidden = true;
      chartControls.hidden = true;
      lineChartFigure.hidden = true;
      sequenceDetails.hidden = true;
      return;
    }

    const { sequence, steps, peak, converged } = Collatz.collatzSequenceBigInt(n, EXPLORER_STEP_CAP);

    explorerStats.hidden = false;
    document.getElementById("statSteps").textContent = steps.toLocaleString();
    document.getElementById("statPeak").textContent = peak.toLocaleString();
    const ratio = n > 0n ? Number(peak) / Number(n) : 0;
    document.getElementById("statRatio").textContent = ratio < 1000 ? ratio.toFixed(2) + "×" : ratio.toExponential(2) + "×";
    const resultEl = document.getElementById("statResult");
    if (converged) {
      resultEl.textContent = "Reached 1 ✓";
      resultEl.style.color = "var(--good-text)";
    } else {
      resultEl.textContent = "Step cap hit";
      resultEl.style.color = "var(--critical)";
    }

    chartControls.hidden = false;
    lineChartFigure.hidden = false;
    const points = sequence.map((v, i) => ({ x: i, y: Number(v) }));
    lineChart.setData(points);

    sequenceDetails.hidden = false;
    const MAX_SHOWN = 2000;
    if (sequence.length > MAX_SHOWN) {
      const head = sequence.slice(0, MAX_SHOWN / 2).map((v) => v.toString());
      const tail = sequence.slice(-MAX_SHOWN / 2).map((v) => v.toString());
      sequenceValues.textContent = head.join(", ") + `  …  (${sequence.length - MAX_SHOWN} more)  …  ` + tail.join(", ");
    } else {
      sequenceValues.textContent = sequence.map((v) => v.toString()).join(", ");
    }

    if (!converged) {
      explorerError.textContent =
        `Stopped after the ${EXPLORER_STEP_CAP.toLocaleString()}-step safety cap without reaching 1 — ` +
        `this would be a genuine counterexample if it held up, so please double-check the input.`;
    }
  }

  exploreBtn.addEventListener("click", runExplorer);
  numberInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runExplorer();
  });
  document.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset === "random") {
        const digits = 1 + Math.floor(Math.random() * 12);
        let n = "";
        for (let i = 0; i < digits; i++) n += Math.floor(Math.random() * 10);
        n = n.replace(/^0+/, "") || "1";
        numberInput.value = n;
      } else {
        numberInput.value = preset;
      }
      runExplorer();
    });
  });

  runExplorer();

  // ---------- Range scanner ----------
  const rangeStart = document.getElementById("rangeStart");
  const rangeEnd = document.getElementById("rangeEnd");
  const stepLimitInput = document.getElementById("stepLimit");
  const scanBtn = document.getElementById("scanBtn");
  const stopBtn = document.getElementById("stopBtn");
  const scanError = document.getElementById("scanError");
  const progressTrack = document.getElementById("progressTrack");
  const progressFill = document.getElementById("progressFill");
  const progressMeta = document.getElementById("progressMeta");
  const progressCount = document.getElementById("progressCount");
  const progressElapsed = document.getElementById("progressElapsed");
  const scanBanner = document.getElementById("scanBanner");
  const scanStats = document.getElementById("scanStats");
  const scatterControls = document.getElementById("scatterControls");
  const scatterChartFigure = document.getElementById("scatterChartFigure");
  const scatterYAxisTitle = document.getElementById("scatterYAxisTitle");
  const recordTabs = document.getElementById("recordTabs");
  const tableSteps = document.getElementById("recordsTableSteps");
  const tablePeak = document.getElementById("recordsTablePeak");

  const MAX_RANGE_END = 20000000;
  const scatterChart = Charts.ScatterChart(document.getElementById("scatterChart"), document.getElementById("scatterTooltip"));
  let scatterMode = "steps";
  let lastTopSteps = [];
  let lastTopPeak = [];
  let scanPointsSteps = [];
  let scanPointsPeak = [];

  let worker = null;

  function fmtElapsed(ms) {
    if (ms < 1000) return ms.toFixed(0) + "ms";
    return (ms / 1000).toFixed(1) + "s";
  }

  function renderRecordsTable(table, rows, valueKey) {
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const tdN = document.createElement("td");
      tdN.textContent = row.n.toLocaleString();
      const tdV = document.createElement("td");
      tdV.textContent = row[valueKey].toLocaleString();
      tr.appendChild(tdN);
      tr.appendChild(tdV);
      tbody.appendChild(tr);
    });
    table.hidden = rows.length === 0;
  }

  function updateScatter() {
    const points = scatterMode === "steps" ? scanPointsSteps : scanPointsPeak;
    document.getElementById("scatterLegendLabel").textContent =
      scatterMode === "steps" ? "Steps per starting number" : "Peak value per starting number";
    scatterYAxisTitle.textContent = scatterMode === "steps" ? "Steps" : "Peak value";
    scatterChart.setData(points, scatterMode === "steps" ? "steps" : "peak");
  }

  document.getElementById("scatterModeSteps").addEventListener("click", () => {
    scatterMode = "steps";
    document.getElementById("scatterModeSteps").setAttribute("aria-pressed", "true");
    document.getElementById("scatterModePeak").setAttribute("aria-pressed", "false");
    updateScatter();
  });
  document.getElementById("scatterModePeak").addEventListener("click", () => {
    scatterMode = "peak";
    document.getElementById("scatterModeSteps").setAttribute("aria-pressed", "false");
    document.getElementById("scatterModePeak").setAttribute("aria-pressed", "true");
    updateScatter();
  });

  recordTabs.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      recordTabs.querySelectorAll(".tab-btn").forEach((b) => b.setAttribute("aria-selected", "false"));
      btn.setAttribute("aria-selected", "true");
      const tab = btn.dataset.tab;
      tableSteps.hidden = tab !== "steps" || lastTopSteps.length === 0;
      tablePeak.hidden = tab !== "peak" || lastTopPeak.length === 0;
    });
  });

  function setScanningUI(isScanning) {
    scanBtn.hidden = isScanning;
    stopBtn.hidden = !isScanning;
    rangeStart.disabled = isScanning;
    rangeEnd.disabled = isScanning;
    stepLimitInput.disabled = isScanning;
  }

  function startScan() {
    scanError.textContent = "";
    scanBanner.innerHTML = "";
    const start = Math.floor(Number(rangeStart.value));
    const end = Math.floor(Number(rangeEnd.value));
    const stepLimit = Math.floor(Number(stepLimitInput.value));

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      scanError.textContent = "Enter a valid range where start ≤ end and start ≥ 1.";
      return;
    }
    if (end > MAX_RANGE_END) {
      scanError.textContent = `End is capped at ${MAX_RANGE_END.toLocaleString()} — the scanner's memoization cache is sized to it, so going higher would use too much memory for a browser tab.`;
      return;
    }
    if (!Number.isFinite(stepLimit) || stepLimit < 10) {
      scanError.textContent = "Step cap must be at least 10.";
      return;
    }

    scanPointsSteps = [];
    scanPointsPeak = [];
    lastTopSteps = [];
    lastTopPeak = [];
    scanStats.hidden = false;
    progressTrack.hidden = false;
    progressMeta.hidden = false;
    scatterControls.hidden = true;
    scatterChartFigure.hidden = true;
    recordTabs.hidden = true;
    tableSteps.hidden = true;
    tablePeak.hidden = true;
    document.getElementById("scanCount").textContent = "0 / " + (end - start + 1).toLocaleString();
    document.getElementById("scanMaxSteps").textContent = "–";
    document.getElementById("scanMaxPeak").textContent = "–";
    document.getElementById("scanElapsed").textContent = "0.0s";
    progressFill.style.width = "0%";

    setScanningUI(true);

    if (worker) worker.terminate();
    worker = new Worker("js/worker.js");
    worker.onmessage = (e) => handleWorkerMessage(e.data, start, end);
    worker.postMessage({ type: "start", start, end, stepLimit });
  }

  function handleWorkerMessage(msg, start, end) {
    if (msg.type === "progress" || msg.type === "done") {
      const pct = (msg.processed / msg.total) * 100;
      progressFill.style.width = pct + "%";
      progressCount.textContent = msg.processed.toLocaleString() + " / " + msg.total.toLocaleString();
      progressElapsed.textContent = fmtElapsed(msg.elapsed);

      document.getElementById("scanCount").textContent = msg.processed.toLocaleString();
      document.getElementById("scanMaxSteps").textContent =
        msg.maxSteps.steps >= 0 ? msg.maxSteps.n.toLocaleString() + " (" + msg.maxSteps.steps.toLocaleString() + " steps)" : "–";
      document.getElementById("scanMaxPeak").textContent =
        msg.maxPeak.peak >= 0 ? msg.maxPeak.n.toLocaleString() + " (" + Charts.formatCompact(msg.maxPeak.peak) + ")" : "–";
      document.getElementById("scanElapsed").textContent = fmtElapsed(msg.elapsed);

      lastTopSteps = msg.topSteps || lastTopSteps;
      lastTopPeak = msg.topPeak || lastTopPeak;
    }

    if (msg.type === "done") {
      setScanningUI(false);
      progressFill.style.width = "100%";

      // Downsample scatter points if the range is huge, to keep rendering snappy.
      const total = msg.total;
      const strideBudget = 60000;
      const stride = Math.max(1, Math.floor(total / strideBudget));
      scanPointsSteps = [];
      scanPointsPeak = [];
      for (let n = start; n <= end; n += stride) {
        const r = Collatz.collatzStatsFast(n, 1000000);
        scanPointsSteps.push({ x: n, y: r.steps });
        scanPointsPeak.push({ x: n, y: r.peak });
      }
      scatterControls.hidden = false;
      scatterChartFigure.hidden = false;
      updateScatter();

      recordTabs.hidden = false;
      renderRecordsTable(tableSteps, msg.topSteps, "steps");
      renderRecordsTable(tablePeak, msg.topPeak, "peak");
      const activeTab = recordTabs.querySelector('[aria-selected="true"]').dataset.tab;
      tableSteps.hidden = activeTab !== "steps";
      tablePeak.hidden = activeTab !== "peak";

      const banner = document.createElement("div");
      if (msg.anomalies.length === 0) {
        banner.className = "banner good";
        banner.innerHTML = `<span class="banner-icon">✓</span><span>No counterexamples — every one of the ${msg.processed.toLocaleString()} numbers checked reached 1.</span>`;
      } else {
        banner.className = "banner critical";
        banner.innerHTML = `<span class="banner-icon">⚠</span><span>${msg.anomalies.length} number(s) didn't reach 1 within the ${stepLimitInput.value}-step cap — try raising the cap before treating this as a real result.</span>`;
      }
      scanBanner.innerHTML = "";
      scanBanner.appendChild(banner);
    }

    if (msg.type === "stopped") {
      setScanningUI(false);
      progressElapsed.textContent = fmtElapsed(msg.elapsed) + " (stopped)";
    }
  }

  scanBtn.addEventListener("click", startScan);
  stopBtn.addEventListener("click", () => {
    if (worker) worker.postMessage({ type: "stop" });
  });

  // ---------- Fullscreen chart toggles ----------
  function wireFullscreenButton(btnId, chart) {
    const btn = document.getElementById(btnId);
    const figure = btn.closest(".chart-figure");
    const canFullscreen = figure.requestFullscreen || figure.webkitRequestFullscreen;
    if (!canFullscreen) {
      btn.hidden = true;
      return;
    }
    const isActive = () => document.fullscreenElement === figure || document.webkitFullscreenElement === figure;
    btn.addEventListener("click", () => {
      const result = isActive()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (figure.requestFullscreen ? figure.requestFullscreen() : figure.webkitRequestFullscreen());
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          /* some browsers refuse fullscreen outside a direct user gesture; fail quietly */
        });
      }
    });
    const onChange = () => {
      btn.textContent = isActive() ? "⤡" : "⤢";
      btn.setAttribute("aria-label", isActive() ? "Exit fullscreen" : "View chart fullscreen");
      requestAnimationFrame(() => chart.render());
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
  }

  wireFullscreenButton("lineFullscreenBtn", lineChart);
  wireFullscreenButton("scatterFullscreenBtn", scatterChart);

  // Canvas text doesn't repaint on its own once a web font finishes
  // loading, so re-render once Poppins is actually available.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      lineChart.render();
      scatterChart.render();
    });
  }
})();
