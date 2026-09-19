/* Direct MP4 discovery and Firefox-managed downloads. No media buffering. */
const directMediaRecords = new Map();
const mediaRequestHeaders = new Map();

function isKnownHlsResource(tabId, url) {
    const path = getUrlPath(url);
    return [...manifestRecords.values()].some(record =>
        record.tabId === tabId && record.type === "media" &&
        (record.analysis.segmentUrls.some(segment => getUrlPath(segment) === path) ||
            (record.analysis.initSegment && getUrlPath(record.analysis.initSegment) === path))
    );
}

function getDirectStreams(tabId) {
    return [...directMediaRecords.values()]
        .filter(record => record.tabId === tabId && !isKnownHlsResource(tabId, record.url))
        .map(record => ({
            type: "direct", url: record.url, filename: getFilename(record.url) || "MP4 video",
            size: record.size
        }));
}

function clearDirectMedia(tabId) {
    for (const [key, record] of directMediaRecords) {
        if (record.tabId === tabId) directMediaRecords.delete(key);
    }
    for (const [key, record] of mediaRequestHeaders) {
        if (record.tabId === tabId) mediaRequestHeaders.delete(key);
    }
}

// These are supported by downloads.download. Firefox supplies transport headers
// and cookies itself; a player's Range header must never limit the saved file.
function directDownloadHeaders(headers) {
    return cloneHeaders(headers).filter(header =>
        ["referer", "authorization", "accept", "accept-language"].includes(header.name.toLowerCase())
    );
}

browser.webRequest.onSendHeaders.addListener(details => {
    if (details.tabId < 0 || details.method !== "GET" ||
        !["media", "xmlhttprequest", "other", "main_frame", "sub_frame"].includes(details.type)) return;
    mediaRequestHeaders.set(details.requestId, {
        tabId: details.tabId, url: details.url,
        headers: directDownloadHeaders(details.requestHeaders)
    });
    // Bound metadata if a page leaves many requests open indefinitely.
    if (mediaRequestHeaders.size > 1000) {
        mediaRequestHeaders.delete(mediaRequestHeaders.keys().next().value);
    }
}, { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders"]);

browser.webRequest.onHeadersReceived.addListener(details => {
    if (details.tabId < 0 || details.method !== "GET" ||
        ![200, 206].includes(details.statusCode) || !/^https?:\/\//i.test(details.url)) return;
    const header = name => (details.responseHeaders || [])
        .find(item => item.name.toLowerCase() === name)?.value || "";
    const mime = header("content-type").split(";")[0].trim().toLowerCase();
    const path = getUrlPath(details.url);
    const mp4Mime = ["video/mp4", "application/mp4"].includes(mime);
    const mp4Url = /\.mp4$/i.test(path);
    if (!mp4Mime && !(mp4Url && ["", "application/octet-stream", "binary/octet-stream"].includes(mime))) return;
    if (/\.(?:m4s|ts|m3u8)$/i.test(path) || isKnownHlsResource(details.tabId, details.url)) return;

    const request = mediaRequestHeaders.get(details.requestId);
    const total = details.statusCode === 206
        ? header("content-range").match(/\/(\d+)$/)?.[1]
        : header("content-length");
    const size = Number(total);
    const key = `${details.tabId}:${details.url}`;
    const previous = directMediaRecords.get(key);
    directMediaRecords.set(key, {
        tabId: details.tabId, url: details.url,
        size: Number.isSafeInteger(size) && size > 0 ? size : previous?.size || null,
        headers: request?.url === details.url ? request.headers : [],
        incognito: Boolean(details.incognito)
    });
    if (directMediaRecords.size > 500) {
        directMediaRecords.delete(directMediaRecords.keys().next().value);
    }
}, { urls: ["http://*/*", "https://*/*"] }, ["responseHeaders"]);

const forgetMediaRequest = details => mediaRequestHeaders.delete(details.requestId);
browser.webRequest.onCompleted.addListener(forgetMediaRequest, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(forgetMediaRequest, { urls: ["<all_urls>"] });
browser.tabs.onRemoved.addListener(clearDirectMedia);

function startDirectDownload(message) {
    const { tabId, mediaUrl } = message;
    const existing = getTabJob(tabId);
    if (isJobActive(existing)) {
        return { success: false, error: "A Corn Downloader download is already running for this tab." };
    }
    const record = directMediaRecords.get(`${tabId}:${mediaUrl}`);
    if (!record || isKnownHlsResource(tabId, mediaUrl)) {
        return { success: false, error: "This MP4 is no longer available as a direct file. Refresh the video list." };
    }
    if (existing) downloadJobs.delete(existing.id);
    const job = {
        id: createJobId(), tabId, mediaUrl, kind: "direct", qualityLabel: "MP4",
        status: "preparing", message: "Opening Firefox save dialog...",
        completedSegments: 0, totalSegments: 0, bytes: 0, estimatedBytes: record.size,
        speedBps: 0, etaSeconds: null, retries: 0, concurrency: 1,
        filename: null, error: null, downloadId: null, startedAt: Date.now(),
        finishedAt: null, cancelRequested: false, abortController: null
    };
    downloadJobs.set(job.id, job);
    jobByTab.set(tabId, job.id);
    // Return a job immediately so the popup stays responsive during the save dialog.
    runDirectDownload(job, record);
    return { success: true, job: serialiseJob(job) };
}

async function runDirectDownload(job, record) {
    try {
        job.filename = await buildOutputFilename(job, "mp4");
        if (job.cancelRequested) throw new DOMException("Download cancelled", "AbortError");
        const downloadId = await browser.downloads.download({
            url: record.url, filename: job.filename, saveAs: true,
            conflictAction: "uniquify", headers: record.headers,
            incognito: record.incognito
        });
        job.downloadId = downloadId;
        job.status = "saving";
        job.message = "Firefox is downloading the MP4 file...";
        jobByFirefoxDownload.set(downloadId, job.id);
        if (job.cancelRequested) await browser.downloads.cancel(downloadId).catch(() => {});
        await refreshDirectJob(job);
    } catch (error) {
        job.status = job.cancelRequested ? "cancelled" : "error";
        job.message = job.cancelRequested ? "Download cancelled." : "Could not download the MP4 file.";
        job.error = job.cancelRequested ? null : error.message;
        job.finishedAt = Date.now();
    }
}

async function refreshDirectJob(job) {
    if (job?.kind !== "direct" || job.downloadId === null || !isJobActive(job)) return;
    try {
        const [item] = await browser.downloads.search({ id: job.downloadId });
        if (!item) return;
        job.bytes = Math.max(0, item.bytesReceived || 0);
        if (item.totalBytes > 0) job.estimatedBytes = item.totalBytes;
        handleFirefoxDownloadChange({ id: job.downloadId,
            state: { current: item.state }, error: { current: item.error } });
    } catch (error) {
        console.error("[Corn] Could not query MP4 progress:", error);
    }
}

async function getDownloadStatus(job) {
    await refreshDirectJob(job);
    return { success: Boolean(job), job: serialiseJob(job) };
}
