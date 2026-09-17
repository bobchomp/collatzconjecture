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

  const LOCAL_MAX_RANGE_END = 100000000;
  const scatterChart = Charts.ScatterChart(document.getElementById("scatterChart"), document.getElementById("scatterTooltip"));
  let scatterMode = "steps";
  let scatterRevealFraction = 0;
  let lastScatterRedrawTime = 0;
  const SCATTER_REDRAW_INTERVAL_MS = 150;
  let lastTopSteps = [];
  let lastTopPeak = [];
  let scanPointsSteps = [];
  let scanPointsPeak = [];

  let worker = null;
  let scanStartTime = 0;
  let stopCurrentScan = null; // set to whichever stop mechanism the active scan uses

  // ---------- Optional remote server (for ranges above LOCAL_MAX_RANGE_END) ----------
  const serverSettingsSummary = document.getElementById("serverSettingsSummary");
  const serverUrlInput = document.getElementById("serverUrlInput");
  const serverPasswordInput = document.getElementById("serverPasswordInput");
  const serverSaveBtn = document.getElementById("serverSaveBtn");
  const serverClearBtn = document.getElementById("serverClearBtn");
  const serverSettingsStatus = document.getElementById("serverSettingsStatus");

  // Server config lives in Supabase (server_configs table, RLS-scoped to
  // the signed-in user) so it syncs across browsers/devices. This is an
  // in-memory mirror of that row -- populated on sign-in via
  // window.CollatzApp.onSignedIn(), read synchronously everywhere else.
  let serverConfigCache = null;

  function loadServerConfig() {
    return serverConfigCache;
  }

  async function fetchServerConfigFromSupabase() {
    const client = window.CollatzAuth && window.CollatzAuth.client;
    if (!client) return null;
    const { data: userData } = await client.auth.getUser();
    if (!userData || !userData.user) return null;
    const { data, error } = await client
      .from("server_configs")
      .select("url, password, max_range_end")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return { url: data.url, password: data.password, maxRangeEnd: Number(data.max_range_end) };
  }

  async function saveServerConfigToStorage(cfg) {
    serverConfigCache = cfg;
    const client = window.CollatzAuth && window.CollatzAuth.client;
    if (!client) return;
    const { data: userData } = await client.auth.getUser();
    if (!userData || !userData.user) return;
    await client.from("server_configs").upsert({
      user_id: userData.user.id,
      url: cfg.url,
      password: cfg.password,
      max_range_end: cfg.maxRangeEnd,
      updated_at: new Date().toISOString(),
    });
  }

  async function clearServerConfigFromStorage() {
    serverConfigCache = null;
    const client = window.CollatzAuth && window.CollatzAuth.client;
    if (!client) return;
    const { data: userData } = await client.auth.getUser();
    if (userData && userData.user) {
      await client.from("server_configs").delete().eq("user_id", userData.user.id);
    }
  }

  function refreshServerUI() {
    const cfg = loadServerConfig();
    if (cfg) {
      serverSettingsSummary.textContent =
        `Server: ${cfg.url} (ranges up to ${cfg.maxRangeEnd.toLocaleString()})`;
      rangeEnd.max = String(cfg.maxRangeEnd);
    } else {
      serverSettingsSummary.textContent = "Server: not configured (ranges capped at 100,000,000)";
      rangeEnd.max = String(LOCAL_MAX_RANGE_END);
    }
  }

  function getEffectiveMaxEnd() {
    const cfg = loadServerConfig();
    return cfg ? cfg.maxRangeEnd : LOCAL_MAX_RANGE_END;
  }

  serverSaveBtn.addEventListener("click", async () => {
    const url = serverUrlInput.value.trim().replace(/\/+$/, "");
    const password = serverPasswordInput.value;
    serverSettingsStatus.textContent = "";
    if (!url || !password) {
      serverSettingsStatus.textContent = "Enter both a server URL and a password.";
      return;
    }
    serverSaveBtn.disabled = true;
    serverSaveBtn.textContent = "Testing…";
    try {
      const healthResp = await fetch(url + "/health");
      if (!healthResp.ok) throw new Error("Server responded with " + healthResp.status);
      const health = await healthResp.json();

      const authResp = await fetch(url + "/scan?start=1&end=1&stepLimit=10", {
        headers: { "X-Scan-Password": password },
      });
      if (authResp.status === 401) throw new Error("Wrong password.");
      if (!authResp.ok) {
        const body = await authResp.json().catch(() => ({}));
        throw new Error(body.error || "Server responded with " + authResp.status);
      }
      // Drain the tiny test scan's SSE body so the connection closes cleanly.
      if (authResp.body) await authResp.body.cancel().catch(() => {});

      await saveServerConfigToStorage({ url, password, maxRangeEnd: health.maxRangeEnd });
      serverPasswordInput.value = "";
      refreshServerUI();
      serverSettingsStatus.textContent = "";
      serverSettingsStatus.style.color = "var(--good-text)";
      serverSettingsStatus.textContent = `Connected — this server accepts ranges up to ${health.maxRangeEnd.toLocaleString()}.`;
    } catch (err) {
      serverSettingsStatus.style.color = "var(--critical)";
      serverSettingsStatus.textContent =
        "Couldn't connect: " + (err.message || "unknown error") + " (check the URL and that the server is reachable).";
    } finally {
      serverSaveBtn.disabled = false;
      serverSaveBtn.textContent = "Save & test";
    }
  });

  serverClearBtn.addEventListener("click", async () => {
    await clearServerConfigFromStorage();
    serverUrlInput.value = "";
    serverPasswordInput.value = "";
    serverSettingsStatus.style.color = "";
    serverSettingsStatus.textContent = "";
    refreshServerUI();
  });

  refreshServerUI();

  // Called by js/auth.js on sign-in/sign-out.
  window.CollatzApp = {
    onSignedIn: async () => {
      serverConfigCache = await fetchServerConfigFromSupabase();
      if (serverConfigCache) serverUrlInput.value = serverConfigCache.url;
      refreshServerUI();
    },
    onSignedOut: () => {
      serverConfigCache = null;
      serverUrlInput.value = "";
      serverPasswordInput.value = "";
      serverSettingsStatus.textContent = "";
      refreshServerUI();
    },
  };

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
    const visibleCount = points.length === 0 ? 0 : Math.max(1, Math.ceil(points.length * scatterRevealFraction));
    document.getElementById("scatterLegendLabel").textContent =
      scatterMode === "steps" ? "Steps per starting number" : "Peak value per starting number";
    scatterYAxisTitle.textContent = scatterMode === "steps" ? "Steps" : "Peak value";
    scatterChart.setData(points.slice(0, visibleCount), scatterMode === "steps" ? "steps" : "peak");
  }

  /** Sampled independently of scan progress -- cheap enough (bounded to
   *  ~60,000 calls regardless of range size) to compute upfront, then
   *  revealed left-to-right in step with the real scan's progress. */
  function computeScatterSamples(start, end) {
    const strideBudget = 60000;
    const stride = Math.max(1, Math.floor((end - start + 1) / strideBudget));
    const steps = [];
    const peak = [];
    for (let n = start; n <= end; n += stride) {
      const r = Collatz.collatzStatsFast(n, 1000000);
      steps.push({ x: n, y: r.steps });
      peak.push({ x: n, y: r.peak });
    }
    return { steps, peak };
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
    const serverCfg = loadServerConfig();
    const needsServer = end > LOCAL_MAX_RANGE_END;
    if (needsServer && !serverCfg) {
      scanError.textContent =
        `End is capped at ${LOCAL_MAX_RANGE_END.toLocaleString()} for in-browser scans — configure a server below to go higher.`;
      return;
    }
    const effectiveMax = getEffectiveMaxEnd();
    if (end > effectiveMax) {
      scanError.textContent = `End is capped at ${effectiveMax.toLocaleString()} by your configured server.`;
      return;
    }
    if (!Number.isFinite(stepLimit) || stepLimit < 10) {
      scanError.textContent = "Step cap must be at least 10.";
      return;
    }

    const samples = computeScatterSamples(start, end);
    scanPointsSteps = samples.steps;
    scanPointsPeak = samples.peak;
    scatterRevealFraction = 0;
    lastTopSteps = [];
    lastTopPeak = [];
    scanStats.hidden = false;
    progressTrack.hidden = false;
    progressMeta.hidden = false;
    scatterControls.hidden = false;
    scatterChartFigure.hidden = false;
    updateScatter();
    recordTabs.hidden = true;
    tableSteps.hidden = true;
    tablePeak.hidden = true;
    document.getElementById("scanCount").textContent = "0 / " + (end - start + 1).toLocaleString();
    document.getElementById("scanMaxSteps").textContent = "–";
    document.getElementById("scanMaxPeak").textContent = "–";
    document.getElementById("scanElapsed").textContent = "0.0s";
    progressFill.style.width = "0%";

    setScanningUI(true);
    scanStartTime = Date.now();

    if (needsServer) {
      runRemoteScan(serverCfg, start, end, stepLimit);
    } else {
      if (worker) worker.terminate();
      worker = new Worker("js/worker.js");
      worker.onmessage = (e) => handleWorkerMessage(e.data, start, end);
      stopCurrentScan = () => worker.postMessage({ type: "stop" });
      worker.postMessage({ type: "start", start, end, stepLimit });
    }
  }

  async function runRemoteScan(serverCfg, start, end, stepLimit) {
    const controller = new AbortController();
    stopCurrentScan = () => controller.abort();

    const qs = `start=${start}&end=${end}&stepLimit=${stepLimit}`;
    let response;
    try {
      response = await fetch(`${serverCfg.url}/scan?${qs}`, {
        headers: { "X-Scan-Password": serverCfg.password },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        setScanningUI(false);
        progressElapsed.textContent = fmtElapsed(Date.now() - scanStartTime) + " (stopped)";
        return;
      }
      setScanningUI(false);
      scanError.textContent = "Couldn't reach the server — check it's online and the URL is correct.";
      return;
    }

    if (!response.ok) {
      setScanningUI(false);
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        scanError.textContent = "Server rejected the password — update it in the server settings below.";
      } else {
        scanError.textContent = body.error || `Server responded with ${response.status}.`;
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const eventMatch = block.match(/^event: (.+)$/m);
          const dataMatch = block.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const type = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);
          handleWorkerMessage({ type, ...data }, start, end);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setScanningUI(false);
        progressElapsed.textContent = fmtElapsed(Date.now() - scanStartTime) + " (stopped)";
      } else {
        setScanningUI(false);
        scanError.textContent = "Lost connection to the server mid-scan.";
      }
    }
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

      // Reveal the (already-computed) scatter samples left-to-right in
      // step with real progress, rather than only showing the chart
      // once the whole scan is done. Throttled by time (not tied 1:1 to
      // progress-message frequency) since redrawing tens of thousands
      // of canvas points on every message -- possible on a fast
      // multi-threaded server sending many messages per second -- is
      // what caused visible lag on very large scans.
      scatterRevealFraction = msg.processed / msg.total;
      const now = Date.now();
      if (now - lastScatterRedrawTime >= SCATTER_REDRAW_INTERVAL_MS) {
        updateScatter();
        lastScatterRedrawTime = now;
      }
    }

    if (msg.type === "done") {
      setScanningUI(false);
      progressFill.style.width = "100%";
      scatterRevealFraction = 1;
      updateScatter();
      lastScatterRedrawTime = Date.now();

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
    if (stopCurrentScan) stopCurrentScan();
  });

  // ---------- Chart "expand" popup ----------
  // Reparents the actual chart-figure (canvas, tooltip, axis titles and
  // all) into an in-page modal rather than using the browser's real
  // Fullscreen API — no permission quirks, and it works on browsers
  // (iOS Safari) that don't support fullscreening arbitrary elements.
  const chartModal = document.getElementById("chartModal");
  const chartModalSlot = document.getElementById("chartModalSlot");
  const chartModalClose = document.getElementById("chartModalClose");
  let modalHome = null;

  function openChartModal(figure, chart, openerBtn) {
    modalHome = { figure, parent: figure.parentNode, nextSibling: figure.nextSibling, chart, openerBtn };
    chartModalSlot.appendChild(figure);
    chartModal.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => chart.render());
    chartModalClose.focus();
  }

  function closeChartModal() {
    if (!modalHome) return;
    const { figure, parent, nextSibling, chart, openerBtn } = modalHome;
    parent.insertBefore(figure, nextSibling);
    chartModal.hidden = true;
    document.body.style.overflow = "";
    modalHome = null;
    requestAnimationFrame(() => chart.render());
    openerBtn.focus();
  }

  chartModalClose.addEventListener("click", closeChartModal);
  chartModal.querySelector(".chart-modal-backdrop").addEventListener("click", closeChartModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !chartModal.hidden) closeChartModal();
  });

  function wireFullscreenButton(btnId, chart) {
    const btn = document.getElementById(btnId);
    const figure = btn.closest(".chart-figure");
    btn.addEventListener("click", () => openChartModal(figure, chart, btn));
  }

  wireFullscreenButton("lineFullscreenBtn", lineChart);
  wireFullscreenButton("scatterFullscreenBtn", scatterChart);

  // ---------- Settings popup ----------
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const settingsModalClose = document.getElementById("settingsModalClose");
  let settingsOpenerBtn = null;

  function openSettingsModal(openerBtn) {
    settingsOpenerBtn = openerBtn;
    settingsModal.hidden = false;
    document.body.style.overflow = "hidden";
    settingsModalClose.focus();
  }

  function closeSettingsModal() {
    if (settingsModal.hidden) return;
    settingsModal.hidden = true;
    document.body.style.overflow = "";
    if (settingsOpenerBtn) settingsOpenerBtn.focus();
    settingsOpenerBtn = null;
  }

  settingsBtn.addEventListener("click", () => openSettingsModal(settingsBtn));
  serverSettingsSummary.addEventListener("click", () => openSettingsModal(serverSettingsSummary));
  settingsModalClose.addEventListener("click", closeSettingsModal);
  settingsModal.querySelector(".chart-modal-backdrop").addEventListener("click", closeSettingsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.hidden) closeSettingsModal();
  });

  // Canvas text doesn't repaint on its own once a web font finishes
  // loading, so re-render once Poppins is actually available.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      lineChart.render();
      scatterChart.render();
    });
  }
})();
