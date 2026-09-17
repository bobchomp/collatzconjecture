/**
 * Small canvas chart toolkit: a trajectory line chart and a scatter
 * chart, both DPR-aware with crosshair/nearest-point hover tooltips.
 * No external deps — kept intentionally small for this one app.
 */
(function (global) {
  function cssVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  function niceTicks(min, max, count) {
    if (min === max) return [min];
    const span = max - min;
    const rawStep = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks = [];
    const first = Math.ceil(min / step) * step;
    for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
    return ticks;
  }

  function formatCompact(n) {
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, "") + "T";
    if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  const PAD = { top: 16, right: 20, bottom: 32, left: 56 };

  /**
   * Line chart for one trajectory series. `points` is [{x, y}, ...].
   * `logScale` draws y on a log10 axis (useful once values spike).
   */
  function LineChart(canvas, tooltipEl) {
    let points = [];
    let logScale = false;
    let seriesColor = "#2a78d6";
    let gridColor = "#e1e0d9";
    let axisColor = "#c3c2b7";
    let textColor = "#898781";

    function render() {
      const { ctx, width, height } = setupCanvas(canvas);
      ctx.clearRect(0, 0, width, height);
      if (points.length === 0) return;

      seriesColor = cssVar(canvas, "--series-1") || seriesColor;
      gridColor = cssVar(canvas, "--gridline") || gridColor;
      axisColor = cssVar(canvas, "--axis") || axisColor;
      textColor = cssVar(canvas, "--text-muted") || textColor;

      const plotW = width - PAD.left - PAD.right;
      const plotH = height - PAD.top - PAD.bottom;

      const xs = points.map((p) => p.x);
      const ys = points.map((p) => (logScale ? Math.log10(Math.max(1, p.y)) : p.y));
      const xMin = 0,
        xMax = Math.max(1, xs[xs.length - 1]);
      const yMin = Math.min(...ys, 0);
      const yMax = Math.max(...ys, 1);

      const xToPx = (x) => PAD.left + (x - xMin) / (xMax - xMin || 1) * plotW;
      const yToPx = (y) => PAD.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

      // Gridlines + y ticks
      const rawTicks = logScale
        ? niceTicks(yMin, yMax, 5)
        : niceTicks(yMin, yMax, 5);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = textColor;
      ctx.font = "11px 'Poppins', system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      rawTicks.forEach((t) => {
        const py = yToPx(t);
        ctx.beginPath();
        ctx.moveTo(PAD.left, py);
        ctx.lineTo(width - PAD.right, py);
        ctx.stroke();
        const label = logScale ? formatCompact(Math.pow(10, t)) : formatCompact(t);
        ctx.fillText(label, PAD.left - 8, py);
      });

      // X axis baseline + a few labels
      ctx.strokeStyle = axisColor;
      ctx.beginPath();
      ctx.moveTo(PAD.left, PAD.top + plotH);
      ctx.lineTo(width - PAD.right, PAD.top + plotH);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xTickCount = Math.min(6, xMax);
      for (let i = 0; i <= xTickCount; i++) {
        const xv = Math.round((xMax / xTickCount) * i);
        ctx.fillText(String(xv), xToPx(xv), PAD.top + plotH + 8);
      }

      // Line
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach((p, i) => {
        const py = logScale ? Math.log10(Math.max(1, p.y)) : p.y;
        const px = xToPx(p.x);
        const pyPx = yToPx(py);
        if (i === 0) ctx.moveTo(px, pyPx);
        else ctx.lineTo(px, pyPx);
      });
      ctx.stroke();

      // End marker with surface ring
      const last = points[points.length - 1];
      const lastY = logScale ? Math.log10(Math.max(1, last.y)) : last.y;
      const lx = xToPx(last.x),
        ly = yToPx(lastY);
      ctx.fillStyle = cssVar(canvas, "--surface-1") || "#fcfcfb";
      ctx.beginPath();
      ctx.arc(lx, ly, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = seriesColor;
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();

      canvas._chartGeom = { xToPx, yToPx, xMin, xMax, plotW, plotH, logScale };
    }

    function handleMove(evt) {
      if (!canvas._chartGeom || points.length === 0) {
        if (tooltipEl) tooltipEl.hidden = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const { xMin, xMax, plotW } = canvas._chartGeom;
      const frac = Math.min(1, Math.max(0, (mx - PAD.left) / plotW));
      const targetX = Math.round(xMin + frac * (xMax - xMin));
      let nearest = points[0];
      for (const p of points) {
        if (Math.abs(p.x - targetX) < Math.abs(nearest.x - targetX)) nearest = p;
      }
      if (!tooltipEl) return;
      const { xToPx, yToPx, logScale: ls } = canvas._chartGeom;
      const py = ls ? Math.log10(Math.max(1, nearest.y)) : nearest.y;
      tooltipEl.hidden = false;
      tooltipEl.style.left = xToPx(nearest.x) + "px";
      tooltipEl.style.top = yToPx(py) + "px";
      tooltipEl.innerHTML = "";
      const strong = document.createElement("div");
      strong.className = "tooltip-value";
      strong.textContent = nearest.y.toLocaleString();
      const sub = document.createElement("div");
      sub.className = "tooltip-label";
      sub.textContent = "step " + nearest.x;
      tooltipEl.appendChild(strong);
      tooltipEl.appendChild(sub);
    }

    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerleave", () => {
      if (tooltipEl) tooltipEl.hidden = true;
    });
    window.addEventListener("resize", () => render());

    return {
      setData(newPoints) {
        points = newPoints;
        render();
      },
      setLogScale(v) {
        logScale = v;
        render();
      },
      render,
    };
  }

  /**
   * Scatter chart for range-scan results. `points` is [{x, y}, ...]
   * (starting number vs. steps-or-peak). Uses a nearest-point hover
   * since points are individually far too small to hit precisely.
   */
  function ScatterChart(canvas, tooltipEl) {
    let points = [];
    let yLabel = "steps";

    function render() {
      const { ctx, width, height } = setupCanvas(canvas);
      ctx.clearRect(0, 0, width, height);
      if (points.length === 0) return;

      const seriesColor = cssVar(canvas, "--series-1") || "#2a78d6";
      const gridColor = cssVar(canvas, "--gridline") || "#e1e0d9";
      const axisColor = cssVar(canvas, "--axis") || "#c3c2b7";
      const textColor = cssVar(canvas, "--text-muted") || "#898781";

      const plotW = width - PAD.left - PAD.right;
      const plotH = height - PAD.top - PAD.bottom;

      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const xMin = Math.min(...xs),
        xMax = Math.max(...xs);
      const yMin = 0,
        yMax = Math.max(...ys, 1);

      const xToPx = (x) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
      const yToPx = (y) => PAD.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = textColor;
      ctx.font = "11px 'Poppins', system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      niceTicks(yMin, yMax, 5).forEach((t) => {
        const py = yToPx(t);
        ctx.beginPath();
        ctx.moveTo(PAD.left, py);
        ctx.lineTo(width - PAD.right, py);
        ctx.stroke();
        ctx.fillText(formatCompact(t), PAD.left - 8, py);
      });

      ctx.strokeStyle = axisColor;
      ctx.beginPath();
      ctx.moveTo(PAD.left, PAD.top + plotH);
      ctx.lineTo(width - PAD.right, PAD.top + plotH);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      niceTicks(xMin, xMax, 5).forEach((t) => {
        ctx.fillText(formatCompact(t), xToPx(t), PAD.top + plotH + 8);
      });

      // Points: small filled dots, series color, no per-point label (too dense)
      ctx.fillStyle = seriesColor;
      const r = points.length > 4000 ? 1.4 : 2.4;
      points.forEach((p) => {
        ctx.beginPath();
        ctx.arc(xToPx(p.x), yToPx(p.y), r, 0, Math.PI * 2);
        ctx.fill();
      });

      canvas._chartGeom = { xToPx, yToPx, xMin, xMax, yMin, yMax, plotW, plotH };
    }

    function handleMove(evt) {
      if (!canvas._chartGeom || points.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const my = evt.clientY - rect.top;
      const { xMin, xMax, plotW } = canvas._chartGeom;
      const frac = Math.min(1, Math.max(0, (mx - PAD.left) / plotW));
      const targetX = xMin + frac * (xMax - xMin);

      // Nearest by x (data is dense along x, this is a good proxy for "closest").
      let nearest = points[0];
      let bestDist = Infinity;
      const step = Math.max(1, Math.floor(points.length / 20000));
      for (let i = 0; i < points.length; i += step) {
        const p = points[i];
        const d = Math.abs(p.x - targetX);
        if (d < bestDist) {
          bestDist = d;
          nearest = p;
        }
      }
      if (!tooltipEl) return;
      const { xToPx, yToPx } = canvas._chartGeom;
      tooltipEl.hidden = false;
      tooltipEl.style.left = xToPx(nearest.x) + "px";
      tooltipEl.style.top = yToPx(nearest.y) + "px";
      tooltipEl.innerHTML = "";
      const strong = document.createElement("div");
      strong.className = "tooltip-value";
      strong.textContent = nearest.y.toLocaleString() + " " + yLabel;
      const sub = document.createElement("div");
      sub.className = "tooltip-label";
      sub.textContent = "n = " + nearest.x.toLocaleString();
      tooltipEl.appendChild(strong);
      tooltipEl.appendChild(sub);
    }

    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerleave", () => {
      if (tooltipEl) tooltipEl.hidden = true;
    });
    window.addEventListener("resize", () => render());

    return {
      setData(newPoints, label) {
        points = newPoints;
        if (label) yLabel = label;
        render();
      },
      render,
    };
  }

  global.Charts = { LineChart, ScatterChart, formatCompact };
})(window);
