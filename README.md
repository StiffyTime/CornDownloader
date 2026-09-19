# Corn Downloader

A local Firefox extension for capturing and downloading direct MP4 files and unencrypted HLS video.
Settings are stored locally; there is no telemetry or external processing service.
Worker choices remain **2, 4, 6, or 8**, with **4 as the default**. Higher counts
are not necessarily faster when a server limits requests.

## Direct MP4 support: 0.8.0

Play the video, open Corn Downloader, and click Refresh. The popup lists both
**Direct MP4** files and **HLS Video** streams when the page requests them. MP4
is detected through the response MIME type or an MP4 URL with a generic binary
response type. Extensionless URLs served as MP4 are supported. Repeated range
requests for the same URL produce one entry; the displayed size uses the whole
file size from Content-Range where available.

Direct MP4 downloads go to Firefox's download manager, with progress and Cancel
available in the popup. Firefox downloads the complete URL directly to disk; the
extension does not buffer or concatenate that file. Worker settings apply only
to HLS. Existing HLS download and retry behaviour remains available.

Signed URL query parameters and supported Referer/Authorization headers are
retained. Firefox supplies cookies for its download context; private browsing
downloads are marked private. Non-default container cookie stores and servers
requiring extra custom authentication headers are not specifically supported.
Expired URLs may need a page reload and fresh capture.

Known HLS init/segment URLs and .m4s/.ts responses are excluded from direct MP4
results. Resources captured before their HLS playlist are filtered on Refresh
once the playlist is captured. Unknown DASH fragments or separately served
video-only MP4 resources can still appear; this is not a DASH downloader or muxer.
Only HTTP(S) media actually requested by the page is discovered, not unloaded
links, inaccessible blob contents, or DRM-protected media.

No new extension permissions were added. `direct.js` contains MP4 discovery and
download handling. `REVIEWER_NOTES.md` is included in the ZIP for Mozilla review.

## Mozilla validation fix: 0.7.2

Replaced popup HTML string assignments with DOM creation and `textContent`.
Playlist values are now displayed as text, addressing Mozilla's unsafe
`innerHTML` assignment warning. No download or worker behaviour changed.

## Reliability review: 0.7.1

- Each resource attempt now has a 60-second deadline, including reading its body.
  Stalled attempts use the existing retry flow. Cancellation interrupts requests
  and retry delays, and waits for workers to stop before releasing fragment buffers.
- Each request has its own header replay identity, even when different jobs fetch
  the same URL. The internal marker is removed before sending. Player Range and
  conditional-cache headers are excluded; Firefox retains its own transport headers.
  Captured Cookie and Authorization headers are not copied to a different origin
  when trying the original playlist URL as a fallback.
- Empty and unexpected partial responses are rejected instead of being assembled
  into an incomplete video. Byte ranges on init segments and playlists that change
  init segment URLs are detected and rejected with an explanation.
- Playlist records are isolated by tab. A lone captured quality no longer appears
  under every quality offered by the master playlist. Select the desired quality
  in the player, play briefly, then refresh the extension to capture it.
- Player requests must match a segment path in the selected playlist. This handles
  subdirectories and extensionless segment URLs without starting from an unrelated
  request merely because it shares the playlist directory.
- Rejected save dialogs release the completed Blob URL. Cancellation while the
  dialog is open is applied when Firefox returns the download ID. An immediate
  status query catches saves that completed before that ID was registered.
- Rapid Start messages cannot create duplicate active jobs for one tab. Popup
  polling cannot overlap or apply a late response to a different job.

The worker pool's existing ordering is retained: files are assembled in playlist
order even when requests finish out of order.

## Try the updated build

For temporary development loading, open `about:debugging#/runtime/this-firefox`
in Firefox, choose **Load Temporary Add-on**, and select this folder's
`manifest.json`. If it is already loaded temporarily, use its **Reload** button.
Reload the video page so the updated extension captures fresh playlists.
`CornDownloader-0.8.0.zip` contains the extension and review notes; it is not a signed
Mozilla release.

Suggested browser checks:

1. Select four workers. Play a familiar video, capture its selected quality, and
   download it. Check playback, seeking, duration, and audio in the saved file.
2. Close and reopen the popup during downloading; progress should restore.
3. Cancel during downloading and try again. Also dismiss the Firefox save dialog,
   then retry, and test cancelling from the popup while a save dialog is pending.
4. Open the same video in two tabs and confirm both retain their captured streams.
5. Select another player quality and refresh. Only captured qualities should have
   enabled Download buttons.
6. Play a direct MP4, refresh, and download it. Confirm full-file playback and
   duration even if the player requested only byte ranges. Reopen the popup to
   check progress, and test Cancel and dismissing the save dialog.

Automated checks use Node's built-in test runner, with no dependencies to install:

```powershell
node --test tests/background.test.cjs tests/popup.test.cjs
node --check background.js
node --check direct.js
node --check popup/popup.js
```

The tests simulate Firefox events, requests, and timers. They cover races and
failure paths but do not prove compatibility with a particular site's CDN,
authentication, or media layout. Live-site validation remains to be done.

## Recommended next work

1. **Reduce memory use for large HLS files.** The whole HLS video is still buffered and
   assembled as a Blob. Four workers limits concurrent requests, not total RAM.
   Saving incrementally needs a separate design, potentially a local helper.
2. **Handle separate audio tracks and remuxing.** Master playlists can describe
   audio separately. The current downloader only concatenates the selected media
   playlist; it does not fetch and mux external audio renditions. Some outputs
   may therefore lack audio. Discontinuities and changing init data need container
   handling rather than simple concatenation.
3. **Expand playlist discovery.** Only `.m3u8` request URLs are captured, and the
   popup builds cards from master playlists. Content-type detection and standalone
   media playlist cards would cover more sites. Live playlists currently represent
   only the captured window; full live recording is not implemented.
4. **Tighten stream identity and lifecycle.** Full-path matching still permits CDN
   mirrors, but unrelated hosts with identical paths can be ambiguous. Old captures
   also survive navigation within a tab until Clear or tab closure. Explicit
   navigation handling should preserve controls for any already-running job.

Encryption/DRM handling and byte-range downloading are not implemented.

The save lifecycle and header changes were checked against Mozilla's
[downloads.download documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download)
and [onBeforeSendHeaders documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeSendHeaders).
