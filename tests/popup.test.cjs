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
    const elements = {
        'corn-settings': {},
        status: {},
        streams: { children: [],
            appendChild(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; } }
    };
    let id = 0;
    const context = vm.createContext({
        console,
        document: { getElementById(id) { return elements[id]; }, createElement(tagName) {
            return { tagName, children: [], style: {}, events: {},
                appendChild(child) { this.children.push(child); },
                addEventListener(name, callback) { this.events[name] = callback; },
                removeAttribute(name) { delete this[name]; } };
        } },
        browser: { tabs: { async query() { return [{ id: 1 }]; } }, runtime: { sendMessage(message) {
            return new Promise((resolve, reject) => requests.push({ message, resolve, reject }));
        } } },
        setTimeout(fn) { timers.set(++id, fn); return id; },
        clearTimeout(key) { timers.delete(key); }
    });
    vm.runInContext(functions, context);
    const api = vm.runInContext('({ startPolling, stopPolling, updateJobUI, createMaster, startDownload, createActiveDownloadCard, loadStreams })', context);
    const ui = { jobId: 'new', statusElement: {}, progressElement: { style: {} },
        downloadButton: {}, cancelButton: { style: {} } };
    context.testUI = ui;
    vm.runInContext('activeJobUI = testUI', context);
    return { api, requests, timers, ui, elements };
}

test('late Refresh results cannot duplicate cards or replace current download controls', async () => {
    const { api, requests, elements } = harness();
    const older = api.loadStreams();
    await tick();
    const newer = api.loadStreams();
    await tick();
    const stream = { type: 'direct', url: 'https://example.com/new.mp4', filename: 'new.mp4' };
    requests[2].resolve([stream]);
    requests[3].resolve({ job: { id: 'new', kind: 'direct', mediaUrl: stream.url, status: 'saving', bytes: 5 } });
    await newer;
    const currentCard = elements.streams.children[0];
    requests[0].resolve([{ ...stream, url: 'https://example.com/old.mp4' }]);
    requests[1].resolve({ job: { id: 'old', status: 'waiting' } });
    await older;
    assert.equal(elements.streams.children.length, 1);
    assert.equal(elements.streams.children[0], currentCard);
    assert.equal(elements.status.textContent, '1 video detected');
    const walk = node => [node, ...(node.children || []).flatMap(walk)];
    walk(currentCard).find(node => node.textContent === 'Cancel').events.click();
    assert.equal(requests.at(-1).message.type, 'CANCEL_DOWNLOAD');
    assert.equal(requests.at(-1).message.jobId, 'new');
});

test('a stale Refresh failure cannot overwrite a newer empty result', async () => {
    const { api, requests, elements } = harness();
    const older = api.loadStreams();
    await tick();
    const newer = api.loadStreams();
    await tick();
    requests[2].resolve([]);
    requests[3].resolve({ job: null });
    await newer;
    requests[0].reject(new Error('Old request failed'));
    requests[1].resolve({ job: null });
    await older;
    assert.equal(elements.status.textContent, 'No HLS or MP4 videos detected.');
    assert.equal(elements.streams.children.length, 1);
    assert.equal(elements.streams.children[0].className, 'help');
});

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

test('a download whose detection was cleared still has progress and a working Cancel control', () => {
    const { api, requests } = harness();
    const card = api.createActiveDownloadCard({ id: 'orphan', kind: 'direct',
        status: 'saving', bytes: 5, estimatedBytes: 10 });
    const cancel = card.children.find(child => child.textContent === 'Cancel');
    assert.equal(cancel.style.display, 'inline-block');
    assert.equal(card.children.find(child => child.tagName === 'progress').value, 5);
    assert.equal(requests[0].message.jobId, 'orphan');
    cancel.events.click();
    assert.equal(requests[1].message.type, 'CANCEL_DOWNLOAD');
    assert.equal(requests[1].message.jobId, 'orphan');
});

test('a forgotten job ends polling without leaving stale progress or Cancel controls', async () => {
    const { api, requests, ui, timers } = harness();
    api.startPolling('new');
    requests[0].resolve({ success: false, job: null });
    await tick();
    assert.match(ui.statusElement.textContent, /details were removed/);
    assert.equal(ui.cancelButton.style.display, 'none');
    assert.equal(ui.progressElement.style.display, 'none');
    assert.equal(timers.size, 0);
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
