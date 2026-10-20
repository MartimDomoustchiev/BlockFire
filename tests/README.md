# Tests (development only)

Not needed to play. These drive the real game in headless Chromium (SwiftShader WebGL).

Requirements: Node 18+ and Playwright with Chromium. The harness finds Playwright in
`$PLAYWRIGHT_PATH`, a normal `require('playwright')`, or the npx cache (`~/.npm/_npx/*`).
If none exist: `npx playwright install chromium` once (needs internet one time).

```
node tests/run.js                 # all tests
node tests/run.js stage1          # one file
node tests/run.js stage1 physics  # one file, tests whose name contains "physics"
```

Screenshots are written to `tests/output/`. Tests use `?autostart=1` (skip menu, no pointer
lock) and `window.__game` to inspect and drive the simulation.

`net.test.js` (online play) opens a host page and a client page and joins them with the
bridge transport (`?net=bridge`): the harness relays their messages, so no internet is needed.

`app.test.js` checks full screen and the installable web app: it serves the folder from a tiny local web
server, lets the offline cache fill, then shuts the server down and starts a game with no network.
The Mac app has its own check: `BLOCKFIRE.app/Contents/MacOS/BLOCKFIRE --selftest story --report out.json`.
