# Deploying the scan server to Google Cloud Run (free)

An alternative to running `server/` on your own hardware: Google Cloud Run
runs the exact same container, gives you a working `https://` URL
automatically (no Cloudflare Tunnel, no home network exposure), and scales
to zero when idle -- nothing running, nothing costs anything. Usage stays
within Cloud Run's permanent free monthly quota (360,000 GiB-seconds +
180,000 vCPU-seconds) for anything short of very heavy daily use.

No code changes needed -- `server/index.js` already reads `PORT` from the
environment and binds to all interfaces, which is exactly what Cloud Run
requires.

## 1. One-time Google Cloud setup

1. Create a project (or use an existing one) at
   [console.cloud.google.com](https://console.cloud.google.com/) and note
   its **project ID**.
2. Enable billing on it. You won't be charged unless you exceed the free
   quota -- Cloud Run requires a billing account attached regardless.
3. Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install), then:
   ```sh
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```

## 2. Deploy

From the repo root:

```sh
gcloud run deploy collatz-scan-server \
  --source ./server \
  --region us-central1 \
  --memory 16Gi \
  --cpu 4 \
  --timeout 3600 \
  --concurrency 1 \
  --max-instances 1 \
  --allow-unauthenticated \
  --set-env-vars SCAN_API_PASSWORD="$(openssl rand -base64 24)",CACHE_CEILING=2000000000,MAX_RANGE_END=20000000000,ALLOWED_ORIGINS="https://collatz.rossmackenzie.co.uk,https://bobchomp.github.io"
```

This builds the container from `server/Dockerfile` via Cloud Build and
deploys it. Takes a couple of minutes the first time.

**Why these flags:**
- `--memory 16Gi --cpu 4` — a documented, always-available Cloud Run tier.
  At ~6 bytes/number, 16GB comfortably covers a `CACHE_CEILING` past 2
  billion (see below) with headroom for Node's own overhead. 4 CPUs
  matches what's already been benchmarked for this server (this exact
  4-core setup measured ~2.9x faster than single-threaded).
- `CACHE_CEILING=2000000000` — bounds the memoization cache to what 16Gi
  can hold. This is what actually drives memory now, not `MAX_RANGE_END`.
- `MAX_RANGE_END=20000000000` — the scanner still works correctly well
  past `CACHE_CEILING`, just slower per number the further past it a scan
  goes (measured ~3.3x slower at a 10x gap -- see `server/README.md` for
  the real benchmark and the tradeoff curve). 20 billion is a reasonable
  starting ceiling on this tier; a scan run all the way out to it will
  take noticeably longer than one near `CACHE_CEILING`, so the `--timeout
  3600` below matters more as you push closer to `MAX_RANGE_END`. Raise
  `CACHE_CEILING` (and `--memory` with it) instead of just raising
  `MAX_RANGE_END` if you want routine scans out that far to stay fast.
- `--timeout 3600` — the maximum Cloud Run allows (60 minutes), so even a
  very large scan's SSE stream never gets cut off mid-way.
- `--concurrency 1 --max-instances 1` — **important for correctness, not
  just cost**: without this, Cloud Run could spin up a second container
  instance for a second concurrent request, and each instance has its own
  in-memory "one scan at a time" lock -- so two scans could run
  simultaneously on two instances, defeating the point. Capping both at 1
  makes the lock genuinely global.
- `--allow-unauthenticated` — required so the page's anonymous visitors can
  reach it at all. Your app-level password (`SCAN_API_PASSWORD`) is the
  actual gate, same trust model as the homelab + Cloudflare Tunnel setup.
- The `openssl rand -base64 24` inline generates a fresh random password on
  deploy -- copy it from the command's own output/history, or set your own
  fixed value instead if you'd rather choose it yourself.

Swap `CACHE_CEILING` and `--memory`/`--cpu` together if you want a
different memory ceiling -- see the table in `server/README.md` (same
~6 bytes/number math applies here). `MAX_RANGE_END` can be raised
independently of both, at the scan-time cost described above.

**Note**: 4 CPU / 16GiB is a long-standing valid Cloud Run combination, but
I can't verify it against a live GCP account from here, and Google does
occasionally revise the allowed CPU/memory pairings. If `gcloud run deploy`
rejects the combination, it'll say so explicitly and point you at
[the current limits](https://cloud.google.com/run/docs/configuring/services/memory-limits) --
just adjust `--memory`/`--cpu` to a currently-valid pair and update
`MAX_RANGE_END` to match using the same ~6 bytes/number math.

## 3. Get your password back if you forget it

```sh
gcloud run services describe collatz-scan-server --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"
```

(Or use Secret Manager instead of a plain env var if you'd rather it not
show up there at all -- `gcloud secrets create`, then
`--set-secrets SCAN_API_PASSWORD=collatz-password:latest` in place of the
`--set-env-vars` entry for it.)

## 4. Verify

```sh
curl https://collatz-scan-server-XXXXXXXXXX.us-central1.run.app/health
```
(Cloud Run prints the exact URL after `gcloud run deploy` finishes.)
Expect: `{"ok":true,"jobRunning":false,"maxRangeEnd":20000000000}`

## 5. Point the site at it

Same as the homelab setup: open **Verify a range → Server settings** on
the live site, enter the `.run.app` URL and the password, click
**Save & test**.

## 6. Updating

```sh
gcloud run deploy collatz-scan-server --source ./server --region us-central1
```
(Omit the env var flags on redeploy -- Cloud Run keeps the existing ones
unless you explicitly change them.)

**If your service predates `CACHE_CEILING`** (deployed before this
variable existed), a bare redeploy like the one above picks up the new
code but keeps your old `MAX_RANGE_END` and leaves `CACHE_CEILING` unset
(it'll default to 2,000,000,000 in code, same as before). To actually
raise the range ceiling into the tens of billions, redeploy with both env
vars set explicitly:
```sh
gcloud run services update collatz-scan-server --region us-central1 \
  --update-env-vars CACHE_CEILING=2000000000,MAX_RANGE_END=20000000000
```

## Optional: a custom domain instead of `*.run.app`

```sh
gcloud run domain-mappings create --service collatz-scan-server \
  --domain collatz-api.yourdomain.com --region us-central1
```
Cloud Run gives you DNS records to add at your registrar; it provisions
the TLS certificate itself once they're in place.

## Keeping an eye on free-tier usage

**Cloud Console → Billing → Reports**, filtered to Cloud Run, shows usage
against the free quota. For occasional personal use this is very unlikely
to ever approach the limit -- a single 1-billion-number scan at this
configuration uses roughly 1/150th of the monthly free memory quota. A
scan pushed all the way out near `MAX_RANGE_END=20000000000` (past
`CACHE_CEILING`, so slower per number -- see `server/README.md`) uses
more, on the order of 1/7th of the monthly quota for that one run, since
it can take most of the 60-minute timeout. Still comfortably free for
occasional use; just don't expect to run several of those back-to-back
every day.
