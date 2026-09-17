# Collatz Conjecture Explorer

A small browser app for exploring the Collatz conjecture: pick any positive
integer and it repeats `n → n/2` (n even) or `n → 3n+1` (n odd) until it
hits 1, plotting the trajectory. It can also exhaustively verify a whole
range of integers in a background thread, tracking the longest trajectories
and highest peaks found, and flagging anything that fails to reach 1.

The conjecture is unproven — this app does not solve it. It performs the
same kind of empirical search real attempts on it have used: run the rule,
watch what happens, and see if a counterexample ever turns up (it hasn't,
here or anywhere else, for every value checked so far).

## Running it

No build step or dependencies — it's static HTML/CSS/JS. Serve the folder
with any static file server (a `file://` URL won't work because the range
scanner uses a Web Worker, which browsers block from `file://` origins):

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

## Features

- **Explore a number** — enter any positive integer (arbitrary size, via
  `BigInt`) and see its full hailstone sequence, step count, and peak
  value, plotted as a line chart with a log-scale toggle.
- **Verify a range** — scan every integer in `[start, end]` off the main
  thread, with a live progress bar, a scatter chart of steps/peak per
  starting number, and tables of the top 10 longest trajectories and
  highest peaks found.

## Files

- `index.html` — page structure
- `css/style.css` — theme tokens (light/dark) and component styles
- `js/collatz.js` — core Collatz math, shared by the main thread and worker
- `js/worker.js` — background range-scan worker
- `js/charts.js` — small canvas chart toolkit (line + scatter, with hover)
- `js/app.js` — UI wiring
