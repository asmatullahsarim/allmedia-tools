const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ads.js'), 'utf8');
function run(enabled, present = true) {
  const slot = { hidden:true, children:[], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } };
  const document = { getElementById:()=>present ? slot : null, createElement:tag=>({tag, attrs:{}, setAttribute(k,v){this.attrs[k]=v;} }) };
  vm.runInNewContext(source, {window:{ALLMEDIA_ADS:{enabled}}, document});
  return slot;
}
assert.equal(run(false).hidden, true);
assert.equal(run(false).children.length, 0);
assert.equal(run(true, false).children.length, 0);
const enabled = run(true);
assert.equal(enabled.hidden, false);
assert.equal(enabled.children[1].src, 'ads/banner.html');
assert.equal(enabled.children[1].width, '320');
assert.ok(!enabled.children[1].attrs.sandbox.includes('allow-same-origin'));
console.log('Ad placement checks passed (disabled, missing slot, configured frame, sandbox).');
