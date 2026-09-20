# Corn Downloader — Mozilla listing text for 0.8.2

Use these fields when submitting the new version under the existing add-on entry.
Do not copy these instructions into the public description. No troubleshooting
video links or titles belong in the listing or screenshots.

## Name

Corn Downloader

## Summary

Save a little corn for later. Download supported website videos with no tracking or account required.

## Description

Save a little corn for later. 🌽

Some tabs are worth keeping. Corn Downloader saves supported HLS streams and direct
MP4 videos from websites to your computer. Play the video, open the extension,
click Refresh, and choose a captured quality or MP4 file. You bring the corn;
we bring the download button.

Your taste in videos is your business. No tracking, telemetry, analytics, ads or
account required. Corn Downloader sends no browsing history, videos or download
reports to the developer. There are no developer servers, and the source code is
open for inspection under the MIT license.

- HLS downloads with 2, 4, 6 or 8 workers; four is the default.
- Direct MP4 downloads managed by Firefox.
- Progress information and cancellation, including after clearing detected entries.
- Private-window support when you allow it in Firefox.
- No telemetry, analytics, advertising, account registration or external processing.

The privacy bit, without the small print: website access is needed to detect media.
Downloads still connect to the video's media servers, which see your IP address
and the requested URLs and may receive the site's cookies or login headers.
Firefox asks you to accept the corresponding data permissions for those requests.
This is not an anonymity tool. See the privacy policy for details and controls.

Requires Firefox desktop 142 or newer. Site compatibility varies. Not intended for
YouTube. No DRM decryption, encrypted HLS, DASH, full live recording, HLS byte ranges,
or separate audio-track muxing. HLS needs a captured master/quality playlist and is
assembled in memory, so large videos can use substantial RAM. HLS redirects and
custom authentication headers are unsupported. Direct MP4 downloads from container
tabs are unsupported; use a normal or private tab. Keep the source tab open while
downloading; closing it cancels the job. Use videos you own or have permission to save.

See the README for installation, usage and limitations. Individual support and
external contributions are not offered.

## Remaining form fields

Version 0.8.2 release notes: Improved popup refresh reliability when Refresh is
clicked repeatedly. Added an installed-version label and screen-reader detection
status announcements. No changes to permissions or privacy behaviour.

- License: MIT.
- Homepage: https://github.com/StiffyTime/CornDownloader
- Support/help URL: https://github.com/StiffyTime/CornDownloader#readme
- Public support email: leave blank; do not expose the maintainer's personal email.
- Platform: Firefox desktop only.
- Suggested category: Download Management, if offered by the form.
- Privacy policy: paste the contents of PRIVACY.md.
- Reviewer notes: use REVIEWER_NOTES.md.
- Icon: icons/corn-128.png (the runtime includes 48px and 96px toolbar icons).
- Source build step: none; readable runtime source is included in the ZIP.

Screenshots are optional presentation material. None are included yet: use a real
Firefox popup screenshot without browsing history, personal URLs or example video
titles. Do not misrepresent a mockup as an installed extension screenshot.
