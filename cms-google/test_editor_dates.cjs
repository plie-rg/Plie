const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Exercise the editor's own date input, save boundary, cards and preview without
// a browser, network or Google account. Startup is replaced only in this test.
const elements = new Map();
function element(tagName = 'div') {
  return {
    tagName, innerHTML: '', textContent: '', children: [], value: '', valid: true,
    classList: {add() {}, remove() {}},
    append(...nodes) {this.children.push(...nodes);},
    replaceChildren() {this.children = [];},
    checkValidity() {return this.valid;},
    reportValidity() {this.reported = true; return this.valid;},
    focus() {this.focused = true;},
    close() {}, showModal() {this.open = true;}, querySelectorAll() {return [];}
  };
}
function get(selector) {
  if (!elements.has(selector)) elements.set(selector, element());
  return elements.get(selector);
}
const calls = [];
const context = vm.createContext({
  console, crypto, URLSearchParams, structuredClone,
  location: {hash: '', pathname: '/admin/'}, history: {},
  setInterval() {}, setTimeout() {return 1;}, clearTimeout() {}, confirm: () => true,
  document: {querySelector: get, querySelectorAll: () => [], createElement: element},
  window: {addEventListener() {}, PLIE_CMS_TRANSPORT: {async call(action, payload) {
    calls.push({action, payload: structuredClone(payload)});
    if (action === 'save' || action === 'publish') return {...payload.post, revision: payload.revision + 1};
    if (action === 'posts') return {posts: [context.editor.state.post]};
    throw new Error('Unexpected action: ' + action);
  }}}
});
let source = fs.readFileSync(path.join(__dirname, '../cms-app/web/cms.js'), 'utf8');
assert.match(source, /  start\(\);\s*\}\)\(\);\s*$/);
source = source.replace(/  start\(\);\s*\}\)\(\);\s*$/, '  globalThis.editor={state,blank,validEventDate,comparePosts,card,renderEditor,save,preview,drawGrid};\n})();');
vm.runInContext(source, context);
const editor = context.editor;
editor.state.session = {authenticated: true, google: true, publishing: false, username: 'owner'};

async function main() {
  for (const date of ['', '2024-02-29', '2000-02-29', '1000-01-01', '9999-12-31']) assert.equal(editor.validEventDate(date), true, date);
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0999-01-01', '2026-1-1', '2026-01-01T00:00:00Z', ' 2026-01-01', '<script>', 20260101]) assert.equal(editor.validEventDate(date), false, String(date));

  const rows = [
    {id: 'undated-b', eventDate: '', publishedAt: '2026-10-29T00:00:00Z', updated: '9999-01-01'},
    {id: 'older-event', eventDate: '2025-06-10', publishedAt: '2026-10-29T00:00:00Z'},
    {id: 'same-b', eventDate: '2026-10-01', publishedAt: '2026-10-02T00:00:00Z'},
    {id: 'newer-event', eventDate: '2026-10-28', publishedAt: '2026-01-01T00:00:00Z'},
    {id: 'same-a', eventDate: '2026-10-01', publishedAt: '2026-10-02T00:00:00Z'},
    {id: 'undated-a', publishedAt: '2026-10-29T00:00:00Z'}
  ];
  const expected = ['newer-event', 'same-a', 'same-b', 'older-event', 'undated-a', 'undated-b'];
  assert.deepEqual(rows.slice().sort(editor.comparePosts).map(p => p.id), expected);
  rows.forEach(p => p.updated = '9999-12-31T23:59:59Z');
  assert.deepEqual(rows.slice().sort(editor.comparePosts).map(p => p.id), expected, 'Editing must not reorder events');

  editor.state.post = editor.blank();
  assert.equal(editor.state.post.eventDate, '');
  editor.renderEditor();
  assert.match(get('#app').innerHTML, /id="eventDate" type="date" min="1000-01-01" max="9999-12-31" value=""/);
  assert.match(get('#app').innerHTML, /행사 날짜/);
  assert.match(editor.card(editor.state.post), /행사 날짜 미입력/);
  get('#eventDate').oninput({target: {value: '2024-02-29'}});
  assert.equal(editor.state.post.eventDate, '2024-02-29');
  assert.equal(editor.state.dirty, true);
  await editor.save(false);
  assert.equal(calls.find(c => c.action === 'save').payload.post.eventDate, '2024-02-29');
  assert.equal(editor.state.post.eventDate, '2024-02-29');
  assert.match(editor.card(editor.state.post), /2024\.02\.29 행사/);
  editor.preview();
  const previewDate = get('#preview-content').children.find(n => n.tagName === 'time');
  assert.equal(previewDate.textContent, '2024.02.29 행사');
  assert.equal(previewDate.dateTime, '2024-02-29');

  const before = calls.length;
  get('#eventDate').oninput({target: {value: '2026-02-29'}});
  await editor.save(false);
  assert.equal(calls.length, before, 'Impossible dates must not be sent to save');
  assert.match(get('#editor-error').textContent, /올바른 연월일/);
  get('#eventDate').oninput({target: {value: ''}});
  get('#eventDate').valid = false; // Native date inputs report partial typing here.
  await editor.save(false);
  assert.equal(calls.length, before, 'Partially typed native dates must not be treated as intentionally blank');
  get('#eventDate').valid = true;
  await editor.save(false);
  assert.equal(calls.filter(c => c.action === 'save').at(-1).payload.post.eventDate, '', 'Clearing an optional event date must persist');
  editor.preview();
  assert.ok(get('#preview-content').children.some(n => n.textContent === '행사 날짜 미입력'));

  delete editor.state.post.eventDate;
  editor.renderEditor();
  assert.match(get('#app').innerHTML, /id="eventDate"[^>]+value=""/);
  console.log('CMS editor event dates: validation, ordering, save/clear, legacy fields and preview passed.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
