const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
const functions = source.slice(0, source.indexOf('/* =========================================================\n   BUTTONS'));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
    const requests = [];
    const timers = new Map();
    let id = 0;
    const context = vm.createContext({
        console,
        document: { createElement(tagName) {
            return { tagName, children: [], style: {}, events: {},
                appendChild(child) { this.children.push(child); },
                addEventListener(name, callback) { this.events[name] = callback; },
                removeAttribute(name) { delete this[name]; } };
        } },
        browser: { runtime: { sendMessage(message) {
            return new Promise(resolve => requests.push({ message, resolve }));
        } } },
        setTimeout(fn) { timers.set(++id, fn); return id; },
        clearTimeout(key) { timers.delete(key); }
    });
    vm.runInContext(functions, context);
    const api = vm.runInContext('({ startPolling, stopPolling, updateJobUI, createMaster, startDownload })', context);
    const ui = { jobId: 'new', statusElement: {}, progressElement: { style: {} },
        downloadButton: {}, cancelButton: { style: {} } };
    context.testUI = ui;
    vm.runInContext('activeJobUI = testUI', context);
    return { api, requests, timers, ui };
}

test('old polling responses cannot overwrite or stop a newer job', async () => {
    const { api, requests, timers, ui } = harness();
    api.startPolling('old');
    api.startPolling('new');
    requests[1].resolve({ success: true, job: { id: 'new', status: 'waiting', concurrency: 4 } });
    await tick();
    assert.equal(timers.size, 1);
    const text = ui.statusElement.textContent;
    requests[0].resolve({ success: true, job: { id: 'old', status: 'complete' } });
    await tick();
    assert.equal(ui.statusElement.textContent, text);
    assert.equal(timers.size, 1);
    api.updateJobUI({ id: 'old', status: 'error', error: 'Wrong job' });
    assert.equal(ui.statusElement.textContent, text);
});

test('direct MP4 card renders file details and restores native download progress', () => {
    const { api } = harness();
    const card = api.createMaster({ type: 'direct', url: 'https://example.com/video.mp4',
        filename: '<video>.mp4', size: 5000 }, 0,
    { id: 'native', kind: 'direct', mediaUrl: 'https://example.com/video.mp4',
        status: 'saving', bytes: 2500, estimatedBytes: 5000 });
    const walk = node => [node, ...(node.children || []).flatMap(walk)];
    const elements = walk(card);
    assert.equal(elements[1].textContent, 'Direct MP4 1');
    assert.ok(elements.some(element => element.textContent?.includes('<video>.mp4')));
    assert.ok(!elements.some(element => element.textContent === 'Playlist captured'));
    const progress = elements.find(element => element.tagName === 'progress');
    assert.equal(progress.value, 2500);
    assert.equal(progress.max, 5000);
});

test('large direct MP4 starts without the HLS memory warning and sends the direct kind', async () => {
    const { api, requests, ui } = harness();
    const starting = api.startDownload({ kind: 'direct', mediaAnalysis: {
        mediaUrl: 'https://example.com/video.mp4', size: 2 * 1024 ** 3
    } }, ui.downloadButton, ui.cancelButton, ui.statusElement, ui.progressElement);
    assert.equal(requests[0].message.type, 'START_DOWNLOAD');
    assert.equal(requests[0].message.kind, 'direct');
    requests[0].resolve({ success: true, job: { id: 'native', kind: 'direct',
        status: 'preparing', estimatedBytes: 2 * 1024 ** 3, bytes: 0 } });
    await starting;
    assert.equal(requests[1].message.type, 'GET_DOWNLOAD_STATUS');
    assert.ok(ui.statusElement.textContent.includes('Firefox manages this download'));
});

test('polling schedules no overlapping requests and stops at completion', async () => {
    const { api, requests, timers } = harness();
    api.startPolling('new');
    await tick();
    assert.equal(requests.length, 1);
    assert.equal(timers.size, 0);
    requests[0].resolve({ success: true, job: { id: 'new', status: 'complete' } });
    await tick();
    assert.equal(timers.size, 0);
});
