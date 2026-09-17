# Collatz scan server

Handles range scans too large for a browser tab (anything above 100,000,000
-- the site's frontend runs those in-browser on its own). Same memoized
algorithm as the browser version, just with far more memory to work with
and spread across every CPU core, streamed back to the page over
Server-Sent Events so the progress bar stays live.

Zero npm dependencies (Node built-ins only) -- the Docker image is just
`node:20-slim` plus a handful of small JS files.

**Two ways to run this**: on your own hardware (this file, below), or for
free on Google Cloud Run with no home network exposure at all --
see `DEPLOY_CLOUDRUN.md`. Same container either way, no code differences.

## Multi-threaded scanning

A scan is split evenly across `SCAN_THREADS` worker threads (default: all
CPU cores the container can see), all reading and writing *one* shared
cache -- so threads benefit from each other's work, not just their own,
and memory isn't duplicated per thread. Verified byte-for-byte identical
results at 1-4 threads against a plain single-threaded reference before
shipping this. Benchmarked on a 4-core box: **~2.9x faster** at 4 threads
than 1 (a 150,000,000 scan went from 24s to 9s end-to-end). More cores
should scale further, though not perfectly linearly (shared-memory
contention and per-scan coordination overhead both grow a little with
thread count).

Override with `SCAN_THREADS=N` in `.env` if you want to leave some cores
free for other things on the same box.

## How big a range can I actually run?

Memory scales with the range's end value at ~6 bytes per number (a Uint16
for step count, a Float32 for peak value -- verified against the exact
Float64 version: step counts are always exact, peak values are off by at
most ~6e-8 relative error, irrelevant for a "highest peak found" display).
This is unaffected by thread count -- the cache is shared, not duplicated.

| End value | Memory needed | Time, 1 thread | Time, 4 threads |
|---|---|---|---|
| 100,000,000 | ~0.6GB | ~15s | ~5s |
| 500,000,000 | ~3GB | ~75s | ~26s |
| 1,000,000,000 | ~6GB | ~2.5 min | ~52s |

(The 4-thread column is extrapolated from the measured 2.9x factor above
100M/150M; times on your actual hardware will depend on core count and
per-core speed.)

Set `MAX_RANGE_END` to whatever your hardware can actually hold, and give
the container at least 2GB of headroom above the number in that table (via
`mem_limit` in `docker-compose.yml`) for Node's own overhead.

## Deploying on your Ubuntu box

1. **Install Docker + Compose**, if you haven't already:
   ```sh
   sudo apt update && sudo apt install -y docker.io docker-compose-plugin
   sudo usermod -aG docker $USER   # log out/in after this
   ```

2. **Get the repo onto the machine** (clone it, or just copy the `server/`,
   `docker-compose.yml`, and `.env.example` files over).

3. **Create your `.env`** from the example, and set a real password:
   ```sh
   cp .env.example .env
   # edit .env: set SCAN_API_PASSWORD to something long and random --
   # this is the only thing stopping a stranger from running scans on
   # your hardware. Adjust MAX_RANGE_END if your box has less than
   # ~8GB free (see table above).
   ```

4. **Start it**:
   ```sh
   docker compose up -d collatz-scan-server
   ```

5. **Verify it's up**, from the same machine:
   ```sh
   curl http://localhost:3939/health
   # {"ok":true,"jobRunning":false,"maxRangeEnd":1000000000}
   ```

At this point the server only exists on your local network. The site (on
GitHub Pages, served over HTTPS) can't call an unencrypted `http://` address
on your home IP even if you port-forwarded it -- browsers block that as
mixed content, and port-forwarding your home router is its own can of
worms anyway. The next step avoids both problems.

## Exposing it with a Cloudflare Tunnel

This gets you a real `https://` URL, backed by a Cloudflare-issued
certificate, with no port forwarding and no static IP needed -- the tunnel
is an outbound connection your homelab makes to Cloudflare, not an inbound
one anyone can scan for.

You'll need a domain added to Cloudflare (any domain -- if
`rossmackenzie.co.uk` is already on Cloudflare's nameservers from the
custom-domain setup, you can reuse it here with a different subdomain, e.g.
`collatz-api.rossmackenzie.co.uk`).

1. Go to the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
   → **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared**, name it (e.g. `collatz-scan-server`), and on the
   "Install and run connector" step, copy the token from the Docker command
   it shows you (a long string after `--token`) -- that's your `TUNNEL_TOKEN`.
3. Add it to your `.env`:
   ```
   TUNNEL_TOKEN=<paste it here>
   ```
4. Still in that tunnel's setup, add a **Public Hostname**:
   - Subdomain: `collatz-api` (or whatever you like)
   - Domain: your domain on Cloudflare
   - Service: `HTTP` → `collatz-scan-server:3939` (the container name and
     port from `docker-compose.yml` -- cloudflared reaches it over the
     compose network, not localhost)
5. Start the tunnel alongside the server:
   ```sh
   docker compose up -d
   ```
6. Confirm from *outside* your network (e.g. your phone on mobile data):
   ```sh
   curl https://collatz-api.yourdomain.com/health
   ```

## Pointing the site at it

On the live site, open **Verify a range → Server settings**, enter:
- **Server URL**: `https://collatz-api.yourdomain.com` (no trailing slash)
- **Password**: whatever you set as `SCAN_API_PASSWORD`

Click **Save & test** -- it confirms both connectivity and the password in
one step, and reports the range ceiling your server allows. From then on,
any range you enter above 100,000,000 automatically streams from your
server; anything at or below that still runs instantly in-browser with no
dependency on your homelab being online.

## Notes on safety

- **The password is the only protection.** Anyone with it can make your
  server run a multi-minute, multi-GB computation. Don't reuse a password
  from elsewhere, and don't share the URL+password casually.
- **One scan at a time, enforced server-side.** A second request while one
  is running gets a `409`, not queued -- the frontend surfaces this as an
  error rather than silently waiting.
- **`MAX_RANGE_END` is enforced server-side too**, not just trusted from
  the page, so it holds even if someone crafts a request by hand.
- **A dropped connection cancels the job** (checked between chunks), so a
  closed tab or lost network doesn't leave a scan running forever unwatched.

## Updating

```sh
git pull   # if you cloned the repo
docker compose up -d --build
```
