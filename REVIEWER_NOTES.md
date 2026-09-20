# Corn Downloader 0.8.1 — Mozilla reviewer notes

Intended distribution: public listing on AMO under the existing add-on ID
`corn-downloader@local`. Firefox desktop 142+. MIT license. Publication is handled
by the maintainer; this package is unsigned and has not been submitted by the agent.

## Purpose and source

Detect and download supported unencrypted HLS streams and direct MP4 media after
an explicit click in the extension popup. No telemetry, analytics, advertising,
remote executable code, DRM decryption or external processing service.

All runtime JavaScript, HTML and CSS is readable source in the archive. There is no
compilation, bundling, minification, dependency installation or generated runtime
code. No separate source package is required to inspect the implementation.
The icon SVG is original project artwork; PNG sizes are rasterizations of it.
background.js handles HLS and shared jobs; direct.js handles native MP4 downloads;
popup/popup.js renders text with DOM methods and textContent, not innerHTML.

## Permissions and data flows

- webRequest / webRequestBlocking / webRequestFilterResponse: detect media, observe
  HLS response bodies while forwarding bytes unchanged, and replay selected HLS
  headers. Captures are limited to 512 KiB, 15 seconds and 16 concurrent responses.
  At most 24 HLS records per tab and 128 overall are retained.
- Host access: pages and media can use different CDN hosts. Users control site access.
- tabs: associate captures/jobs with source tabs and form a filename from the title.
- downloads: save and cancel user-requested files and report download completion.
- storage: persist only the HLS worker-count preference locally.
- Required data declarations: browsingActivity (media/referrer URLs), websiteContent
  (request information and cookies) and authenticationInfo (site authorization/access
  tokens). These go only to media servers for downloads, never to developer servers.
  Firefox 142+ supplies the built-in consent experience. See PRIVACY.md.

HLS fetch uses credentials: omit and cache: no-store. Only captured Cookie,
Authorization, Referer, Origin, Accept and Accept-Language may be replayed for the
observed media origin. Fallback requests to another origin receive none of those
captured headers. Redirects are rejected. Range and conditional request headers
are excluded. The internal correlation marker is stripped before transmission.

MP4 uses downloads.download with supported headers and the original complete URL.
Firefox manages cookies and redirects. Private downloads use incognito: true;
non-default container MP4 downloads are rejected without starting a transfer.
There is no cookies API permission or cookie-store enumeration.

Clear/navigation/tab closure remove detected media and capture buffers. Active jobs
retain only what is needed to settle, then are forgotten if cleared/navigated/closed.
Tab closure requests cancellation, including when a save dialog is pending.
Errors logged to the console omit raw error objects that may include signed URLs.

## Functional review procedure

No extension account is needed. Use neutral test media with an unencrypted adaptive
HLS master playlist plus combined audio/video, and a page requesting a complete
MP4 resource. The maintainer's troubleshooting videos are not included or promoted.
No player library or external test page code is part of this extension.

1. Load the extension in Firefox 142+, grant website access and reload the test page.
2. Play the video. For HLS, select a fixed player quality and let its playlist load.
3. Open the popup and Refresh. Select a captured HLS quality or Direct MP4 entry.
4. Click Download. HLS waits for a fresh player segment; keep playing or seek to an
   unbuffered part. Four workers is the default. MP4 uses Firefox's native downloader.
5. Choose a save destination. Verify file playback/audio/duration. MPEG-TS HLS is
   saved as .ts; there is no MP4 conversion or external audio muxing.
6. Reopen the popup during transfer; verify progress and Cancel, including dismissing
   a save dialog. Close the source tab and check cancellation/cleanup.
7. Allow private-window access in Firefox. Repeat both formats in a private window,
   checking that the download appears only in the private download manager.

Node regression tests cover capture limits, request/header isolation, private save
options, cancellation races and cleanup with mocked Firefox APIs. They do not replace
live Firefox/site tests. Consult docs/REVIEWER_TESTS.md in the source repository for
the maintainer's pending manual acceptance checklist.

## Limitations

HLS assembles the full file in RAM. No DRM, encryption, DASH, byte-range HLS,
separate audio-track muxing, full live recording or changing initialization segments.
HLS discovery needs .m3u8 requests and a master playlist. Redirected HLS resources,
custom authentication headers and container-tab MP4 downloads are unsupported.
Not intended for YouTube; compatibility with every website is not promised.
