#!/usr/bin/env node
/*
 * Minimal test runner.
 *   node tests/run.js            run every tests/*.test.js
 *   node tests/run.js stage2     only files whose name contains "stage2"
 *   node tests/run.js stage2 inventory   ...and only tests whose name contains "inventory"
 *
 * A test file exports { tests: { 'name': async (ctx) => {...} } }.
 * ctx = { browser, open(query, opts), screenshot(page, name), worker(files), assert, near }
 * Pages opened via ctx.open are closed automatically; page errors fail the test.
 */
const fs = require('fs');
const path = require('path');
const H = require('./harness');

(async () => {
  const [fileFilter, testFilter] = process.argv.slice(2);
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js') && (!fileFilter || f.includes(fileFilter)))
    .sort();
  let browser = null;
  let passed = 0, failed = 0;
  const failures = [];

  for (const file of files) {
    const mod = require(path.join(__dirname, file));
    for (const [name, fn] of Object.entries(mod.tests || {})) {
      if (testFilter && !name.includes(testFilter)) continue;
      const pages = [];
      const ctx = {
        get browser() { return browser; },
        async open(query, opts) {
          if (!browser) browser = await H.launch();
          const r = await H.openGame(browser, query, opts);
          pages.push(r);
          return r;
        },
        screenshot: H.screenshot,
        worker: H.loadWorkerInNode,
        assert: H.assert,
        near: H.near,
      };
      const t0 = Date.now();
      try {
        await fn(ctx);
        const errs = pages.flatMap((p) => p.errors).filter((e) => !/GPU stall|GL Driver Message/.test(e));
        if (errs.length) throw new Error('Page errors:\n  ' + errs.join('\n  '));
        passed++;
        console.log(`  ok   ${file} > ${name}  (${Date.now() - t0} ms)`);
      } catch (e) {
        failed++;
        failures.push(`${file} > ${name}: ${e.stack || e}`);
        console.log(`  FAIL ${file} > ${name}\n       ${String(e.message || e).split('\n').join('\n       ')}`);
      } finally {
        for (const p of pages) await p.page.close().catch(() => {});
      }
    }
  }
  if (browser) await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
