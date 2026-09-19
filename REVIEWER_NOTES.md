# Corn Downloader 0.8.0 — notes for Mozilla reviewers

Intended distribution: unlisted, for personal use.

This Firefox desktop extension detects unencrypted HLS playlists and direct MP4
responses from pages the user visits. Downloading requires an explicit click in
the extension popup. There is no analytics, telemetry, remote executable code,
external processing service, or DRM decryption.

## Source and build

All runtime source is readable JavaScript, HTML, and CSS in this archive. There
is no compilation, bundling, minification, dependency installation, or generated
runtime code. `background.js` handles HLS and shared jobs; `direct.js` handles
MP4 detection and Firefox-managed downloads; `popup/popup.js` provides the UI.
No separate source archive is needed to inspect this code. Popup text is created
using DOM methods and textContent, without innerHTML assignments.

## Permissions

- webRequest / webRequestBlocking / webRequestFilterResponse: observe player
  requests, capture and parse HLS response bodies while forwarding them unchanged,
  and replay headers for HLS downloads. MP4 discovery inspects response headers.
- Host access to all URLs: players and their media can use different CDN hosts.
- tabs: associate captured media with its tab and use its title for output names.
- downloads: save media after user action and report/cancel native downloads.
- storage: save the selected HLS worker count locally.

The 0.8.0 update adds no permissions. MP4 uses downloads.download with supported
Referer/Authorization headers and Firefox's applicable cookies. Player Range
headers are excluded so the full file is requested. Private downloads use the
incognito option. Captured media URLs and supported request headers are held only
in memory, cleared by Clear or tab closure, and are not sent to an external
processing or analytics service. Media requests go to the media server itself.

## Testing

1. Load the extension and play an HTTP(S) unencrypted HLS or MP4 video.
2. Open the popup and Refresh. Select a captured HLS quality or Direct MP4 entry.
3. Click Download and choose a save destination.
4. HLS waits for a fresh player segment; keep playing or seek slightly. MP4 starts
   through Firefox without waiting for a fresh segment. The worker selector is
   for HLS only, with four workers as the default.
5. Close/reopen the popup to check progress. Check Cancel and save-dialog rejection.
6. If both formats are requested by a page, both formats should be listed. Known
   HLS fragments should not appear as standalone MP4 files after Refresh.

No extension account or service login is required. Website authentication, if
required by a media site, is handled by the user's browser session. See README.md
for limitations, local test commands, and live-site checks.
