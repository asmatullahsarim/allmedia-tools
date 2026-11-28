const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../ads.js'), 'utf8');
const banner = fs.readFileSync(path.join(__dirname, '../ads/banner.html'), 'utf8');

function run(enabled, { type = 'leaderboard', width = 400, desktopOnly = false } = {}) {
  const slot = {
    hidden: true,
    width,
    dataset: { displayAd: type },
    children: [],
    classList: { contains: name => name === 'display-ad--desktop' && desktopOnly },
    replaceChildren(...children) { this.children = children; },
  };
  const document = {
    querySelectorAll: () => [slot],
    createElement: tag => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ contentRect: { width: target.width } }]); }
  }
  vm.runInNewContext(source, {
    window: { ALLMEDIA_ADS: { enabled } },
    document,
    ResizeObserver: FakeResizeObserver,
    matchMedia: () => ({ matches: true }),
    URL,
  });
  return slot;
}

const disabled = run(false);
assert.equal(disabled.hidden, true);
assert.equal(disabled.children.length, 0);

const enabled = run(true);
assert.equal(enabled.hidden, false);
assert.equal(enabled.children[1].width, 320);
assert.equal(enabled.children[1].loading, 'eager');
assert.equal(enabled.children[1].referrerPolicy, 'strict-origin-when-cross-origin');
assert.match(enabled.children[1].srcdoc, /bauval\.org\/22\/4ccd05c141a3a268b563bbbabe6c14b2/);
assert.equal(enabled.children[1].attrs.sandbox, undefined);

const rectangle = run(true, { type: 'rectangle', width: 350 });
assert.equal(rectangle.children[1].width, 300);

assert.match(banner, /4ccd05c141a3a268b563bbbabe6c14b2/);
assert.match(banner, /https:\/\/bauval\.org\/22\//);
assert.doesNotMatch(banner, /Paste the EXACT approved/);

console.log('Ad placement checks passed (enablement, responsive sizes, referrerPolicy, and tool banner code).');
