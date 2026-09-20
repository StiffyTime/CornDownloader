const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = ['background.js', 'direct.js'].map(file =>
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const playlist = '#EXTM3U\n#EXTINF:5,\nsegments/one.ts\n#EXTINF:5,\nsegments/two.ts\n#EXT-X-ENDLIST';
const url = 'https://media.example/video/720.m3u8';
const segment = 'https://media.example/video/segments/one.ts';
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
    const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
    const timers = new Map();
    const revoked = [];
    let timerId = 0;
    const browser = {
        storage: { local: { get: async () => ({ segmentConcurrency: 4 }), set: async () => {} } },
        webRequest: { onBeforeRequest: event(), onBeforeSendHeaders: event(), onSendHeaders: event(),
            onHeadersReceived: event(), onCompleted: event(), onErrorOccurred: event() },
        downloads: { onChanged: event(), download: async () => 99, cancel: async () => {}, search: async () => [] },
        runtime: { onMessage: event() },
        tabs: { onRemoved: event(), get: async () => ({ title: 'Example video' }) }
    };
    class TestURL extends URL {
        static createObjectURL() { return 'blob:test'; }
        static revokeObjectURL(value) { revoked.push(value); }
    }
    const context = vm.createContext({
        browser, URL: TestURL, URLSearchParams, AbortController, DOMException, Blob,
        TextDecoder, Uint8Array, console: { error() {} },
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }),
        ...overrides
    });
    vm.runInContext(source, context);
    const api = vm.runInContext(`({
        parseMediaManifest, storeManifest, findMediaRecord, findMediaForVariant,
        buildStreamsForTab, startDownload, cancelDownload, runDownloadJob,
        fetchWithPlayerHeaders, downloadSegmentsConcurrently, delay,
        manifestRecords, pendingReplays, downloadJobs, waitingDownloads,
        objectUrlsByDownload, jobByFirefoxDownload, directMediaRecords, mediaRequestHeaders,
        getDirectStreams, startDirectDownload, getDownloadStatus, clearDirectMedia,
        captureManifestResponse, activeCaptures, clearTabMedia, jobByTab,
        MAX_MANIFEST_BYTES, MAX_MANIFESTS_PER_TAB, MAX_MANIFESTS, MAX_ACTIVE_CAPTURES,
        downloadOneResource, reconstructSegmentUrl
    })`, context);
    const headerListener = browser.webRequest.onBeforeSendHeaders.listeners[0];
    return { api, browser, context, timers, revoked, headerListener };
}

async function jobFixture(h) {
    h.api.storeManifest({ tabId: 1, url }, playlist);
    const result = await h.api.startDownload({ tabId: 1, mediaUrl: url, qualityLabel: '720p' });
    assert.equal(result.success, true);
    const job = h.api.downloadJobs.get(result.job.id);
    return { job, record: h.api.findMediaRecord(1, url) };
}

test('identical playlists remain available independently in two tabs', () => {
    const { api } = harness();
    api.storeManifest({ tabId: 1, url }, playlist);
    api.storeManifest({ tabId: 2, url }, playlist);
    assert.equal(api.manifestRecords.size, 2);
    assert.equal(api.findMediaRecord(1, url).tabId, 1);
    assert.equal(api.findMediaRecord(2, url).tabId, 2);
    api.storeManifest({ tabId: -1, url }, playlist);
    api.storeManifest({ tabId: 3, url }, '<html>Error</html>');
    assert.equal(api.manifestRecords.size, 2);
});

function captureFixture(h, requestId = 'capture', tabId = 1) {
    const forwarded = [];
    const filter = { closed: false, detached: false,
        write(data) { forwarded.push(Buffer.from(data)); },
        close() { this.closed = true; }, disconnect() { this.detached = true; } };
    h.browser.webRequest.filterResponseData = () => filter;
    h.api.captureManifestResponse({ requestId, tabId, url });
    const send = text => {
        const bytes = new TextEncoder().encode(text);
        filter.ondata({ data: bytes.buffer });
    };
    return { filter, send, forwarded };
}

test('capture forwards the original response and releases buffers and timer on completion', () => {
    const h = harness();
    const { filter, send, forwarded } = captureFixture(h);
    send(playlist.slice(0, 12)); send(playlist.slice(12)); filter.onstop();
    assert.equal(Buffer.concat(forwarded).toString(), playlist);
    assert.equal(h.api.manifestRecords.size, 1);
    assert.equal(filter.closed, true);
    assert.equal(h.api.activeCaptures.size, 0);
    assert.equal(h.timers.size, 0);
});

test('oversized, errored, expired and cleared captures cannot store a partial playlist', () => {
    for (const cause of ['size', 'error', 'timeout', 'clear']) {
        const h = harness();
        const { filter, send } = captureFixture(h);
        send(playlist);
        if (cause === 'size') send(' '.repeat(h.api.MAX_MANIFEST_BYTES));
        if (cause === 'error') filter.onerror();
        if (cause === 'timeout') [...h.timers.values()][0].fn();
        if (cause === 'clear') h.api.clearTabMedia(1);
        filter.onstop();
        assert.equal(filter.detached, true, cause);
        assert.equal(h.api.activeCaptures.size, 0, cause);
        assert.equal(h.api.manifestRecords.size, 0, cause);
        assert.equal(h.timers.size, 0, cause);
    }
});

test('capture and record limits bound many requests without filtering excess playback', () => {
    const h = harness();
    let created = 0;
    h.browser.webRequest.filterResponseData = () => { created++; return { disconnect() {} }; };
    for (let i = 0; i < 100; i++) h.api.captureManifestResponse({ tabId: 1, requestId: i, url });
    assert.equal(created, h.api.MAX_ACTIVE_CAPTURES);
    for (let i = 0; i < 200; i++) h.api.storeManifest({ tabId: 1, url: `${url}?${i}` }, playlist);
    assert.equal(h.api.manifestRecords.size, h.api.MAX_MANIFESTS_PER_TAB);
    for (let i = 2; i < 200; i++) h.api.storeManifest({ tabId: i, url }, playlist);
    assert.equal(h.api.manifestRecords.size, h.api.MAX_MANIFESTS);
});

test('HLS replays omit ambient credentials, reject redirects and discard unrelated headers', async () => {
    const h = harness();
    let sent;
    h.context.fetch = async (requestUrl, options) => {
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        sent = h.headerListener({ tabId: -1, url: requestUrl, requestHeaders: [
            ...Object.entries(options.headers).map(([name, value]) => ({ name, value })),
            { name: 'Cookie', value: 'ambient=normal' }, { name: 'Authorization', value: 'ambient' }
        ] }).requestHeaders;
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer };
    };
    await h.api.fetchWithPlayerHeaders(segment, [
        { name: 'Cookie', value: 'private=source' }, { name: 'X-Account-Secret', value: 'unrelated' }
    ], new AbortController().signal);
    assert.equal(sent.find(header => header.name === 'Cookie').value, 'private=source');
    assert.ok(!sent.some(header => /authorization|x-account|x-corn/i.test(header.name)));
    await h.api.fetchWithPlayerHeaders(segment, [], new AbortController().signal);
    assert.ok(!sent.some(header => /cookie|authorization/i.test(header.name)));
});

test('fallback to another HLS origin never copies captured player headers', async () => {
    const h = harness();
    const calls = [];
    h.context.fetchWithPlayerHeaders = async (candidate, headers) => {
        calls.push({ candidate, headers });
        return calls.length === 1 ? { ok: false } : { ok: true, buffer: new ArrayBuffer(1) };
    };
    await h.api.downloadOneResource({}, 'https://another.example/one.ts', segment,
        [{ name: 'Cookie', value: 'session=source' }, { name: 'Referer', value: 'https://private.example' }],
        new AbortController().signal, 'test');
    assert.equal(calls[0].headers.length, 2);
    assert.equal(calls[1].headers.length, 0);
});

test('private HLS saves use private download history', async () => {
    const h = harness();
    h.api.storeManifest({ tabId: 1, url, incognito: true }, playlist);
    const result = await h.api.startDownload({ tabId: 1, mediaUrl: url });
    const job = h.api.downloadJobs.get(result.job.id);
    h.api.waitingDownloads.delete(1);
    let options;
    h.browser.downloads.download = async value => { options = value; return 99; };
    await h.api.runDownloadJob(job, h.api.findMediaRecord(1, url), segment, []);
    assert.equal(options.incognito, true);
});

test('closed tabs cancel and forget waiting jobs and captured media', async () => {
    const h = harness();
    const { job } = await jobFixture(h);
    h.browser.tabs.onRemoved.listeners.forEach(listener => listener(1));
    await tick();
    assert.equal(h.api.manifestRecords.size, 0);
    assert.equal(h.api.waitingDownloads.size, 0);
    assert.equal(h.api.downloadJobs.size, 0);
    assert.equal(h.api.jobByTab.size, 0);
    assert.equal(job.mediaUrl, null);
});

test('navigation clears detections and completed jobs, and late MP4 responses stay cleared', async () => {
    const h = harness();
    const details = captureMp4(h);
    h.browser.downloads.search = async () => [{ id: 99, state: 'complete' }];
    h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    await tick();
    h.browser.webRequest.onBeforeRequest.listeners[0]({ tabId: 1, type: 'main_frame', url: 'https://example.com/new-page' });
    h.browser.webRequest.onHeadersReceived.listeners[0](details);
    assert.equal(h.api.getDirectStreams(1).length, 0);
    assert.equal(h.api.downloadJobs.size, 0);
});

test('closing a tab during the MP4 save dialog cancels and forgets the eventual download', async () => {
    const h = harness();
    const details = captureMp4(h, { incognito: true });
    const pending = deferred();
    const cancelled = [];
    h.browser.downloads.download = () => pending.promise;
    h.browser.downloads.cancel = async id => { cancelled.push(id); };
    h.browser.downloads.search = async () => [{ id: 99, state: 'interrupted' }];
    h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    await tick();
    h.browser.tabs.onRemoved.listeners.forEach(listener => listener(1));
    pending.resolve(99);
    await tick();
    assert.deepEqual(cancelled, [99]);
    assert.equal(h.api.downloadJobs.size, 0);
    assert.equal(h.api.jobByFirefoxDownload.size, 0);
});

test('container MP4 downloads fail clearly instead of silently using normal cookies', () => {
    const h = harness();
    const details = captureMp4(h, { cookieStoreId: 'firefox-container-2' });
    const result = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    assert.equal(result.success, false);
    assert.match(result.error, /container/);
    assert.equal(h.api.downloadJobs.size, 0);
});

test('cached MP4 responses remain detectable without a send-headers event', () => {
    const h = harness();
    const details = { tabId: 1, requestId: 'cached', method: 'GET', type: 'media',
        url: 'https://media.example/cached.mp4', statusCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }] };
    h.browser.webRequest.onBeforeRequest.listeners.forEach(listener => listener(details));
    h.browser.webRequest.onHeadersReceived.listeners[0](details);
    assert.equal(h.api.getDirectStreams(1).length, 1);
    h.api.clearTabMedia(1);
    h.browser.webRequest.onHeadersReceived.listeners[0](details);
    assert.equal(h.api.getDirectStreams(1).length, 0);
});

test('CDN reconstruction never sends another origin\'s query credentials to the observed host', () => {
    const h = harness();
    const candidate = new URL(h.api.reconstructSegmentUrl(
        'https://old.example/segment.ts?old_secret=private',
        'https://new.example/first.ts?observed_token=allowed'));
    assert.equal(candidate.host, 'new.example');
    assert.equal(candidate.searchParams.has('old_secret'), false);
    assert.equal(candidate.searchParams.get('observed_token'), 'allowed');
});

test('redirected capture replacement is not removed by late events from the old filter', () => {
    const h = harness();
    const first = captureFixture(h);
    const second = captureFixture(h);
    assert.equal(first.filter.detached, true);
    first.filter.onerror();
    assert.equal(h.api.activeCaptures.size, 1);
    second.send(playlist); second.filter.onstop();
    assert.equal(h.api.manifestRecords.size, 1);
    assert.equal(h.api.activeCaptures.size, 0);
    assert.equal(h.timers.size, 0);
});

test('uncaptured qualities do not borrow the only captured playlist', () => {
    const { api } = harness();
    const records = [{ url, capturedAt: 1 }];
    assert.equal(api.findMediaForVariant({ url: 'https://media.example/video/1080.m3u8' }, records), null);
    assert.equal(api.findMediaForVariant({ url: 'https://mirror.example/video/720.m3u8' }, records), records[0]);
});

test('parser detects init-only byte ranges and changing init segments', () => {
    const { api } = harness();
    const ranged = api.parseMediaManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="200@0"\n#EXTINF:5,\na.m4s', url);
    assert.equal(ranged.hasByteRanges, true);
    const changed = api.parseMediaManifest('#EXTM3U\n#EXT-X-MAP:URI="a.mp4"\n#EXTINF:5,\na.m4s\n#EXT-X-MAP:URI="b.mp4"\n#EXTINF:5,\nb.m4s', url);
    assert.equal(changed.hasMultipleInitSegments, true);
});

test('simultaneous Start messages create one job, using four workers by default', async () => {
    const h = harness();
    h.api.storeManifest({ tabId: 1, url }, playlist);
    const results = await Promise.all([
        h.api.startDownload({ tabId: 1, mediaUrl: url }),
        h.api.startDownload({ tabId: 1, mediaUrl: url })
    ]);
    assert.equal(results.filter(result => result.success).length, 1);
    assert.equal(h.api.downloadJobs.size, 1);
    assert.equal(results[0].job.concurrency, 4);
});

test('replays of the same URL keep separate headers and remove range/conditional headers', async () => {
    const h = harness();
    const received = [];
    h.context.fetch = async (requestUrl, options) => {
        const result = h.headerListener({ tabId: -1, url: requestUrl, requestHeaders: [
            ...Object.entries(options.headers).map(([name, value]) => ({ name, value })),
            { name: 'Host', value: 'media.example' }
        ] });
        received.push(result.requestHeaders);
        await tick();
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer };
    };
    const signal = new AbortController().signal;
    await Promise.all(['first', 'second'].map(value => h.api.fetchWithPlayerHeaders(segment, [
        { name: 'Referer', value }, { name: 'Range', value: 'bytes=10-20' },
        { name: 'If-None-Match', value: 'old' }, { name: 'Host', value: 'wrong.example' }
    ], signal)));
    assert.deepEqual(received.map(headers => headers.find(header => header.name === 'Referer').value), ['first', 'second']);
    for (const headers of received) {
        assert.ok(!headers.some(header => /^(range|if-none-match|x-corn-replay)$/i.test(header.name)));
        assert.equal(headers.find(header => header.name === 'Host').value, 'media.example');
    }
    assert.equal(h.api.pendingReplays.size, 0);
    assert.equal(h.timers.size, 0);
});

test('resource timeout covers stalled response bodies and is retryable', async () => {
    const h = harness();
    h.context.fetch = async (_, { signal }) => ({ ok: true, status: 200,
        arrayBuffer: () => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    });
    const pending = h.api.fetchWithPlayerHeaders(segment, [], new AbortController().signal);
    await tick();
    [...h.timers.values()].find(timer => timer.ms === 60000).fn();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/);
    assert.equal(h.api.pendingReplays.size, 0);
});

test('cancelling an in-flight request rejects as cancellation and clears replay state', async () => {
    const h = harness();
    h.context.fetch = (_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const controller = new AbortController();
    const pending = h.api.fetchWithPlayerHeaders(segment, [], controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(h.api.pendingReplays.size, 0);
    assert.equal(h.timers.size, 0);
});

test('empty and partial media responses cannot become successful fragments', async () => {
    const h = harness();
    for (const status of [200, 206]) {
        h.context.fetch = async () => ({ ok: true, status, arrayBuffer: async () => new ArrayBuffer(0) });
        const result = await h.api.fetchWithPlayerHeaders(segment, [], new AbortController().signal);
        assert.equal(result.ok, false);
        assert.match(result.error, /Empty|partial/);
    }
});

test('cancelling during backoff removes the timer immediately', async () => {
    const h = harness();
    const controller = new AbortController();
    const pending = h.api.delay(1600, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(h.timers.size, 0);
});

test('worker pool respects concurrency and keeps segments in playlist order', async () => {
    const h = harness();
    let active = 0, peak = 0;
    const requests = new Map();
    h.context.downloadOneResource = async (_, index) => {
        active++;
        peak = Math.max(peak, active);
        const request = deferred();
        requests.set(index, request);
        await request.promise;
        active--;
        return new Uint8Array([index]).buffer;
    };
    const job = { concurrency: 4, bytes: 0, completedSegments: 0, _samples: [], startedAt: Date.now() };
    const parts = new Array(6).fill(null);
    const pending = h.api.downloadSegmentsConcurrently(job, { segmentUrls: [0, 1, 2, 3, 4, 5] }, '', [], new AbortController(), parts, 0);
    assert.equal(requests.size, 4);
    for (const index of [3, 1, 0, 2, 5, 4]) { requests.get(index).resolve(); await tick(); }
    await pending;
    assert.equal(peak, 4);
    assert.deepEqual(parts.map(part => new Uint8Array(part)[0]), [0, 1, 2, 3, 4, 5]);
    assert.equal(job.completedSegments, 6);
});

test('worker failure waits for siblings to settle and preserves the original error', async () => {
    const h = harness();
    const sibling = deferred();
    h.context.downloadOneResource = async (_, index) => {
        if (index === 0) throw new Error('segment failed');
        await sibling.promise;
        throw new DOMException('Aborted', 'AbortError');
    };
    const pending = h.api.downloadSegmentsConcurrently({ concurrency: 2 }, { segmentUrls: [0, 1] }, '', [], new AbortController(), [], 0);
    let settled = false;
    const checked = assert.rejects(pending, /segment failed/).then(() => { settled = true; });
    await tick();
    assert.equal(settled, false);
    sibling.resolve();
    await checked;
});

test('save dialog rejection releases the completed Blob URL', async () => {
    const h = harness();
    const { job, record } = await jobFixture(h);
    h.browser.downloads.download = async () => { throw new Error('Save cancelled'); };
    await h.api.runDownloadJob(job, record, segment, []);
    assert.equal(job.status, 'error');
    assert.deepEqual(h.revoked, ['blob:test']);
    assert.equal(h.api.objectUrlsByDownload.size, 0);
});

test('completion before ID registration is reconciled and frees the Blob URL', async () => {
    const h = harness();
    const { job, record } = await jobFixture(h);
    h.browser.downloads.download = async () => {
        h.browser.downloads.onChanged.listeners[0]({ id: 99, state: { current: 'complete' } });
        return 99;
    };
    h.browser.downloads.search = async () => [{ id: 99, state: 'complete' }];
    await h.api.runDownloadJob(job, record, segment, []);
    assert.equal(job.status, 'complete');
    assert.deepEqual(h.revoked, ['blob:test']);
    assert.equal(h.api.jobByFirefoxDownload.size, 0);
});

test('cancellation while save dialog is open cancels the eventual Firefox download', async () => {
    const h = harness();
    const { job, record } = await jobFixture(h);
    // In production onSendHeaders removes this before running the job.
    h.api.waitingDownloads.delete(1);
    const save = deferred();
    const cancelled = [];
    h.browser.downloads.download = () => save.promise;
    h.browser.downloads.cancel = async id => { cancelled.push(id); };
    h.browser.downloads.search = async () => [{ id: 99, state: 'interrupted' }];
    const running = h.api.runDownloadJob(job, record, segment, []);
    await tick();
    await h.api.cancelDownload(job.id);
    save.resolve(99);
    await running;
    assert.deepEqual(cancelled, [99]);
    assert.equal(job.status, 'cancelled');
    assert.deepEqual(h.revoked, ['blob:test']);
});

test('a player segment in a subdirectory starts the job; an unrelated segment does not', async () => {
    const h = harness();
    const { job } = await jobFixture(h);
    const runs = [];
    h.context.runDownloadJob = async (...args) => { runs.push(args); };
    const listener = h.browser.webRequest.onSendHeaders.listeners[0];
    listener({ tabId: 1, url: 'https://media.example/video/advert.ts', requestHeaders: [] });
    assert.equal(runs.length, 0);
    listener({ tabId: 1, url: segment + '?token=fresh', requestHeaders: [] });
    assert.equal(runs.length, 1);
    assert.equal(runs[0][0], job);
});

function captureMp4(h, options = {}) {
    const details = { tabId: 1, requestId: 'mp4-request', method: 'GET', type: 'media',
        url: 'https://media.example/movie.mp4?token=secret', statusCode: 206,
        incognito: false,
        requestHeaders: [{ name: 'Range', value: 'bytes=0-99' },
            { name: 'Cookie', value: 'session=private' }, { name: 'Referer', value: 'https://player.example/' }],
        responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' },
            { name: 'Content-Range', value: 'bytes 0-99/5000' }, { name: 'Content-Length', value: '100' }],
        ...options };
    for (const listener of h.browser.webRequest.onSendHeaders.listeners) listener(details);
    h.browser.webRequest.onHeadersReceived.listeners[0](details);
    return details;
}

test('direct discovery deduplicates range requests, uses full size, and isolates tabs', () => {
    const h = harness();
    captureMp4(h);
    captureMp4(h, { requestId: 'second-range' });
    captureMp4(h, { tabId: 2, requestId: 'other-tab' });
    assert.equal(h.api.getDirectStreams(1).length, 1);
    assert.equal(h.api.getDirectStreams(1)[0].size, 5000);
    assert.equal(h.api.getDirectStreams(2).length, 1);
    h.api.clearDirectMedia(1);
    assert.equal(h.api.getDirectStreams(1).length, 0);
    assert.equal(h.api.getDirectStreams(2).length, 1);
});

test('MP4 discovery accepts MIME-based URLs and binary MP4 URLs, rejects errors and fragments', () => {
    const h = harness();
    captureMp4(h, { url: 'https://media.example/video?id=1' });
    captureMp4(h, { url: 'https://media.example/file.mp4', statusCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/octet-stream' }] });
    for (const options of [
        { url: 'https://media.example/error.mp4', statusCode: 403 },
        { url: 'https://media.example/error.mp4', responseHeaders: [{ name: 'Content-Type', value: 'text/html' }] },
        { url: 'https://media.example/part.m4s' },
        { url: 'https://media.example/part.ts' },
        { url: 'https://media.example/post.mp4', method: 'POST' },
        { url: 'https://media.example/background.mp4', tabId: -1 }
    ]) captureMp4(h, options);
    assert.equal(h.api.getDirectStreams(1).length, 2);
});

test('HLS resources captured before the playlist are hidden once the playlist is known', () => {
    const h = harness();
    captureMp4(h, { url: 'https://media.example/video/init.mp4' });
    captureMp4(h, { url: 'https://media.example/video/part.mp4' });
    assert.equal(h.api.getDirectStreams(1).length, 2);
    h.api.storeManifest({ tabId: 1, url }, '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\npart.mp4');
    assert.equal(h.api.getDirectStreams(1).length, 0);
    assert.equal(h.api.startDirectDownload({ tabId: 1, mediaUrl: 'https://media.example/video/part.mp4' }).success, false);
});

test('direct download uses the complete signed URL, safe headers, private context, and Firefox progress', async () => {
    const h = harness();
    const details = captureMp4(h, { incognito: true });
    let savedOptions;
    h.browser.downloads.download = async options => { savedOptions = options; return 88; };
    h.browser.downloads.search = async () => [{ id: 88, state: 'in_progress', bytesReceived: 123, totalBytes: 5000 }];
    const result = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    assert.equal(result.success, true);
    await tick();
    assert.equal(savedOptions.url, details.url);
    assert.equal(savedOptions.incognito, true);
    assert.equal(savedOptions.headers.length, 1);
    assert.equal(savedOptions.headers[0].name, 'Referer');
    assert.ok(savedOptions.filename.endsWith('.mp4'));
    const job = h.api.downloadJobs.get(result.job.id);
    const status = await h.api.getDownloadStatus(job);
    assert.equal(status.job.kind, 'direct');
    assert.equal(status.job.bytes, 123);
    assert.equal(status.job.estimatedBytes, 5000);
    assert.equal(h.api.objectUrlsByDownload.size, 0);
    h.browser.downloads.search = async () => [{ id: 88, state: 'complete', bytesReceived: 5000, totalBytes: 5000 }];
    assert.equal((await h.api.getDownloadStatus(job)).job.status, 'complete');
    assert.equal(h.api.jobByFirefoxDownload.size, 0);
});

test('MP4 and HLS share the one-active-job rule in both directions', async () => {
    const h = harness();
    const details = captureMp4(h);
    h.api.storeManifest({ tabId: 1, url }, playlist);
    const direct = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    assert.equal(h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url }).success, false);
    assert.equal((await h.api.startDownload({ tabId: 1, mediaUrl: url })).success, false);
    await tick();
    h.browser.downloads.onChanged.listeners[0]({ id: 99, state: { current: 'complete' } });
    const hls = await h.api.startDownload({ tabId: 1, mediaUrl: url });
    assert.equal(hls.success, true);
    assert.equal(h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url }).success, false);
    assert.equal(h.api.downloadJobs.has(direct.job.id), false);
});

test('direct save cancellation handles both a pending dialog and a rejected save', async () => {
    const h = harness();
    const details = captureMp4(h);
    const save = deferred();
    const cancelled = [];
    h.browser.downloads.download = () => save.promise;
    h.browser.downloads.cancel = async id => cancelled.push(id);
    h.browser.downloads.search = async () => [{ id: 77, state: 'interrupted' }];
    const result = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    await tick();
    await h.api.cancelDownload(result.job.id);
    save.resolve(77);
    await tick();
    assert.deepEqual(cancelled, [77]);
    assert.equal(h.api.downloadJobs.get(result.job.id).status, 'cancelled');
    h.browser.downloads.download = async () => { throw new Error('Save dialog dismissed'); };
    const again = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    await tick();
    assert.equal(h.api.downloadJobs.get(again.job.id).status, 'error');
});

test('direct download reconciles completion before Firefox returns the ID', async () => {
    const h = harness();
    const details = captureMp4(h);
    h.browser.downloads.download = async () => {
        h.browser.downloads.onChanged.listeners[0]({ id: 44, state: { current: 'complete' } });
        return 44;
    };
    h.browser.downloads.search = async () => [{ id: 44, state: 'complete' }];
    const result = h.api.startDirectDownload({ tabId: 1, mediaUrl: details.url });
    await tick();
    assert.equal(h.api.downloadJobs.get(result.job.id).status, 'complete');
    assert.equal(h.api.jobByFirefoxDownload.size, 0);
});

test('mixed stream messages and cleanup handle MP4 and HLS together', async () => {
    const h = harness();
    captureMp4(h);
    h.api.storeManifest({ tabId: 1, url: 'https://media.example/master.m3u8' }, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/720.m3u8');
    h.api.storeManifest({ tabId: 1, url }, playlist);
    const message = h.browser.runtime.onMessage.listeners[0];
    const streams = await message({ type: 'GET_STREAMS', tabId: 1 });
    assert.deepEqual(Array.from(streams, stream => stream.type), ['master', 'direct']);
    h.browser.webRequest.onCompleted.listeners[0]({ requestId: 'mp4-request' });
    assert.equal(h.api.mediaRequestHeaders.size, 0);
    await message({ type: 'CLEAR_STREAMS', tabId: 1 });
    assert.equal((await message({ type: 'GET_STREAMS', tabId: 1 })).length, 0);
    captureMp4(h);
    h.browser.tabs.onRemoved.listeners.forEach(listener => listener(1));
    assert.equal(h.api.getDirectStreams(1).length, 0);
});
