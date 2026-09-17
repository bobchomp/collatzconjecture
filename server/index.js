/**
 * Minimal HTTP server exposing the range scanner over SSE, for
 * ranges too large to run in a browser tab. No framework, no
 * dependencies -- this is small enough that Express etc. would just
 * be extra attack surface in the Docker image.
 *
 * Auth: a shared password read from SCAN_API_PASSWORD, sent by the
 * client as an X-Scan-Password header (not a query param, so it
 * never ends up in server logs or browser history). Compared with a
 * timing-safe check.
 */
const http = require("http");
const crypto = require("crypto");
const { runScan } = require("./scanner");

const PORT = Number(process.env.PORT || 3939);
const PASSWORD = process.env.SCAN_API_PASSWORD;
const MAX_RANGE_END = Number(process.env.MAX_RANGE_END || 1_000_000_000);
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || "https://collatz.rossmackenzie.co.uk,https://bobchomp.github.io"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!PASSWORD) {
  console.error("FATAL: SCAN_API_PASSWORD environment variable is not set.");
  process.exit(1);
}

let jobRunning = false;

function passwordMatches(supplied) {
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Scan-Password");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    sendJson(res, 400, { error: "bad request" });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, jobRunning, maxRangeEnd: MAX_RANGE_END });
    return;
  }

  if (url.pathname !== "/scan") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (!passwordMatches(req.headers["x-scan-password"] || "")) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  const start = Math.floor(Number(url.searchParams.get("start")));
  const end = Math.floor(Number(url.searchParams.get("end")));
  const stepLimit = Math.floor(Number(url.searchParams.get("stepLimit") || 100000));

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    sendJson(res, 400, { error: "invalid range" });
    return;
  }
  if (end > MAX_RANGE_END) {
    sendJson(res, 400, { error: `end exceeds this server's MAX_RANGE_END (${MAX_RANGE_END})` });
    return;
  }
  if (!Number.isFinite(stepLimit) || stepLimit < 10 || stepLimit > 1_000_000) {
    sendJson(res, 400, { error: "invalid stepLimit" });
    return;
  }
  if (jobRunning) {
    sendJson(res, 409, { error: "a scan is already running on this server -- try again shortly" });
    return;
  }

  jobRunning = true;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  runScan(start, end, stepLimit, {
    onProgress: (data) => send("progress", data),
    onDone: (data) => {
      jobRunning = false;
      send("done", data);
      res.end();
    },
    isAborted: () => aborted,
  });
});

server.listen(PORT, () => {
  console.log(`Collatz scan server listening on :${PORT} (MAX_RANGE_END=${MAX_RANGE_END.toLocaleString()})`);
});
