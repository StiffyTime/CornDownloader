# Corn Downloader — AMO listing draft

Draft only. Update after the release/privacy changes and live Firefox tests.
Describe the extension's features without listing example videos or recommending
their content. Do not include troubleshooting video links or titles in the listing
or screenshots.

**Name:** Corn Downloader

**Summary:** Download supported HLS streams and direct MP4 videos in Firefox.

**Description:**

Corn Downloader detects supported media requested by pages you visit and lets you
save a selected video locally. Play the video, open the extension, click Refresh,
and choose an available HLS quality or direct MP4 file.

- HLS downloads with 2, 4, 6 or 8 workers; four is the default.
- Direct MP4 downloads managed by Firefox.
- Progress information and cancellation.
- No telemetry, advertising, account registration or external media-processing service.

Website access is needed to detect video requests and media served by other CDN
hosts. Downloads connect to the media servers and may reuse site authentication
and request headers required to retrieve the selected video. See the privacy policy
and the installation permissions for the final supported data flows.

**Limitations:** Firefox desktop only. Not intended for YouTube. No DRM decryption,
DASH, full live recording, HLS byte-range support, or separate audio-track muxing.
HLS files are assembled in memory, so large videos can use substantial RAM.
Only media actually requested by the page is detected; site compatibility varies.
Use it for videos you own or have permission to download.

**License:** MIT.

**Homepage:** https://github.com/StiffyTime/CornDownloader

**Help page:** https://github.com/StiffyTime/CornDownloader#readme

**Support:** See the README for installation, usage, and known limitations.
Individual support and external contributions are not offered. Do not add the
maintainer's personal email to the public listing. Mozilla's account contact stays
in the developer account for review correspondence.

**Still needed:** icon, real screenshots, finalized privacy text and consent,
completed Firefox tests using docs/REVIEWER_TESTS.md, and listing metadata in the
existing Mozilla account.
