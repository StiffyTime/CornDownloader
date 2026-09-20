/*
 * Corn Downloader 0.8.1
 *
 * Privacy:
 * - No telemetry
 * - No external service
 * - No analytics
 * - All settings stored locally in Firefox
 * - Direct MP4 discovery and downloads are handled by direct.js
 *
 * Changes from 0.7.0:
 * - Request timeouts and prompt cancellation
 * - Isolated header replays and per-tab playlist records
 * - Accurate quality matching and fragment validation
 * - Save-dialog cleanup and completion race handling
 */

const DEFAULT_CONCURRENCY = 4;
const VALID_CONCURRENCY = [2, 4, 6, 8];

const MAX_RESOURCE_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 400;
const RESOURCE_TIMEOUT_MS = 60000;
const REPLAY_HEADER = "X-Corn-Replay";
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MANIFESTS_PER_TAB = 24;
const MAX_MANIFESTS = 128;
const MAX_ACTIVE_CAPTURES = 16;
const activeCaptures = new Map();

// Retain only headers needed for media requests, never arbitrary site headers.
function mediaHeaders(headers) {
    const allowed = new Set(["cookie", "authorization", "referer", "origin", "accept", "accept-language"]);
    return cloneHeaders(headers).filter(header => allowed.has(header.name.toLowerCase()));
}

function forgetFinishedJob(job) {
    if (!job?.forgetWhenFinished || isJobActive(job)) return;
    downloadJobs.delete(job.id);
    if (jobByTab.get(job.tabId) === job.id) jobByTab.delete(job.tabId);
    job.mediaUrl = null;
    job.filename = null;
    job.error = null;
    job._samples = [];
}

function clearTabMedia(tabId) {
    for (const capture of activeCaptures.values()) {
        if (capture.tabId === tabId) capture.detach();
    }
    for (const [key, record] of manifestRecords) {
        if (record.tabId === tabId) manifestRecords.delete(key);
    }
    clearDirectMedia(tabId);
    const job = getTabJob(tabId);
    if (job) {
        job.forgetWhenFinished = true;
        forgetFinishedJob(job);
    }
}


const manifestRecords = new Map();

const waitingDownloads = new Map();

const downloadJobs = new Map();

const jobByTab = new Map();

const jobByFirefoxDownload = new Map();

const objectUrlsByDownload = new Map();

/*
 * Per-request token -> replay state
 *
 * Multiple authenticated segment requests may
 * exist simultaneously.
 */
const pendingReplays = new Map();


/* =========================================================
   BASIC HELPERS
========================================================= */

function isHlsManifest(url) {
    return /\.m3u8(?:$|[?#])/i.test(url);
}


function isMediaSegment(url) {
    return /\.(?:m4s|ts|mp4)(?:$|[?#])/i.test(url);
}


function getUrlPath(url) {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}


function getFilename(url) {
    try {
        const pathname =
            new URL(url).pathname;

        const parts =
            pathname.split("/");

        return (
            parts[parts.length - 1] ||
            ""
        );

    } catch {
        return url;
    }
}


function getDirectory(url) {
    const path =
        getUrlPath(url);

    const index =
        path.lastIndexOf("/");

    if (index === -1) {
        return path;
    }

    return path.slice(
        0,
        index + 1
    );
}


function resolveUrl(
    baseUrl,
    relativeUrl
) {
    try {
        return new URL(
            relativeUrl,
            baseUrl
        ).href;

    } catch {
        return relativeUrl;
    }
}


function cloneHeaders(headers) {
    return (headers || []).map(
        header => {

            const copy = {
                name: header.name
            };

            if (
                header.value !==
                undefined
            ) {
                copy.value =
                    header.value;
            }

            if (
                header.binaryValue !==
                undefined
            ) {
                copy.binaryValue =
                    [...header.binaryValue];
            }

            return copy;
        }
    );
}


function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException("Download cancelled", "AbortError");
    }
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        throwIfAborted(signal);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Download cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}


function createJobId() {
    return (
        "corn-" +
        Date.now().toString(36) +
        "-" +
        Math.random()
            .toString(36)
            .slice(2)
    );
}


function sanitiseFilename(name) {
    const cleaned =
        String(name || "video")
            .replace(
                /[<>:"/\\|?*\x00-\x1F]/g,
                "_"
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    if (!cleaned) {
        return "video";
    }

    return cleaned.slice(
        0,
        140
    );
}


function reconstructSegmentUrl(
    derivedUrl,
    observedUrl
) {
    try {
        const derived =
            new URL(
                derivedUrl
            );

        const observed =
            new URL(
                observedUrl
            );

        const sameOrigin = derived.origin === observed.origin;


        derived.protocol =
            observed.protocol;

        derived.host =
            observed.host;
        derived.username = "";
        derived.password = "";


        const merged =
            new URLSearchParams(
                sameOrigin ? derived.search : ""
            );


        for (
            const [
                key,
                value
            ] of observed
                .searchParams
                .entries()
        ) {
            merged.set(
                key,
                value
            );
        }


        const query =
            merged.toString();


        derived.search =
            query
                ? `?${query}`
                : "";


        derived.hash =
            "";


        return derived.href;

    } catch {
        return derivedUrl;
    }
}


/* =========================================================
   SETTINGS
========================================================= */

async function getConcurrencySetting() {
    try {
        const result =
            await browser.storage.local.get(
                "segmentConcurrency"
            );

        const value =
            Number(
                result.segmentConcurrency
            );


        if (
            VALID_CONCURRENCY.includes(
                value
            )
        ) {
            return value;
        }

    } catch (error) {
        console.error(
            "[Corn] Could not read settings:",
            error?.name
        );
    }


    return DEFAULT_CONCURRENCY;
}


async function setConcurrencySetting(
    value
) {
    const concurrency =
        Number(value);


    if (
        !VALID_CONCURRENCY.includes(
            concurrency
        )
    ) {
        throw new Error(
            "Invalid concurrency value."
        );
    }


    await browser.storage.local.set({
        segmentConcurrency:
            concurrency
    });


    return concurrency;
}


/* =========================================================
   HLS ATTRIBUTE PARSING
========================================================= */

function parseAttributeList(text) {
    const attributes = {};
    const parts = [];

    let current = "";
    let insideQuotes = false;


    for (
        const character of text
    ) {

        if (
            character === '"'
        ) {
            insideQuotes =
                !insideQuotes;

            current +=
                character;

            continue;
        }


        if (
            character === "," &&
            !insideQuotes
        ) {
            parts.push(
                current
            );

            current = "";

            continue;
        }


        current +=
            character;
    }


    if (current) {
        parts.push(
            current
        );
    }


    for (
        const part of parts
    ) {

        const equalsIndex =
            part.indexOf("=");


        if (
            equalsIndex === -1
        ) {
            continue;
        }


        const key =
            part
                .slice(
                    0,
                    equalsIndex
                )
                .trim();


        let value =
            part
                .slice(
                    equalsIndex + 1
                )
                .trim();


        if (
            value.startsWith('"') &&
            value.endsWith('"')
        ) {
            value =
                value.slice(
                    1,
                    -1
                );
        }


        attributes[key] =
            value;
    }


    return attributes;
}


function getAttributeValue(
    line,
    name
) {
    const colon =
        line.indexOf(":");


    if (
        colon === -1
    ) {
        return null;
    }


    const attributes =
        parseAttributeList(
            line.slice(
                colon + 1
            )
        );


    return (
        attributes[name] ??
        null
    );
}


function parseResolution(value) {
    if (!value) {
        return null;
    }


    const match =
        value.match(
            /^(\d+)x(\d+)$/
        );


    if (!match) {
        return null;
    }


    return {
        width:
            Number(
                match[1]
            ),

        height:
            Number(
                match[2]
            )
    };
}


function describeCodecs(
    codecString
) {
    if (!codecString) {
        return [];
    }


    return codecString
        .split(",")
        .map(
            codec =>
                codec.trim()
        )
        .filter(Boolean)
        .map(
            codec => {

                const lower =
                    codec.toLowerCase();


                if (
                    lower.startsWith(
                        "avc1"
                    )
                ) {
                    return {
                        raw: codec,
                        name: "H.264"
                    };
                }


                if (
                    lower.startsWith(
                        "hev1"
                    ) ||
                    lower.startsWith(
                        "hvc1"
                    )
                ) {
                    return {
                        raw: codec,
                        name: "HEVC"
                    };
                }


                if (
                    lower.startsWith(
                        "av01"
                    )
                ) {
                    return {
                        raw: codec,
                        name: "AV1"
                    };
                }


                if (
                    lower.startsWith(
                        "vp09"
                    ) ||
                    lower.startsWith(
                        "vp9"
                    )
                ) {
                    return {
                        raw: codec,
                        name: "VP9"
                    };
                }


                if (
                    lower.startsWith(
                        "mp4a"
                    )
                ) {
                    return {
                        raw: codec,
                        name: "AAC"
                    };
                }


                return {
                    raw: codec,
                    name: codec
                };
            }
        );
}


/* =========================================================
   PLAYLIST PARSING
========================================================= */

function determinePlaylistType(text) {
    if (
        text.includes(
            "#EXT-X-STREAM-INF"
        )
    ) {
        return "master";
    }


    if (
        text.includes(
            "#EXTINF:"
        ) ||
        text.includes(
            "#EXT-X-MAP:"
        ) ||
        text.includes(
            "#EXT-X-TARGETDURATION:"
        )
    ) {
        return "media";
    }


    return "unknown";
}


function parseMasterManifest(
    text,
    manifestUrl
) {
    const lines =
        text
            .split(
                /\r?\n/
            )
            .map(
                line =>
                    line.trim()
            );


    const variants =
        [];


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const line =
            lines[i];


        if (
            !line.startsWith(
                "#EXT-X-STREAM-INF:"
            )
        ) {
            continue;
        }


        const attributes =
            parseAttributeList(
                line.slice(
                    "#EXT-X-STREAM-INF:"
                        .length
                )
            );


        let playlistUri =
            null;


        for (
            let j = i + 1;
            j < lines.length;
            j++
        ) {

            if (!lines[j]) {
                continue;
            }


            if (
                lines[j]
                    .startsWith("#")
            ) {
                continue;
            }


            playlistUri =
                lines[j];

            break;
        }


        if (!playlistUri) {
            continue;
        }


        variants.push({

            url:
                resolveUrl(
                    manifestUrl,
                    playlistUri
                ),

            bandwidth:
                attributes.BANDWIDTH
                    ? Number(
                        attributes.BANDWIDTH
                    )
                    : null,

            averageBandwidth:
                attributes[
                    "AVERAGE-BANDWIDTH"
                ]
                    ? Number(
                        attributes[
                            "AVERAGE-BANDWIDTH"
                        ]
                    )
                    : null,

            resolution:
                parseResolution(
                    attributes.RESOLUTION
                ),

            frameRate:
                attributes[
                    "FRAME-RATE"
                ]
                    ? Number(
                        attributes[
                            "FRAME-RATE"
                        ]
                    )
                    : null,

            codecs:
                describeCodecs(
                    attributes.CODECS
                )
        });
    }


    return {
        variants
    };
}


function detectSegmentType(
    urls
) {
    const paths =
        urls.map(
            url =>
                getUrlPath(
                    url
                ).toLowerCase()
        );


    if (
        paths.some(
            path =>
                path.endsWith(
                    ".m4s"
                )
        )
    ) {
        return "fmp4";
    }


    if (
        paths.some(
            path =>
                path.endsWith(
                    ".ts"
                )
        )
    ) {
        return "mpegts";
    }


    if (
        paths.some(
            path =>
                path.endsWith(
                    ".mp4"
                )
        )
    ) {
        return "mp4";
    }


    return "unknown";
}


function createMediaFingerprint(
    segmentUrls,
    totalDuration,
    segmentType,
    initSegment
) {
    const indexes = [
        0,
        1,
        2,
        segmentUrls.length - 1
    ];


    const sampleNames =
        [];


    for (
        const index of indexes
    ) {

        if (
            index < 0 ||
            index >=
                segmentUrls.length
        ) {
            continue;
        }


        const name =
            getFilename(
                segmentUrls[
                    index
                ]
            );


        if (
            !sampleNames.includes(
                name
            )
        ) {
            sampleNames.push(
                name
            );
        }
    }


    return [
        segmentType,
        segmentUrls.length,
        Math.round(
            totalDuration *
            1000
        ),
        initSegment
            ? getFilename(
                initSegment
            )
            : "",
        sampleNames.join(",")
    ].join("|");
}


function parseMediaManifest(
    text,
    manifestUrl
) {
    const lines =
        text
            .split(
                /\r?\n/
            )
            .map(
                line =>
                    line.trim()
            )
            .filter(
                Boolean
            );


    const segmentUrls =
        [];


    let segmentCount =
        0;

    let totalDuration =
        0;

    let pendingDuration =
        null;

    let initSegment =
        null;


    const hasByteRanges = lines.some(line =>
        line.startsWith("#EXT-X-BYTERANGE:") ||
        (line.startsWith("#EXT-X-MAP:") &&
            getAttributeValue(line, "BYTERANGE") !== null)
    );
    const initSegments = new Set();


    const encrypted =
        /#EXT-X-KEY:(?![^\r\n]*METHOD=NONE)/i
            .test(
                text
            );


    for (
        const line of lines
    ) {

        if (
            line.startsWith(
                "#EXTINF:"
            )
        ) {

            const durationText =
                line
                    .slice(
                        "#EXTINF:"
                            .length
                    )
                    .split(",")[0];


            const duration =
                Number(
                    durationText
                );


            if (
                !Number.isNaN(
                    duration
                )
            ) {
                pendingDuration =
                    duration;
            }


            continue;
        }


        if (
            line.startsWith(
                "#EXT-X-MAP:"
            )
        ) {

            const uri =
                getAttributeValue(
                    line,
                    "URI"
                );


            if (uri) {
                initSegment =
                    resolveUrl(
                        manifestUrl,
                        uri
                    );
                initSegments.add(initSegment);
            }


            continue;
        }


        if (
            line.startsWith("#")
        ) {
            continue;
        }


        const segmentUrl =
            resolveUrl(
                manifestUrl,
                line
            );


        segmentUrls.push(
            segmentUrl
        );


        segmentCount++;


        if (
            pendingDuration !==
            null
        ) {
            totalDuration +=
                pendingDuration;
        }


        pendingDuration =
            null;
    }


    const segmentType =
        detectSegmentType(
            segmentUrls
        );


    return {

        segmentCount,

        totalDuration,

        segmentType,

        hasInitSegment:
            Boolean(
                initSegment
            ),

        initSegment,

        segmentUrls,

        hasByteRanges,

        encrypted,

        hasMultipleInitSegments: initSegments.size > 1,

        fingerprint:
            createMediaFingerprint(
                segmentUrls,
                totalDuration,
                segmentType,
                initSegment
            )
    };
}


/* =========================================================
   MANIFEST CAPTURE
========================================================= */

function storeManifest(
    details,
    text
) {
    if (details.tabId < 0 || text.length > MAX_MANIFEST_BYTES || !text.trimStart().startsWith("#EXTM3U")) {
        return;
    }
    const type =
        determinePlaylistType(
            text
        );


    let analysis =
        null;


    if (
        type ===
        "master"
    ) {
        analysis =
            parseMasterManifest(
                text,
                details.url
            );
    }


    if (
        type ===
        "media"
    ) {
        analysis =
            parseMediaManifest(
                text,
                details.url
            );
    }


    // Reinsert updates so eviction removes the least recently captured record.
    manifestRecords.delete(`${details.tabId}:${details.url}`);
    manifestRecords.set(
        `${details.tabId}:${details.url}`,
        {
            url:
                details.url,

            tabId:
                details.tabId,

            type,
            incognito: Boolean(details.incognito),

            analysis,

            capturedAt:
                Date.now()
        }
    );
    const tabRecords = [...manifestRecords].filter(([, record]) => record.tabId === details.tabId);
    while (tabRecords.length > MAX_MANIFESTS_PER_TAB) manifestRecords.delete(tabRecords.shift()[0]);
    while (manifestRecords.size > MAX_MANIFESTS) manifestRecords.delete(manifestRecords.keys().next().value);
}


function captureManifestResponse(details) {
    activeCaptures.get(details.requestId)?.detach();
    if (details.tabId < 0 || activeCaptures.size >= MAX_ACTIVE_CAPTURES) return;
    let filter;
    try {
        filter = browser.webRequest.filterResponseData(details.requestId);
    } catch {
        return; // Observation must never interrupt playback.
    }
    const chunks = [];
    let total = 0;
    let ended = false;
    let timer;
    const release = () => {
        ended = true;
        chunks.length = 0;
        clearTimeout(timer);
        if (activeCaptures.get(details.requestId) === capture) activeCaptures.delete(details.requestId);
    };
    const detach = () => {
        release();
        try { filter.disconnect(); } catch { /* The request may already have ended. */ }
    };
    const capture = { tabId: details.tabId, detach };
    activeCaptures.set(details.requestId, capture);
    timer = setTimeout(detach, 15000);
    filter.ondata = event => {
        if (ended) return;
        // Forward first; reaching a capture limit must not truncate the player's response.
        try { filter.write(event.data); } catch { detach(); return; }
        total += event.data.byteLength;
        if (total > MAX_MANIFEST_BYTES) { detach(); return; }
        chunks.push(new Uint8Array(event.data.slice(0)));
    };
    filter.onerror = detach;
    filter.onstop = () => {
        if (ended) return;
        try {
            const combined = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
            storeManifest(details, new TextDecoder('utf-8').decode(combined));
        } catch {
            // Do not log URLs, cookies, tokens, or response contents.
        } finally {
            release();
            try { filter.close(); } catch { /* Already closed. */ }
        }
    };
}


/* =========================================================
   MASTER -> MEDIA MATCHING
========================================================= */

function findMediaForVariant(variant, mediaRecords) {
    const exact = mediaRecords.find(record => record.url === variant.url);
    if (exact) return exact;

    // Signed URLs and mirrored hosts may differ, but the full path must match.
    // A lone captured playlist is not evidence that every quality uses it.
    const matches = mediaRecords.filter(record =>
        getUrlPath(record.url) === getUrlPath(variant.url)
    );
    matches.sort((a, b) => b.capturedAt - a.capturedAt);
    return matches[0] || null;
}


function findMediaRecord(
    tabId,
    mediaUrl
) {
    const records =
        [
            ...manifestRecords
                .values()
        ].filter(
            record =>
                record.tabId ===
                    tabId &&
                record.type ===
                    "media"
        );


    const exact =
        records.find(
            record =>
                record.url ===
                mediaUrl
        );


    if (exact) {
        return exact;
    }


    const targetPath =
        getUrlPath(
            mediaUrl
        );


    return (
        records.find(
            record =>
                getUrlPath(
                    record.url
                ) ===
                targetPath
        ) ||
        null
    );
}


/*
 * Build master objects and merge obvious mirrored
 * copies of the same underlying stream.
 */
function buildStreamsForTab(
    tabId
) {
    const records =
        [
            ...manifestRecords
                .values()
        ].filter(
            record =>
                record.tabId ===
                tabId
        );


    const masters =
        records.filter(
            record =>
                record.type ===
                "master"
        );


    const mediaRecords =
        records.filter(
            record =>
                record.type ===
                "media"
        );


    const candidates =
        masters.map(
            master => {

                const variants =
                    master
                        .analysis
                        .variants
                        .map(
                            variant => {

                                const child =
                                    findMediaForVariant(
                                        variant,
                                        mediaRecords
                                    );


                                return {

                                    ...variant,

                                    mediaAnalysis:
                                        child
                                            ? {
                                                segmentCount:
                                                    child
                                                        .analysis
                                                        .segmentCount,

                                                totalDuration:
                                                    child
                                                        .analysis
                                                        .totalDuration,

                                                segmentType:
                                                    child
                                                        .analysis
                                                        .segmentType,

                                                hasInitSegment:
                                                    child
                                                        .analysis
                                                        .hasInitSegment,

                                                mediaUrl:
                                                    child.url,

                                                hasByteRanges:
                                                    child
                                                        .analysis
                                                        .hasByteRanges,

                                                encrypted:
                                                    child
                                                        .analysis
                                                        .encrypted,

                                                fingerprint:
                                                    child
                                                        .analysis
                                                        .fingerprint
                                            }
                                            : null
                                };
                            }
                        );


                const signature =
                    variants
                        .map(
                            variant => {

                                const resolution =
                                    variant.resolution
                                        ? `${variant.resolution.width}x${variant.resolution.height}`
                                        : "unknown";


                                const fingerprint =
                                    variant
                                        .mediaAnalysis
                                        ?.fingerprint ||
                                    getUrlPath(
                                        variant.url
                                    );


                                return (
                                    resolution +
                                    ":" +
                                    fingerprint
                                );
                            }
                        )
                        .sort()
                        .join("||");


                return {

                    signature:
                        signature ||
                        getUrlPath(
                            master.url
                        ),

                    capturedAt:
                        master.capturedAt,

                    stream: {

                        success:
                            true,

                        type:
                            "master",

                        url:
                            master.url,

                        variants,

                        sourceCount:
                            1
                    }
                };
            }
        );


    const grouped =
        new Map();


    for (
        const candidate of
        candidates
    ) {

        const existing =
            grouped.get(
                candidate.signature
            );


        if (!existing) {

            grouped.set(
                candidate.signature,
                candidate
            );

            continue;
        }


        existing.stream
            .sourceCount++;


        if (
            candidate.capturedAt >
            existing.capturedAt
        ) {

            const sourceCount =
                existing.stream
                    .sourceCount;


            candidate.stream
                .sourceCount =
                sourceCount;


            grouped.set(
                candidate.signature,
                candidate
            );
        }
    }


    return [
        ...grouped.values()
    ].map(
        item =>
            item.stream
    );
}


/* =========================================================
   JOB METRICS
========================================================= */

function updateJobMetrics(job) {
    const now =
        Date.now();


    if (
        !job._samples
    ) {
        job._samples =
            [];
    }


    job._samples.push({
        time:
            now,

        bytes:
            job.bytes
    });


    /*
     * Keep roughly the last 8 seconds.
     */
    while (
        job._samples.length >
        2 &&
        now -
            job._samples[0]
                .time >
            8000
    ) {
        job._samples.shift();
    }


    let speed =
        0;


    if (
        job._samples.length >=
        2
    ) {

        const first =
            job._samples[0];


        const last =
            job._samples[
                job._samples.length -
                1
            ];


        const elapsed =
            (
                last.time -
                first.time
            ) /
            1000;


        if (
            elapsed > 0
        ) {

            speed =
                (
                    last.bytes -
                    first.bytes
                ) /
                elapsed;
        }
    }


    /*
     * Fallback average until enough rolling
     * samples have accumulated.
     */
    if (
        speed <= 0 &&
        job.startedAt &&
        now >
            job.startedAt
    ) {

        speed =
            job.bytes /
            (
                (
                    now -
                    job.startedAt
                ) /
                1000
            );
    }


    job.speedBps =
        Math.max(
            0,
            speed
        );


    if (
        job.estimatedBytes &&
        job.speedBps > 0
    ) {

        const remaining =
            Math.max(
                0,
                job.estimatedBytes -
                    job.bytes
            );


        job.etaSeconds =
            remaining /
            job.speedBps;

    } else {

        job.etaSeconds =
            null;
    }
}


function serialiseJob(job) {
    if (!job) {
        return null;
    }


    return {

        id:
            job.id,

        kind: job.kind || "hls",

        tabId:
            job.tabId,

        mediaUrl:
            job.mediaUrl,

        qualityLabel:
            job.qualityLabel,

        status:
            job.status,

        message:
            job.message,

        completedSegments:
            job.completedSegments,

        totalSegments:
            job.totalSegments,

        bytes:
            job.bytes,

        estimatedBytes:
            job.estimatedBytes,

        speedBps:
            job.speedBps,

        etaSeconds:
            job.etaSeconds,

        retries:
            job.retries,

        lastRetry:
            job.lastRetry,

        concurrency:
            job.concurrency,

        filename:
            job.filename,

        error:
            job.error,

        downloadId:
            job.downloadId,

        startedAt:
            job.startedAt,

        finishedAt:
            job.finishedAt
    };
}


function getTabJob(
    tabId
) {
    const jobId =
        jobByTab.get(
            tabId
        );


    if (!jobId) {
        return null;
    }


    return (
        downloadJobs.get(
            jobId
        ) ||
        null
    );
}


function isJobActive(job) {
    if (!job) {
        return false;
    }


    return [
        "waiting",
        "downloading",
        "preparing",
        "saving"
    ].includes(
        job.status
    );
}


/* =========================================================
   AUTHENTICATED FETCHING
========================================================= */

async function fetchWithPlayerHeaders(url, playerHeaders, signal) {
    throwIfAborted(signal);
    const token = createJobId();
    const replayState = { url, headers: mediaHeaders(playerHeaders), headersApplied: false };
    pendingReplays.set(token, replayState);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, RESOURCE_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "GET",
            // Never borrow the background page's normal-session cookies, including
            // for private tabs. Only explicitly captured player headers are replayed.
            credentials: "omit",
            cache: "no-store",
            // Redirected replays could forward site credentials to another origin.
            // Detection observes the player's final URL, so downloads use that URL.
            redirect: "error",
            headers: { [REPLAY_HEADER]: token },
            signal: controller.signal
        });
        // Byte-range playlists are unsupported: never assemble partial responses.
        const buffer = response.ok && response.status !== 206
            ? await response.arrayBuffer() : null;
        const ok = Boolean(buffer && buffer.byteLength > 0);
        if (!buffer && response.body) await response.body.cancel();
        return {
            ok, status: response.status, statusText: response.statusText,
            headersApplied: replayState.headersApplied, buffer,
            error: response.status === 206 ? "Unexpected partial response" :
                response.ok && !ok ? "Empty media response" : null
        };
    } catch (error) {
        throwIfAborted(signal);
        return {
            ok: false, status: null, buffer: null,
            headersApplied: replayState.headersApplied,
            error: timedOut ? "Request timed out after 60 seconds" : "Media request failed (network error or redirect)."
        };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        pendingReplays.delete(token);
    }
}


async function downloadOneResource(
    job,
    derivedUrl,
    observedUrl,
    playerHeaders,
    signal,
    description
) {
    const reconstructed =
        reconstructSegmentUrl(
            derivedUrl,
            observedUrl
        );


    const candidates =
        [
            reconstructed,
            derivedUrl
        ].filter(
            (
                value,
                index,
                array
            ) =>
                array.indexOf(
                    value
                ) ===
                index
        );


    let lastFailure =
        null;


    for (
        let attempt = 1;
        attempt <=
            MAX_RESOURCE_ATTEMPTS;
        attempt++
    ) {

        for (
            const candidate of
            candidates
        ) {

            if (
                signal.aborted
            ) {

                throw new DOMException(
                    "Download cancelled",
                    "AbortError"
                );
            }


            const result =
                await fetchWithPlayerHeaders(
                    candidate,
                    new URL(candidate).origin === new URL(observedUrl).origin
                        ? playerHeaders
                        : [],
                    signal
                );


            if (
                result.ok &&
                result.buffer
            ) {

                return result.buffer;
            }


            lastFailure =
                result;
        }


        if (
            attempt <
            MAX_RESOURCE_ATTEMPTS
        ) {

            job.retries++;


            job.lastRetry =
                `${description}: retry ${attempt + 1}/${MAX_RESOURCE_ATTEMPTS}`;


            job.message =
                `Retrying ${description} (${attempt + 1}/${MAX_RESOURCE_ATTEMPTS})...`;


            const retryDelay =
                BASE_RETRY_DELAY_MS *
                Math.pow(
                    2,
                    attempt - 1
                );


            await delay(
                retryDelay,
                signal
            );
        }
    }


    const status =
        lastFailure?.error || (lastFailure?.status
            ? `HTTP ${lastFailure.status}`
            : "unknown error");


    throw new Error(
        `${description} failed after ${MAX_RESOURCE_ATTEMPTS} attempts: ${status}`
    );
}


/* =========================================================
   CONCURRENT WORKER POOL
========================================================= */

async function downloadSegmentsConcurrently(
    job,
    analysis,
    observedUrl,
    playerHeaders,
    controller,
    parts,
    segmentOffset
) {
    let nextIndex =
        0;


    let firstError =
        null;


    async function worker() {

        while (true) {

            if (
                controller.signal
                    .aborted
            ) {

                throw new DOMException(
                    "Download cancelled",
                    "AbortError"
                );
            }


            if (
                firstError
            ) {
                return;
            }


            const index =
                nextIndex++;


            if (
                index >=
                analysis
                    .segmentUrls
                    .length
            ) {
                return;
            }


            try {
                job.message =
                    `Downloading with ${job.concurrency} workers...`;


                const buffer =
                    await downloadOneResource(

                        job,

                        analysis
                            .segmentUrls[
                                index
                            ],

                        observedUrl,

                        playerHeaders,

                        controller.signal,

                        `Segment ${index + 1}`
                    );


                parts[
                    segmentOffset +
                    index
                ] =
                    buffer;


                job.completedSegments++;


                job.bytes +=
                    buffer.byteLength;


                updateJobMetrics(
                    job
                );


            } catch (error) {

                if (!firstError) {

                    firstError =
                        error;


                    controller.abort();
                }


                throw error;
            }
        }
    }


    const workerCount =
        Math.min(
            job.concurrency,
            analysis
                .segmentUrls
                .length
        );


    const workers =
        [];


    for (
        let i = 0;
        i < workerCount;
        i++
    ) {

        workers.push(
            worker()
        );
    }


    // Wait for aborted siblings to release their buffers before the job ends.
    const results = await Promise.allSettled(workers);
    if (firstError) throw firstError;
    const rejected = results.find(result => result.status === "rejected");
    if (rejected) throw rejected.reason;
}


/* =========================================================
   OUTPUT
========================================================= */

async function buildOutputFilename(
    job,
    segmentType
) {
    let title =
        "video";


    try {
        const tab =
            await browser.tabs.get(
                job.tabId
            );


        if (
            tab &&
            tab.title
        ) {
            title =
                tab.title;
        }

    } catch {
        // Source tab may have closed.
    }


    const safeTitle =
        sanitiseFilename(
            title
        );


    const quality =
        sanitiseFilename(
            job.qualityLabel ||
            "video"
        );


    let extension =
        "mp4";


    if (
        segmentType ===
        "mpegts"
    ) {
        extension =
            "ts";
    }


    return (
        `${safeTitle} - ${quality}.${extension}`
    );
}


/* =========================================================
   FULL DOWNLOAD
========================================================= */

async function runDownloadJob(
    job,
    mediaRecord,
    observedUrl,
    playerHeaders
) {
    const analysis =
        mediaRecord.analysis;


    const controller =
        new AbortController();


    job.abortController =
        controller;


    job.status =
        "downloading";


    job.message =
        `Downloading with ${job.concurrency} workers...`;


    job.startedAt =
        Date.now();


    job._samples =
        [];


    const hasInit =
        Boolean(
            analysis.initSegment
        );


    const segmentOffset =
        hasInit
            ? 1
            : 0;


    const parts =
        new Array(
            analysis
                .segmentUrls
                .length +
            segmentOffset
        ).fill(null);

    let objectUrl = null;
    let handedToFirefox = false;

    try {

        if (
            analysis.initSegment
        ) {

            job.message =
                "Downloading initialisation segment...";


            const initBuffer =
                await downloadOneResource(

                    job,

                    analysis
                        .initSegment,

                    observedUrl,

                    playerHeaders,

                    controller.signal,

                    "Initialisation segment"
                );


            parts[0] =
                initBuffer;


            job.bytes +=
                initBuffer.byteLength;


            updateJobMetrics(
                job
            );
        }


        job.message =
            `Downloading with ${job.concurrency} workers...`;


        await downloadSegmentsConcurrently(

            job,

            analysis,

            observedUrl,

            playerHeaders,

            controller,

            parts,

            segmentOffset
        );

        throwIfAborted(controller.signal);


        if (
            parts.some(
                part =>
                    !part
            )
        ) {

            throw new Error(
                "One or more video fragments were missing after download."
            );
        }


        job.status =
            "preparing";


        job.message =
            "Assembling video file...";


        job.etaSeconds =
            0;


        let mimeType =
            "video/mp4";


        if (
            analysis.segmentType ===
            "mpegts"
        ) {
            mimeType =
                "video/mp2t";
        }


        const blob =
            new Blob(
                parts,
                {
                    type:
                        mimeType
                }
            );


        /*
         * Drop our ArrayBuffer references as soon
         * as the Blob owns the completed data.
         *
         * This does not make the extension truly
         * streaming-to-disk, but it allows the
         * original array references to be collected.
         */
        parts.fill(
            null
        );


        const filename =
            await buildOutputFilename(
                job,
                analysis.segmentType
            );

        throwIfAborted(controller.signal);


        job.filename =
            filename;


        objectUrl =
            URL.createObjectURL(
                blob
            );


        job.message =
            "Opening Firefox save dialog...";


        const downloadId =
            await browser.downloads
                .download({

                    url:
                        objectUrl,

                    filename,
                    incognito: Boolean(mediaRecord.incognito),

                    saveAs:
                        true,

                    conflictAction:
                        "uniquify"
                });


        job.downloadId =
            downloadId;


        job.status =
            "saving";


        job.message =
            "Firefox is saving the completed file...";


        objectUrlsByDownload.set(
            downloadId,
            objectUrl
        );


        jobByFirefoxDownload.set(
            downloadId,
            job.id
        );

        handedToFirefox = true;
        // Cancel may arrive while the save dialog is awaiting a choice.
        if (job.cancelRequested) {
            await browser.downloads.cancel(downloadId).catch(() => {});
        }
        // A small file may finish before download() resolves and the ID is registered.
        try {
            const [saved] = await browser.downloads.search({ id: downloadId });
            if (saved) handleFirefoxDownloadChange({
                id: downloadId,
                state: { current: saved.state },
                error: { current: saved.error }
            });
        } catch (error) {
            console.error("[Corn] Could not query save status:", error?.name);
        }


    } catch (error) {

        if (
            error.name ===
                "AbortError" ||
            job.cancelRequested
        ) {

            job.status =
                "cancelled";


            job.message =
                "Download cancelled.";


            job.error =
                null;

        } else {

            job.status =
                "error";


            job.message =
                "Download failed.";


            job.error =
                error.message;


            console.error(
                "[Corn] Download failed:",
                error?.name
            );
        }


        job.finishedAt =
            Date.now();


    } finally {

        parts.fill(null);
        if (objectUrl && !handedToFirefox) URL.revokeObjectURL(objectUrl);
        job.abortController = null;
        forgetFinishedJob(job);
    }
}


/* =========================================================
   START / CANCEL
========================================================= */

async function startDownload(
    message
) {
    const {
        tabId,
        mediaUrl,
        qualityLabel,
        estimatedBytes
    } =
        message;


    const concurrency = await getConcurrencySetting();

    const existing =
        getTabJob(
            tabId
        );


    if (
        isJobActive(
            existing
        )
    ) {

        return {

            success:
                false,

            error:
                "A Corn Downloader download is already running for this tab.",

            job:
                serialiseJob(
                    existing
                )
        };
    }


    const mediaRecord =
        findMediaRecord(
            tabId,
            mediaUrl
        );


    if (!mediaRecord) {

        return {

            success:
                false,

            error:
                "The captured media playlist could not be found. Reload the video and try again."
        };
    }


    const analysis =
        mediaRecord.analysis;


    if (
        !analysis ||
        analysis
            .segmentUrls
            .length ===
            0
    ) {

        return {

            success:
                false,

            error:
                "The media playlist contains no downloadable segments."
        };
    }


    if (
        analysis.hasByteRanges
    ) {

        return {

            success:
                false,

            error:
                "This stream uses HLS byte ranges. Corn Downloader does not support byte-range playlists yet."
        };
    }


    if (
        analysis.encrypted
    ) {

        return {

            success:
                false,

            error:
                "This HLS playlist is encrypted. Corn Downloader only handles unencrypted HLS streams."
        };
    }


    if (analysis.hasMultipleInitSegments) {
        return { success: false, error: "This playlist changes initialisation segments. It needs remuxing before it can be saved correctly." };
    }

    if (existing) downloadJobs.delete(existing.id);


    const job = {

        id:
            createJobId(),

        tabId,

        mediaUrl:
            mediaRecord.url,

        qualityLabel:
            qualityLabel ||
            "video",

        status:
            "waiting",

        message:
            "Waiting for a fresh player segment. Keep the video playing or seek forward.",

        completedSegments:
            0,

        totalSegments:
            analysis
                .segmentUrls
                .length,

        bytes:
            0,

        estimatedBytes:
            Number(
                estimatedBytes
            ) ||
            null,

        speedBps:
            0,

        etaSeconds:
            null,

        retries:
            0,

        lastRetry:
            null,

        concurrency,

        filename:
            null,

        error:
            null,

        downloadId:
            null,

        startedAt:
            null,

        finishedAt:
            null,

        cancelRequested:
            false,

        abortController:
            null,

        _samples:
            []
    };


    downloadJobs.set(
        job.id,
        job
    );


    jobByTab.set(
        tabId,
        job.id
    );


    const previousWaiting =
        waitingDownloads.get(
            tabId
        );


    if (
        previousWaiting
    ) {

        clearTimeout(
            previousWaiting
                .timeout
        );
    }


    const waitingState = {

        jobId:
            job.id,

        mediaRecord,

        segmentPaths: new Set(analysis.segmentUrls.map(getUrlPath)),

        timeout:
            null
    };


    waitingState.timeout =
        setTimeout(
            () => {

                if (
                    waitingDownloads.get(
                        tabId
                    ) !==
                    waitingState
                ) {
                    return;
                }


                waitingDownloads.delete(
                    tabId
                );


                const currentJob =
                    downloadJobs.get(
                        job.id
                    );


                if (
                    currentJob &&
                    currentJob.status ===
                        "waiting"
                ) {

                    currentJob.status =
                        "error";


                    currentJob.message =
                        "No fresh player segment was observed.";


                    currentJob.error =
                        "Keep the video playing, seek forward, then try Download again.";


                    currentJob.finishedAt =
                        Date.now();
                    forgetFinishedJob(currentJob);
                }

            },
            30000
        );


    waitingDownloads.set(
        tabId,
        waitingState
    );


    return {

        success:
            true,

        job:
            serialiseJob(
                job
            )
    };
}


async function cancelDownload(
    jobId
) {
    const job =
        downloadJobs.get(
            jobId
        );


    if (!job) {

        return {

            success:
                false,

            error:
                "Download job not found."
        };
    }


    if (!isJobActive(job)) {
        return { success: true, job: serialiseJob(job) };
    }

    job.cancelRequested =
        true;


    const waiting =
        waitingDownloads.get(
            job.tabId
        );


    if (
        waiting &&
        waiting.jobId ===
            job.id
    ) {

        clearTimeout(
            waiting.timeout
        );


        waitingDownloads.delete(
            job.tabId
        );


        job.status =
            "cancelled";


        job.message =
            "Download cancelled.";


        job.finishedAt =
            Date.now();

        forgetFinishedJob(job);
        return {

            success:
                true,

            job:
                serialiseJob(
                    job
                )
        };
    }


    if (
        job.abortController
    ) {

        job.abortController
            .abort();
    }


    if (
        job.downloadId !==
        null
    ) {

        try {

            await browser.downloads
                .cancel(
                    job.downloadId
                );

        } catch {
            // May already have completed.
        }
    }


    return {

        success:
            true,

        job:
            serialiseJob(
                job
            )
    };
}


/* =========================================================
   NETWORK LISTENERS
========================================================= */

browser.webRequest
    .onBeforeRequest
    .addListener(

        details => {
            // Clear before attaching a capture for a new top-level document.
            if (details.type === "main_frame" && details.tabId >= 0) clearTabMedia(details.tabId);
            if (
                !isHlsManifest(
                    details.url
                )
            ) {
                return {};
            }


            captureManifestResponse(
                details
            );


            return {};
        },

        {
            urls: [
                "<all_urls>"
            ]
        },

        [
            "blocking"
        ]
    );


browser.webRequest
    .onBeforeSendHeaders
    .addListener(

        details => {

            if (
                details.tabId !==
                -1
            ) {
                return {};
            }


            const requestHeaders = details.requestHeaders || [];
            const marker = requestHeaders.find(header =>
                header.name.toLowerCase() === REPLAY_HEADER.toLowerCase()
            );
            if (!marker) return {};

            const replayState = pendingReplays.get(marker.value);
            const headers = requestHeaders.filter(header =>
                header.name.toLowerCase() !== REPLAY_HEADER.toLowerCase()
            );
            // Strip our marker even if a redirect or cancellation ended the replay.
            if (!replayState || replayState.url !== details.url) {
                return { requestHeaders: headers };
            }

            const ignored = new Set([
                "host", "content-length", "connection", "accept-encoding",
                "range", "if-range", "if-none-match", "if-modified-since",
                REPLAY_HEADER.toLowerCase()
            ]);
            const merged = new Map(headers
                .filter(header => !["cookie", "authorization", "range", "if-range", "if-none-match", "if-modified-since"]
                    .includes(header.name.toLowerCase()))
                .map(header => [header.name.toLowerCase(), header]));
            for (const header of replayState.headers) {
                if (!ignored.has(header.name.toLowerCase())) {
                    merged.set(header.name.toLowerCase(), header);
                }
            }
            replayState.headersApplied = true;
            return { requestHeaders: [...merged.values()] };
        },

        {
            urls: [
                "<all_urls>"
            ]
        },

        [
            "blocking",
            "requestHeaders"
        ]
    );


browser.webRequest
    .onSendHeaders
    .addListener(

        details => {

            if (
                details.tabId <
                    0
            ) {
                return;
            }


            const waiting =
                waitingDownloads.get(
                    details.tabId
                );


            if (!waiting) {
                return;
            }


            const job =
                downloadJobs.get(
                    waiting.jobId
                );


            if (
                !job ||
                job.status !==
                    "waiting"
            ) {
                return;
            }


            // Segments may live in a subdirectory or have no file extension.
            // Do not start from an advert or another quality in the same folder.
            if (Boolean(details.incognito) !== Boolean(waiting.mediaRecord.incognito) ||
                !waiting.segmentPaths.has(getUrlPath(details.url))) {
                return;
            }


            clearTimeout(
                waiting.timeout
            );


            waitingDownloads.delete(
                details.tabId
            );


            const observedUrl =
                details.url;


            const playerHeaders =
                mediaHeaders(
                    details.requestHeaders
                );


            runDownloadJob(

                job,

                waiting.mediaRecord,

                observedUrl,

                playerHeaders

            ).catch(
                error => {

                    job.status =
                        "error";


                    job.message =
                        "Download failed.";


                    job.error =
                        error.message;


                    job.finishedAt =
                        Date.now();
                    forgetFinishedJob(job);


                    console.error(
                        "[Corn] Unexpected download error:",
                        error?.name
                    );
                }
            );
        },

        {
            urls: [
                "<all_urls>"
            ]
        },

        [
            "requestHeaders"
        ]
    );


/* =========================================================
   FIREFOX SAVE COMPLETION
========================================================= */

function handleFirefoxDownloadChange(delta) {
    const jobId = jobByFirefoxDownload.get(delta.id);
    const job = downloadJobs.get(jobId);
    const state = delta.state?.current;
    if (!job || !["complete", "interrupted"].includes(state)) return;

    if (state === "complete") {
        job.status = "complete";
        job.message = "Download complete.";
        job.error = null;
    } else {
        job.status = job.cancelRequested ? "cancelled" : "error";
        job.message = job.cancelRequested ? "Download cancelled." : "Firefox could not save the file.";
        job.error = job.cancelRequested ? null : delta.error?.current || "Download interrupted.";
    }
    job.finishedAt = Date.now();
    const objectUrl = objectUrlsByDownload.get(delta.id);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrlsByDownload.delete(delta.id);
    jobByFirefoxDownload.delete(delta.id);
    forgetFinishedJob(job);
}

browser.downloads.onChanged.addListener(handleFirefoxDownloadChange);


/* =========================================================
   POPUP COMMUNICATION
========================================================= */

browser.runtime
    .onMessage
    .addListener(

        message => {

            if (
                message.type ===
                "GET_STREAMS"
            ) {

                return Promise.resolve(
                    [...buildStreamsForTab(message.tabId), ...getDirectStreams(message.tabId)]
                );
            }


            if (
                message.type ===
                "GET_SETTINGS"
            ) {

                return getConcurrencySetting()
                    .then(
                        concurrency => ({

                            success:
                                true,

                            concurrency
                        })
                    );
            }


            if (
                message.type ===
                "SET_CONCURRENCY"
            ) {

                return setConcurrencySetting(
                    message.value
                )
                    .then(
                        concurrency => ({

                            success:
                                true,

                            concurrency
                        })
                    );
            }


            if (
                message.type ===
                "START_DOWNLOAD"
            ) {

                return message.kind === "direct"
                    ? Promise.resolve(startDirectDownload(message))
                    : startDownload(message);
            }


            if (
                message.type ===
                "GET_DOWNLOAD_STATUS"
            ) {

                const job =
                    downloadJobs.get(
                        message.jobId
                    );


                return getDownloadStatus(job);
            }


            if (
                message.type ===
                "GET_TAB_DOWNLOAD"
            ) {

                const job =
                    getTabJob(
                        message.tabId
                    );


                return Promise.resolve({

                    success:
                        true,

                    job:
                        serialiseJob(
                            job
                        )
                });
            }


            if (
                message.type ===
                "CANCEL_DOWNLOAD"
            ) {

                return cancelDownload(
                    message.jobId
                );
            }


            if (
                message.type ===
                "CLEAR_STREAMS"
            ) {
                clearTabMedia(message.tabId);


                return Promise.resolve({
                    success:
                        true
                });
            }


            return undefined;
        }
    );


/* =========================================================
   TAB CLEANUP
========================================================= */

browser.tabs.onRemoved.addListener(tabId => {
    const job = getTabJob(tabId);
    clearTabMedia(tabId);
    if (job && isJobActive(job)) {
        cancelDownload(job.id).finally(() => forgetFinishedJob(job));
    }
});
