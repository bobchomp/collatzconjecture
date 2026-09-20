/**
 * Saved Scans page: lists range-scan results a signed-in user has
 * saved from the Explorer page, and lets them re-open the full detail
 * (charts + records) or delete one. Everything needed to redraw a
 * saved scan's charts exactly -- the sampled scatter points -- is
 * stored in the database row itself (saved_scans table), so viewing
 * one never re-runs anything.
 */
(function () {
  "use strict";

  // ---------- Theme toggle ----------
  // Small enough to duplicate rather than share a module with app.js --
  // same behavior (persisted choice, re-render charts on change), scoped
  // to this page's own chart instances.
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
      scatterChart.render();
      histogramChart.render();
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

  // ---------- Shared small helpers (mirrors app.js) ----------
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
  }

  function computeHistogramBins(points, numBins) {
    if (points.length === 0) return [];
    let maxSteps = 1;
    for (const p of points) if (p.y > maxSteps) maxSteps = p.y;
    const binWidth = Math.max(1, Math.ceil(maxSteps / numBins));
    const bins = [];
    for (let i = 0; i < numBins; i++) bins.push({ x0: i * binWidth, x1: (i + 1) * binWidth, count: 0 });
    for (const p of points) {
      const idx = Math.min(numBins - 1, Math.floor(p.y / binWidth));
      bins[idx].count++;
    }
    return bins;
  }

  function unpackPoints(pairs) {
    return (pairs || []).map(([x, y]) => ({ x, y }));
  }

  // ---------- Detail view ----------
  const HISTOGRAM_BIN_COUNT = 30;
  const scatterChart = Charts.ScatterChart(
    document.getElementById("detailScatterChart"),
    document.getElementById("detailScatterTooltip")
  );
  const histogramChart = Charts.BarChart(
    document.getElementById("detailHistogramChart"),
    document.getElementById("detailHistogramTooltip")
  );

  const savedScansList = document.getElementById("savedScansList");
  const savedScansEmpty = document.getElementById("savedScansEmpty");
  const detailSection = document.getElementById("savedScanDetail");
  const detailName = document.getElementById("detailName");
  const detailMeta = document.getElementById("detailMeta");
  const detailBanner = document.getElementById("detailBanner");
  const detailCloseBtn = document.getElementById("detailCloseBtn");
  const detailScatterModeSteps = document.getElementById("detailScatterModeSteps");
  const detailScatterModePeak = document.getElementById("detailScatterModePeak");
  const detailScatterLegendLabel = document.getElementById("detailScatterLegendLabel");
  const detailScatterYAxisTitle = document.getElementById("detailScatterYAxisTitle");
  const detailRecordTabs = document.getElementById("detailRecordTabs");
  const detailTableSteps = document.getElementById("detailRecordsTableSteps");
  const detailTablePeak = document.getElementById("detailRecordsTablePeak");

  let savedScans = [];
  let activeScan = null;
  let activeMode = "steps";

  function renderDetailScatter() {
    const points = activeMode === "steps" ? activeScan.scatterSteps : activeScan.scatterPeak;
    detailScatterLegendLabel.textContent =
      activeMode === "steps" ? "Steps per starting number" : "Peak value per starting number";
    detailScatterYAxisTitle.textContent = activeMode === "steps" ? "Steps" : "Peak value";
    scatterChart.setData(points, activeMode === "steps" ? "steps" : "peak");
  }

  detailScatterModeSteps.addEventListener("click", () => {
    activeMode = "steps";
    detailScatterModeSteps.setAttribute("aria-pressed", "true");
    detailScatterModePeak.setAttribute("aria-pressed", "false");
    renderDetailScatter();
  });
  detailScatterModePeak.addEventListener("click", () => {
    activeMode = "peak";
    detailScatterModeSteps.setAttribute("aria-pressed", "false");
    detailScatterModePeak.setAttribute("aria-pressed", "true");
    renderDetailScatter();
  });

  detailRecordTabs.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      detailRecordTabs.querySelectorAll(".tab-btn").forEach((b) => b.setAttribute("aria-selected", "false"));
      btn.setAttribute("aria-selected", "true");
      const tab = btn.dataset.tab;
      detailTableSteps.hidden = tab !== "steps";
      detailTablePeak.hidden = tab !== "peak";
    });
  });

  function openDetail(scan) {
    activeScan = scan;
    activeMode = "steps";
    detailScatterModeSteps.setAttribute("aria-pressed", "true");
    detailScatterModePeak.setAttribute("aria-pressed", "false");
    detailRecordTabs.querySelectorAll(".tab-btn").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === "steps"));
    detailTableSteps.hidden = false;
    detailTablePeak.hidden = true;

    detailName.textContent = scan.name;
    detailMeta.textContent =
      `${scan.range_start.toLocaleString()} – ${scan.range_end.toLocaleString()} · saved ${new Date(scan.created_at).toLocaleString()}`;

    document.getElementById("detailCount").textContent = Number(scan.processed).toLocaleString();
    document.getElementById("detailMaxSteps").textContent =
      scan.max_steps_value >= 0
        ? Number(scan.max_steps_n).toLocaleString() + " (" + scan.max_steps_value.toLocaleString() + " steps)"
        : "–";
    document.getElementById("detailMaxPeak").textContent =
      scan.max_peak_value >= 0
        ? Number(scan.max_peak_n).toLocaleString() + " (" + Charts.formatCompact(scan.max_peak_value) + ")"
        : "–";
    document.getElementById("detailElapsed").textContent = fmtElapsed(scan.elapsed_ms);

    const banner = document.createElement("div");
    if (scan.anomaly_count === 0) {
      banner.className = "banner good";
      banner.innerHTML = `<span class="banner-icon">✓</span><span>No counterexamples — every one of the ${Number(scan.processed).toLocaleString()} numbers checked reached 1.</span>`;
    } else {
      banner.className = "banner critical";
      banner.innerHTML = `<span class="banner-icon">⚠</span><span>${scan.anomaly_count} number(s) didn't reach 1 within the ${scan.step_limit}-step cap.</span>`;
    }
    detailBanner.innerHTML = "";
    detailBanner.appendChild(banner);

    renderDetailScatter();
    histogramChart.setData(computeHistogramBins(activeScan.scatterSteps, HISTOGRAM_BIN_COUNT));
    renderRecordsTable(detailTableSteps, scan.top_steps, "steps");
    renderRecordsTable(detailTablePeak, scan.top_peak, "peak");

    detailSection.hidden = false;
    requestAnimationFrame(() => {
      scatterChart.render();
      histogramChart.render();
    });
    detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  detailCloseBtn.addEventListener("click", () => {
    detailSection.hidden = true;
    activeScan = null;
  });

  function fmtRange(start, end) {
    return `${Number(start).toLocaleString()} – ${Number(end).toLocaleString()}`;
  }

  function renderList() {
    savedScansList.innerHTML = "";
    savedScansEmpty.hidden = savedScans.length > 0;
    savedScans.forEach((scan) => {
      const row = document.createElement("div");
      row.className = "saved-scan-row";

      const info = document.createElement("div");
      info.className = "saved-scan-row-info";
      const name = document.createElement("div");
      name.className = "saved-scan-row-name";
      name.textContent = scan.name;
      const meta = document.createElement("div");
      meta.className = "saved-scan-row-meta";
      meta.textContent =
        `${fmtRange(scan.range_start, scan.range_end)} · ${Number(scan.processed).toLocaleString()} numbers verified · ` +
        `saved ${new Date(scan.created_at).toLocaleDateString()}`;
      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "saved-scan-row-actions";
      const viewBtn = document.createElement("button");
      viewBtn.className = "btn-preset";
      viewBtn.type = "button";
      viewBtn.textContent = "View";
      viewBtn.addEventListener("click", () => openDetail(scan));
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-preset";
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteScan(scan));
      actions.appendChild(viewBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(info);
      row.appendChild(actions);
      savedScansList.appendChild(row);
    });
  }

  async function deleteScan(scan) {
    if (!confirm(`Delete "${scan.name}"? This can't be undone.`)) return;
    const client = window.CollatzAuth && window.CollatzAuth.client;
    if (!client) return;
    const { error } = await client.from("saved_scans").delete().eq("id", scan.id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
    savedScans = savedScans.filter((s) => s.id !== scan.id);
    if (activeScan && activeScan.id === scan.id) {
      detailSection.hidden = true;
      activeScan = null;
    }
    renderList();
  }

  async function loadSavedScans() {
    const client = window.CollatzAuth && window.CollatzAuth.client;
    if (!client) return;
    const { data: userData } = await client.auth.getUser();
    if (!userData || !userData.user) return;
    const { data, error } = await client
      .from("saved_scans")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });
    if (error) {
      savedScansEmpty.hidden = false;
      savedScansEmpty.textContent = "Couldn't load saved scans: " + error.message;
      return;
    }
    savedScans = (data || []).map((row) => ({
      ...row,
      scatterSteps: unpackPoints(row.scatter_steps),
      scatterPeak: unpackPoints(row.scatter_peak),
    }));
    renderList();
  }

  // Called by js/auth.js on sign-in/sign-out.
  window.CollatzApp = {
    onSignedIn: async () => {
      await loadSavedScans();
    },
    onSignedOut: () => {
      savedScans = [];
      savedScansEmpty.hidden = false;
      renderList();
      detailSection.hidden = true;
      activeScan = null;
    },
  };

  // ---------- Chart "expand" popup (mirrors app.js) ----------
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

  wireFullscreenButton("detailScatterFullscreenBtn", scatterChart);
  wireFullscreenButton("detailHistogramFullscreenBtn", histogramChart);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      scatterChart.render();
      histogramChart.render();
    });
  }
})();
