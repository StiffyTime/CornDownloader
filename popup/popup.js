let currentTabId = null;

let pollingTimer = null;
let pollingGeneration = 0;

let activeJobUI = null;

let currentConcurrency = 4;


/* =========================================================
   BASIC HELPERS
========================================================= */

async function getCurrentTab() {
    const tabs =
        await browser.tabs.query({
            active: true,
            currentWindow: true
        });

    return tabs[0];
}


function formatBandwidth(value) {
    if (!value) {
        return "Unknown bitrate";
    }

    return (
        `${(
            value /
            1000000
        ).toFixed(2)} Mbps`
    );
}


function formatDuration(seconds) {
    const total =
        Math.round(
            seconds || 0
        );

    const hours =
        Math.floor(
            total / 3600
        );

    const minutes =
        Math.floor(
            (total % 3600) / 60
        );

    const secs =
        total % 60;

    if (hours > 0) {
        return (
            `${hours}:` +
            `${String(minutes)
                .padStart(2, "0")}:` +
            `${String(secs)
                .padStart(2, "0")}`
        );
    }

    return (
        `${minutes}:` +
        `${String(secs)
            .padStart(2, "0")}`
    );
}


function formatBytes(bytes) {
    if (
        bytes === null ||
        bytes === undefined
    ) {
        return "Unknown";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (
        bytes <
        1024 * 1024
    ) {
        return (
            `${(
                bytes /
                1024
            ).toFixed(1)} KB`
        );
    }

    if (
        bytes <
        1024 * 1024 * 1024
    ) {
        return (
            `${(
                bytes /
                1024 /
                1024
            ).toFixed(2)} MB`
        );
    }

    return (
        `${(
            bytes /
            1024 /
            1024 /
            1024
        ).toFixed(2)} GB`
    );
}


function formatSpeed(
    bytesPerSecond
) {
    if (
        !bytesPerSecond ||
        bytesPerSecond <= 0
    ) {
        return "Calculating...";
    }

    return (
        `${formatBytes(
            bytesPerSecond
        )}/s`
    );
}


function formatEta(seconds) {
    if (
        seconds === null ||
        seconds === undefined ||
        !Number.isFinite(seconds) ||
        seconds < 0
    ) {
        return "Calculating...";
    }

    if (seconds < 60) {
        return (
            `${Math.ceil(
                seconds
            )} sec`
        );
    }

    const minutes =
        Math.ceil(
            seconds / 60
        );

    if (minutes < 60) {
        return (
            `${minutes} min`
        );
    }

    const hours =
        Math.floor(
            minutes / 60
        );

    const remainder =
        minutes % 60;

    return (
        `${hours}h ${remainder}m`
    );
}


function getQualityLabel(
    variant
) {
    if (variant.kind === "direct") return "MP4 file";
    if (!variant.resolution) {
        return "Unknown";
    }

    return (
        `${Math.min(
            variant.resolution.width,
            variant.resolution.height
        )}p`
    );
}


function getCodecLabel(
    variant
) {
    return (
        variant.codecs
            ?.map(
                codec =>
                    codec.name
            )
            .join(" + ") ||
        "Unknown codec"
    );
}


function getSegmentLabel(
    type
) {
    if (type === "fmp4") {
        return (
            "Fragmented MP4 (.m4s)"
        );
    }

    if (type === "mpegts") {
        return (
            "MPEG-TS (.ts)"
        );
    }

    if (type === "mp4") {
        return "MP4";
    }

    return (
        type ||
        "Unknown"
    );
}


function estimateFinalBytes(
    variant
) {
    if (variant.kind === "direct") return variant.mediaAnalysis?.size || null;

    if (!variant.mediaAnalysis) {
        return null;
    }

    const bitrate =
        variant.averageBandwidth ||
        variant.bandwidth;

    if (
        !bitrate ||
        !variant
            .mediaAnalysis
            .totalDuration
    ) {
        return null;
    }

    return Math.round(
        (
            bitrate *
            variant
                .mediaAnalysis
                .totalDuration
        ) /
        8
    );
}


function isActiveStatus(
    status
) {
    return [
        "waiting",
        "downloading",
        "preparing",
        "saving"
    ].includes(status);
}


/* =========================================================
   SETTINGS PANEL
========================================================= */

async function createSettingsPanel() {
    const existing =
        document.getElementById(
            "corn-settings"
        );

    if (existing) {
        return;
    }

    /*
     * popup.html does not contain a <main> element.
     *
     * Use the existing streams container as our
     * insertion point instead.
     */
    const streams =
        document.getElementById(
            "streams"
        );

    if (
        !streams ||
        !streams.parentElement
    ) {
        console.error(
            "[Corn popup] Could not find streams container."
        );

        return;
    }

    const panel =
        document.createElement(
            "div"
        );

    panel.id =
        "corn-settings";

    panel.className =
        "settings-panel";


    const label =
        document.createElement(
            "label"
        );

    label.textContent =
        "HLS download workers";


    const select =
        document.createElement(
            "select"
        );

    for (
        const value of
        [2, 4, 6, 8]
    ) {
        const option =
            document.createElement(
                "option"
            );

        option.value =
            String(value);

        option.textContent =
            String(value);

        select.appendChild(
            option
        );
    }


    const note =
        document.createElement(
            "span"
        );

    note.className =
        "settings-note";

    note.textContent =
        "4 recommended";


    panel.appendChild(
        label
    );

    panel.appendChild(
        select
    );

    panel.appendChild(
        note
    );


    /*
     * Insert immediately before #streams.
     */
    streams.parentElement.insertBefore(
        panel,
        streams
    );


    try {
        const result =
            await browser.runtime
                .sendMessage({
                    type:
                        "GET_SETTINGS"
                });

        if (
            result?.success
        ) {
            currentConcurrency =
                result.concurrency;

            select.value =
                String(
                    result.concurrency
                );
        }

    } catch (error) {
        console.error(
            "[Corn popup] Could not load settings:",
            error?.name
        );

        note.textContent =
            "Settings unavailable";
    }


    select.addEventListener(
        "change",
        async () => {
            const value =
                Number(
                    select.value
                );

            try {
                const result =
                    await browser.runtime
                        .sendMessage({
                            type:
                                "SET_CONCURRENCY",

                            value
                        });

                if (
                    result?.success
                ) {
                    currentConcurrency =
                        result.concurrency;

                    note.textContent =
                        `${result.concurrency} workers saved`;

                    setTimeout(
                        () => {
                            note.textContent =
                                result.concurrency ===
                                    4
                                    ? "4 recommended"
                                    : "Stored locally";
                        },
                        1500
                    );
                }

            } catch (error) {
                console.error(
                    "[Corn popup] Could not save settings:",
                    error?.name
                );

                note.textContent =
                    "Could not save";
            }
        }
    );
}


/* =========================================================
   JOB UI
========================================================= */

function updateJobUI(job) {
    if (
        !activeJobUI ||
        !job ||
        activeJobUI.jobId !== job.id
    ) {
        return;
    }

    const {
        statusElement,
        progressElement,
        downloadButton,
        cancelButton
    } =
        activeJobUI;


    if (job.kind === "direct" && isActiveStatus(job.status)) {
        const lines = [job.message || "Downloading MP4...", job.filename || "MP4 video"];
        if (job.status === "saving") {
            lines.push(job.estimatedBytes
                ? `${formatBytes(job.bytes)} / ${formatBytes(job.estimatedBytes)}`
                : `${formatBytes(job.bytes)} downloaded`);
        }
        lines.push("Firefox manages this download. Worker settings apply to HLS.");
        statusElement.textContent = lines.join("\n");
        progressElement.style.display = job.status === "saving" ? "block" : "none";
        if (job.estimatedBytes > 0) {
            progressElement.max = job.estimatedBytes;
            progressElement.value = job.bytes;
        } else {
            progressElement.removeAttribute("value");
        }
        downloadButton.disabled = true;
        cancelButton.style.display = "inline-block";
        return;
    }

    if (
        job.status ===
        "waiting"
    ) {
        statusElement.textContent =
            [
                "Waiting for a fresh player segment...",
                "",
                "Keep the video playing.",
                "If nothing happens, seek forward slightly.",
                "",
                `Workers: ${job.concurrency}`
            ].join("\n");

        progressElement.style.display =
            "none";

        downloadButton.disabled =
            true;

        cancelButton.style.display =
            "inline-block";

        return;
    }


    if (
        job.status ===
        "downloading"
    ) {
        const percentage =
            job.totalSegments > 0
                ? Math.floor(
                    (
                        job.completedSegments /
                        job.totalSegments
                    ) *
                    100
                )
                : 0;

        const lines = [
            job.message ||
                "Downloading...",

            "",

            `${job.completedSegments} / ${job.totalSegments} segments`,

            `${percentage}%`,

            job.estimatedBytes
                ? (
                    `${formatBytes(
                        job.bytes
                    )} / ~${formatBytes(
                        job.estimatedBytes
                    )}`
                )
                : (
                    `${formatBytes(
                        job.bytes
                    )} downloaded`
                ),

            `Speed: ${formatSpeed(
                job.speedBps
            )}`,

            `ETA: ${formatEta(
                job.etaSeconds
            )}`,

            `Workers: ${job.concurrency}`
        ];


        if (
            job.retries > 0
        ) {
            lines.push(
                `Retries: ${job.retries}`
            );

            if (
                job.lastRetry
            ) {
                lines.push(
                    job.lastRetry
                );
            }
        }


        statusElement.textContent =
            lines.join("\n");

        progressElement.style.display =
            "block";

        progressElement.max =
            Math.max(
                job.totalSegments,
                1
            );

        progressElement.value =
            job.completedSegments;

        downloadButton.disabled =
            true;

        cancelButton.style.display =
            "inline-block";

        return;
    }


    if (
        job.status ===
        "preparing"
    ) {
        statusElement.textContent =
            [
                "All media segments downloaded.",
                "",
                "Assembling video file...",
                formatBytes(
                    job.bytes
                )
            ].join("\n");

        progressElement.style.display =
            "block";

        progressElement.max =
            1;

        progressElement.value =
            1;

        downloadButton.disabled =
            true;

        cancelButton.style.display =
            "inline-block";

        return;
    }


    if (
        job.status ===
        "saving"
    ) {
        statusElement.textContent =
            [
                "Video assembled.",
                "",
                "Firefox is saving:",
                job.filename ||
                    "video"
            ].join("\n");

        progressElement.style.display =
            "none";

        downloadButton.disabled =
            true;

        cancelButton.style.display =
            "inline-block";

        return;
    }


    if (
        job.status ===
        "complete"
    ) {
        statusElement.textContent =
            [
                "Download complete.",
                "",
                job.filename ||
                    "Video saved."
            ].join("\n");

        progressElement.style.display =
            "none";

        downloadButton.disabled =
            false;

        downloadButton.textContent =
            "Download Again";

        cancelButton.style.display =
            "none";

        return;
    }


    if (
        job.status ===
        "cancelled"
    ) {
        statusElement.textContent =
            "Download cancelled.";

        progressElement.style.display =
            "none";

        downloadButton.disabled =
            false;

        downloadButton.textContent =
            "Download";

        cancelButton.style.display =
            "none";

        return;
    }


    if (
        job.status ===
        "error"
    ) {
        statusElement.textContent =
            [
                "Download failed.",
                "",
                job.error ||
                    job.message ||
                    "Unknown error."
            ].join("\n");

        progressElement.style.display =
            "none";

        downloadButton.disabled =
            false;

        downloadButton.textContent =
            "Try Again";

        cancelButton.style.display =
            "none";
    }
}


function stopPolling() {
    pollingGeneration++;
    clearTimeout(pollingTimer);
    pollingTimer = null;
}

function startPolling(jobId) {
    stopPolling();
    const generation = pollingGeneration;
    const poll = async () => {
        if (generation !== pollingGeneration) return;
        let keepPolling = true;
        try {
            const result = await browser.runtime.sendMessage({
                type: "GET_DOWNLOAD_STATUS", jobId
            });
            if (generation !== pollingGeneration) return;
            if (result?.success && result.job) {
                updateJobUI(result.job);
                keepPolling = isActiveStatus(result.job.status);
            } else {
                keepPolling = false;
                if (activeJobUI?.jobId === jobId) {
                    activeJobUI.statusElement.textContent = "Download ended; cleared job details were removed. Check Firefox's downloads for the result.";
                    activeJobUI.progressElement.style.display = "none";
                    activeJobUI.cancelButton.style.display = "none";
                    activeJobUI.downloadButton.disabled = true;
                }
            }
        } catch (error) {
            console.error("[Corn popup] Poll failed:", error?.name);
        }
        // Schedule after the response: slow messages cannot overlap or update a new card.
        if (keepPolling && generation === pollingGeneration) {
            pollingTimer = setTimeout(poll, 500);
        }
    };
    poll();
}


/* =========================================================
   DOWNLOAD
========================================================= */

async function startDownload(
    variant,
    downloadButton,
    cancelButton,
    statusElement,
    progressElement
) {
    const media =
        variant.mediaAnalysis;

    if (
        !media ||
        !media.mediaUrl
    ) {
        statusElement.textContent =
            "No captured media playlist is available.";

        return;
    }


    const estimatedBytes =
        estimateFinalBytes(
            variant
        );


    /*
     * Corn Downloader still assembles the
     * finished file in memory.
     */
    if (
        variant.kind !== "direct" &&
        estimatedBytes &&
        estimatedBytes >
            1.25 *
            1024 *
            1024 *
            1024
    ) {
        const proceed =
            confirm(
                "This video is estimated at " +
                formatBytes(
                    estimatedBytes
                ) +
                ".\n\n" +
                "Corn Downloader assembles HLS files in memory before Firefox saves them. Very large downloads may use substantial RAM.\n\nContinue?"
            );

        if (!proceed) {
            return;
        }
    }


    downloadButton.disabled =
        true;

    downloadButton.textContent =
        "Starting...";

    statusElement.textContent =
        "Preparing download...";


    try {
        const result =
            await browser.runtime
                .sendMessage({
                    type:
                        "START_DOWNLOAD",

                    kind: variant.kind || "hls",

                    tabId:
                        currentTabId,

                    mediaUrl:
                        media.mediaUrl,

                    qualityLabel:
                        getQualityLabel(
                            variant
                        ),

                    estimatedBytes
                });


        if (
            !result ||
            !result.success ||
            !result.job
        ) {
            throw new Error(
                result?.error ||
                "Could not start download."
            );
        }


        activeJobUI = {
            jobId:
                result.job.id,

            mediaUrl:
                media.mediaUrl,

            statusElement,

            progressElement,

            downloadButton,

            cancelButton
        };


        downloadButton.textContent =
            "Download";


        updateJobUI(
            result.job
        );


        startPolling(
            result.job.id
        );

    } catch (error) {
        statusElement.textContent =
            [
                "Could not start download.",
                "",
                error.message
            ].join("\n");

        downloadButton.disabled =
            false;

        downloadButton.textContent =
            "Download";
    }
}


async function cancelCurrentDownload() {
    if (
        !activeJobUI ||
        !activeJobUI.jobId
    ) {
        return;
    }


    try {
        const result =
            await browser.runtime
                .sendMessage({
                    type:
                        "CANCEL_DOWNLOAD",

                    jobId:
                        activeJobUI.jobId
                });

        if (
            result?.job
        ) {
            updateJobUI(
                result.job
            );
        }

    } catch (error) {
        console.error(
            "[Corn popup] Cancel failed:",
            error?.name
        );
    }
}


/* =========================================================
   STREAM CARDS
========================================================= */

function createVariant(
    variant,
    existingJob
) {
    const box =
        document.createElement(
            "div"
        );

    box.className =
        "variant";


    const quality =
        document.createElement(
            "div"
        );

    quality.className =
        "variant-quality";

    quality.textContent =
        getQualityLabel(
            variant
        );

    box.appendChild(
        quality
    );


    const details =
        document.createElement(
            "div"
        );

    details.className =
        "variant-details";

    details.textContent = variant.kind === "direct"
        ? `${variant.filename || "MP4 video"} • ${variant.mediaAnalysis.size ? formatBytes(variant.mediaAnalysis.size) : "Size unknown"}`
        : `${formatBandwidth(
            variant.averageBandwidth ||
            variant.bandwidth
        )} • ${getCodecLabel(
            variant
        )}`;

    box.appendChild(
        details
    );


    if (
        variant.resolution
    ) {
        const dimensions =
            document.createElement(
                "div"
            );

        dimensions.className =
            "variant-extra";

        dimensions.textContent =
            `${variant.resolution.width} × ${variant.resolution.height}`;

        if (
            variant.frameRate
        ) {
            dimensions.textContent +=
                ` • ${variant.frameRate} fps`;
        }

        box.appendChild(
            dimensions
        );
    }


    const media =
        variant.mediaAnalysis;


    if (media && variant.kind !== "direct") {
        const info =
            document.createElement(
                "div"
            );

        info.className =
            "variant-extra";


        const estimatedBytes =
            estimateFinalBytes(
                variant
            );


        const heading = document.createElement("div");
        heading.className = "playlist-heading";
        heading.textContent = "Playlist captured";
        info.appendChild(heading);

        const rows = [
            `${media.segmentCount} segments • ${formatDuration(media.totalDuration)}`,
            getSegmentLabel(media.segmentType),
            `Init segment: ${media.hasInitSegment ? "Yes" : "No"}`
        ];
        if (estimatedBytes) {
            rows.push(`Estimated size: ~${formatBytes(estimatedBytes)}`);
        }
        for (const text of rows) {
            const row = document.createElement("div");
            row.textContent = text;
            info.appendChild(row);
        }


        box.appendChild(
            info
        );


        if (
            estimatedBytes &&
            estimatedBytes >
                750 *
                1024 *
                1024
        ) {
            const warning =
                document.createElement(
                    "div"
                );

            warning.className =
                "large-warning";

            warning.textContent =
                "Large download. Corn Downloader still assembles the completed file in memory before saving.";

            box.appendChild(
                warning
            );
        }
    }


    const statusElement =
        document.createElement(
            "div"
        );

    statusElement.className =
        "download-status";

    statusElement.style.whiteSpace =
        "pre-line";

    box.appendChild(
        statusElement
    );


    const progressElement =
        document.createElement(
            "progress"
        );

    progressElement.className =
        "download-progress";

    progressElement.style.display =
        "none";

    box.appendChild(
        progressElement
    );


    const controls =
        document.createElement(
            "div"
        );

    controls.className =
        "variant-controls";


    const downloadButton =
        document.createElement(
            "button"
        );

    downloadButton.className =
        "download-button";

    downloadButton.textContent =
        "Download";

    downloadButton.disabled =
        !media;


    const cancelButton =
        document.createElement(
            "button"
        );

    cancelButton.textContent =
        "Cancel";

    cancelButton.style.display =
        "none";


    downloadButton.addEventListener(
        "click",
        () => {
            startDownload(
                variant,
                downloadButton,
                cancelButton,
                statusElement,
                progressElement
            );
        }
    );


    cancelButton.addEventListener(
        "click",
        cancelCurrentDownload
    );


    controls.appendChild(
        downloadButton
    );

    controls.appendChild(
        cancelButton
    );

    box.appendChild(
        controls
    );


    /*
     * Restore an existing job if the popup
     * was closed and reopened.
     */
    if (
        media &&
        existingJob &&
        existingJob.mediaUrl ===
            media.mediaUrl
    ) {
        activeJobUI = {
            jobId:
                existingJob.id,

            mediaUrl:
                media.mediaUrl,

            statusElement,

            progressElement,

            downloadButton,

            cancelButton
        };


        updateJobUI(
            existingJob
        );


        if (
            isActiveStatus(
                existingJob.status
            )
        ) {
            startPolling(
                existingJob.id
            );
        }
    }


    return box;
}


function createMaster(
    stream,
    index,
    existingJob
) {
    const section =
        document.createElement(
            "section"
        );

    section.className =
        "stream";


    const title =
        document.createElement(
            "h2"
        );

    title.textContent =
        `${stream.type === "direct" ? "Direct MP4" : "HLS Video"} ${index + 1}`;

    section.appendChild(
        title
    );


    if (
        stream.sourceCount &&
        stream.sourceCount > 1
    ) {
        const sourceInfo =
            document.createElement(
                "div"
            );

        sourceInfo.className =
            "source-info";

        sourceInfo.textContent =
            `${stream.sourceCount} mirrored sources merged`;

        section.appendChild(
            sourceInfo
        );
    }


    const variants =
        [
            ...(stream.type === "direct" ? [{
                kind: "direct", filename: stream.filename,
                mediaAnalysis: { mediaUrl: stream.url, size: stream.size }
            }] : stream.variants)
        ];


    variants.sort(
        (a, b) => {
            const qualityA =
                a.resolution
                    ? Math.min(
                        a.resolution.width,
                        a.resolution.height
                    )
                    : 0;

            const qualityB =
                b.resolution
                    ? Math.min(
                        b.resolution.width,
                        b.resolution.height
                    )
                    : 0;

            return (
                qualityB -
                qualityA
            );
        }
    );


    for (
        const variant of variants
    ) {
        section.appendChild(
            createVariant(
                variant,
                existingJob
            )
        );
    }


    return section;
}


/* =========================================================
   POPUP LOAD
========================================================= */

// Keep cancellation accessible when Clear/navigation/eviction removed a job's card.
function createActiveDownloadCard(job) {
    const section = document.createElement("section");
    section.className = "stream";
    const title = document.createElement("h2");
    title.textContent = "Current download";
    const statusElement = document.createElement("div");
    statusElement.className = "download-status";
    statusElement.style.whiteSpace = "pre-line";
    const progressElement = document.createElement("progress");
    progressElement.className = "download-progress";
    const downloadButton = document.createElement("button");
    downloadButton.style.display = "none";
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", cancelCurrentDownload);
    for (const node of [title, statusElement, progressElement, cancelButton]) section.appendChild(node);
    activeJobUI = { jobId: job.id, statusElement, progressElement, downloadButton, cancelButton };
    updateJobUI(job);
    startPolling(job.id);
    return section;
}

async function loadStreams() {
    stopPolling();

    activeJobUI =
        null;


    /*
     * Build settings panel first.
     * This is now safe with the existing popup.html.
     */
    await createSettingsPanel();


    const tab =
        await getCurrentTab();


    if (
        !tab ||
        tab.id === undefined
    ) {
        throw new Error(
            "Could not determine the active Firefox tab."
        );
    }


    currentTabId =
        tab.id;


    const container =
        document.getElementById(
            "streams"
        );


    const status =
        document.getElementById(
            "status"
        );


    if (
        !container ||
        !status
    ) {
        console.error(
            "[Corn popup] Required popup elements are missing."
        );

        return;
    }


    container.replaceChildren();


    status.textContent =
        "Reading captured videos...";


    try {
        const [
            streams,
            jobResult
        ] =
            await Promise.all([

                browser.runtime
                    .sendMessage({
                        type:
                            "GET_STREAMS",

                        tabId:
                            currentTabId
                    }),

                browser.runtime
                    .sendMessage({
                        type:
                            "GET_TAB_DOWNLOAD",

                        tabId:
                            currentTabId
                    })
            ]);


        const existingJob =
            jobResult?.job ||
            null;


        if (
            !streams ||
            streams.length === 0
        ) {
            status.textContent =
                "No HLS or MP4 videos detected.";

            const help = document.createElement("p");
            help.className = "help";
            help.textContent = "Start playing the video, then click Refresh.";
            container.replaceChildren(help);
            if (existingJob && isActiveStatus(existingJob.status)) {
                container.appendChild(createActiveDownloadCard(existingJob));
            }

            return;
        }


        status.textContent =
            `${streams.length} video${
                streams.length === 1
                    ? ""
                    : "s"
            } detected`;


        streams.forEach(
            (
                stream,
                index
            ) => {
                container.appendChild(
                    createMaster(
                        stream,
                        index,
                        existingJob
                    )
                );
            }
        );
        if (!activeJobUI && existingJob && isActiveStatus(existingJob.status)) {
            container.appendChild(createActiveDownloadCard(existingJob));
        }

    } catch (error) {
        console.error(
            "[Corn popup] Could not load streams:",
            error?.name
        );

        status.textContent =
            "Corn Downloader encountered an error.";

        const errorElement =
            document.createElement(
                "div"
            );

        errorElement.className =
            "error";

        errorElement.textContent =
            error.message;

        container.appendChild(
            errorElement
        );
    }
}


/* =========================================================
   BUTTONS
========================================================= */

const refreshButton =
    document.getElementById(
        "refresh"
    );


if (refreshButton) {
    refreshButton.addEventListener(
        "click",
        loadStreams
    );
}


const clearButton =
    document.getElementById(
        "clear"
    );


if (clearButton) {
    clearButton.addEventListener(
        "click",
        async () => {
            if (
                currentTabId ===
                null
            ) {
                return;
            }

            try {
                await browser.runtime
                    .sendMessage({
                        type:
                            "CLEAR_STREAMS",

                        tabId:
                            currentTabId
                    });

                await loadStreams();

            } catch (error) {
                console.error(
                    "[Corn popup] Clear failed:",
                    error?.name
                );
            }
        }
    );
}


/* =========================================================
   INITIAL START
========================================================= */

loadStreams().catch(
    error => {
        console.error(
            "[Corn popup] Initial load failed:",
            error?.name
        );

        const status =
            document.getElementById(
                "status"
            );

        if (status) {
            status.textContent =
                `Corn Downloader error: ${error.message}`;
        }
    }
);
