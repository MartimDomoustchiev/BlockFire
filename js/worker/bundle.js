/* ============================================================
 * Worker bundler.
 *
 * Browsers refuse to start `new Worker('file.js')` from file://, and
 * this game has to run by just double-clicking index.html. So each
 * worker module is written as a normal function (editable/lintable as
 * regular JS); we stitch the function *bodies* together into one
 * script and start the worker from a Blob URL, which works offline
 * and from file://.
 *
 * Module order matters only for top-level `const`s; function
 * declarations are hoisted across the whole concatenated script.
 * ============================================================ */
const WorkerBundle = {
  parts: [],
  add(fn) { this.parts.push(fn); },
  source() {
    return this.parts.map(fn => {
      const s = fn.toString();
      return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}'));
    }).join('\n;\n');
  },
  url() {
    return URL.createObjectURL(new Blob([this.source()], { type: 'text/javascript' }));
  },
};
