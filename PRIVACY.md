# Corn Downloader privacy policy

Applies to version 0.8.1. Updated 2026-09-21.

Corn Downloader has no telemetry, analytics, advertising, developer server,
account service or external media-processing service. It does not send browsing
history, media or usage reports to the developer.

## Information used locally

On sites where you grant access, the extension observes requests to identify HLS
playlists and MP4 media. Detected media URLs, playlist analysis, selected request
headers and download status are held in memory. URLs and headers can contain
signed access tokens, cookies or authorization credentials. Only the selected HLS
worker count is written to Firefox's local extension storage.

## Information sent when downloading

Clicking Download requests the selected media from its media servers/CDNs. These
servers receive your IP address and media URLs, which may contain access tokens.
Requests can also include the site's Referer, Origin, cookies, Authorization,
Accept and Accept-Language headers needed to retrieve the media. HLS requests may
be retried after a failure. The servers' own privacy practices apply.

Firefox's installation/upgrade prompt declares browsing activity, website content
and authentication information because these site requests can transmit URLs,
cookies and authorization information. These declarations do not enable analytics
or transmission to the developer. Firefox 142 or newer is required so that the
built-in consent prompt is available.

HLS requests omit automatic background-session credentials, use only selected
captured headers, bypass the HTTP cache, and reject redirects. Captured headers
are not copied to a different origin when using an original playlist URL as a
fallback. Arbitrary custom site headers are not replayed. Direct MP4 transfers are
handled by Firefox using its normal or private download context and supported
Referer/Authorization/Accept/Accept-Language headers. Container-tab MP4 downloads
are rejected rather than silently using a different cookie store.

## Retention and controls

Clear, a new top-level page navigation, and tab closure remove the tab's detected
media and pending capture buffers. Capture sizes, capture time and record counts
are limited. Ongoing page requests can create new detections after Clear.

An active download keeps the information it needs until it finishes or is cancelled.
Clear or navigation marks this job information for removal when it ends. Closing
the source tab also requests cancellation. Otherwise, completed job information
remains in memory until the next job in that tab, Clear, navigation or tab closure.
Extension memory is discarded when its background context ends.

Use Cancel to stop a download. Manage website access, private-window access and
installation in Firefox's extension settings. Firefox manages saved files and
download history separately. Uninstalling the extension does not delete videos
you have saved.

## Private browsing

Private-window operation is available only when you allow it in Firefox. Downloads
from private tabs are marked private. HLS requests do not borrow normal-session
cookies or store response cookies through the background fetch. Closing the source
tab requests cancellation and cleans up extension records as the operation settles.
Files deliberately saved to disk remain on disk. Private browsing does not hide
media requests from the media servers or your network provider.

## Documentation

Installation, usage and limitations are documented in the
[project README](https://github.com/StiffyTime/CornDownloader#readme).
Individual support and external contributions are not offered. No personal
maintainer email is published. Mozilla may contact the maintainer privately through
the developer account for add-on review correspondence.
