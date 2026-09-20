# Corn Downloader 0.8.2 — public submission

Status: release candidate prepared locally. Not submitted, signed or published.
The maintainer will upload it to Mozilla after the live Firefox checks below.

## Files to use

- Upload: Archive/CornDownloader-0.8.2.zip (unsigned extension package).
- Checksum: Archive/CornDownloader-0.8.2.zip.sha256.
- Listing fields: docs/AMO_LISTING_DRAFT.md (final text for this candidate).
- Privacy policy: PRIVACY.md. The popup also links to bundled privacy.html.
- Reviewer explanation: REVIEWER_NOTES.md.
- Listing icon: icons/corn-128.png. No screenshots of browsing examples are included.

The same add-on ID, corn-downloader@local, is retained. Do not upload GitHub's
whole-repository ZIP, modify an old signed XPI, or submit this as a different add-on.

## Implemented for 0.8.2

- Rapid Refresh clicks cannot let older results or failures overwrite the latest
  results and active-download controls. Two regression tests cover these races.
- Popup displays its version and announces detection status to screen readers.

Privacy and reliability improvements retained from 0.8.1:

- MIT license, Corn Downloader name, no individual support; README is the help page.
- Firefox 142+ built-in required disclosure of browsingActivity, websiteContent and
  authenticationInfo for media-server requests. No telemetry or developer endpoint.
- Private HLS save context; credential-free background fetch plus selected captured
  headers; no HLS redirects or automatic background-cookie usage.
- Cross-origin HLS fallbacks discard captured headers. CDN reconstruction does not
  copy a different origin's query parameters to the observed host.
- Bounded manifest capture (512 KiB, 15 seconds, 16 concurrent), 24 records per tab,
  128 overall; detach/error cleanup preserves player traffic.
- Clear/navigation/closure data cleanup and source-tab-close cancellation; active
  download controls remain available after clearing detections.
- Native MP4 container transfers are rejected instead of using a different cookie jar.
- Privacy page, policy, listing icon, reviewer notes and explicit package script.

## Verification and remaining acceptance checks

Verified 2026-09-21: **44 automated tests passed**, JavaScript syntax checks passed,
and Mozilla web-ext 10.6.0 reported **0 errors, 0 warnings, 0 notices** on the
extracted upload ZIP. No unknown minified files were reported. The ZIP is checked
byte-for-byte against its 16 source files by the package script.

Run tests with `node --test tests/background.test.cjs tests/popup.test.cjs` and
syntax checks with `node --check` for background.js, direct.js and popup/popup.js.
The test suite uses mocked Firefox APIs. See docs/REVIEWER_TESTS.md for the current
record of checks; an automated pass is not proof of live-site compatibility.

Before submitting, temporarily load manifest.json in Firefox 142+ using
about:debugging#/runtime/this-firefox. Test one HLS and one MP4 download in normal
and private windows, save/cancel/reopen-popup behaviour, and playable output files.
Keep these checks pending until actually performed. No private browsing examples
need to be sent to anyone. Use neutral test media if Mozilla requests a reproduction.

No listing screenshots have been fabricated. Screenshots may be added from the
real Firefox popup, with sensitive information and example video titles absent.

## Upload steps

1. Sign into the Mozilla account that owns the existing add-on and open:
   https://addons.mozilla.org/en-US/developers/addon/deb8f7d0adf14cafaa24/edit
2. Open Manage Status & Versions and start a new version submission for this entry.
   Choose On this site (listed) for hosting/distribution. Signed-in intermediate
   labels have not been inspected and may vary.
3. Upload Archive/CornDownloader-0.8.2.zip. Resolve any validation errors and select
   Firefox desktop compatibility. No compilation/minification source build is used.
4. Fill the listing using docs/AMO_LISTING_DRAFT.md, select MIT, paste PRIVACY.md and
   reviewer notes, and add the icon. Keep personal email out of public fields.
5. Submit and check the actual review/publication status. Respond to Mozilla review
   messages using the existing private account contact. A GitHub push is separate.
6. Once signed, retain Mozilla's XPI unchanged under Archive, verify its source and
   version, and update README/HANDOFF with the public listing and signed installer.

No custom update_url is configured. Firefox can update existing installations to
an eligible higher-version AMO-listed release with this same ID once published.

## Rebuild

Run `powershell -NoProfile -File scripts/package.ps1` from the repository. The script
uses an explicit file list, fixed ZIP entry timestamps and byte-for-byte verification,
then writes a SHA-256 file. No dependencies or runtime build step are required.

## References

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/publish/self-distribution/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download
