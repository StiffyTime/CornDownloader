# Corn Downloader — development handoff

Release checks updated: 2026-09-21. This file preserves project context independently of
the original Codex conversation. Read README.md and REVIEWER_NOTES.md as well.

## Current state

- Repository: https://github.com/StiffyTime/CornDownloader, branch `main`.
- Source/upload candidate: **0.8.1**, Firefox desktop 142+, Manifest V3.
- Supports unencrypted HLS and direct HTTP(S) MP4 downloads.
- Latest signed installer remains `Archive/deb8f7d0adf14cafaa24-0.8.0.xpi`.
- New unsigned submission package: `Archive/CornDownloader-0.8.1.zip`.
- Older installers and ZIPs are retained under Archive. Do not confuse them with
  the current version or modify a signed XPI in place.
- Source documentation can be newer than documentation bundled inside an already
  signed installer. That does not change its runtime code or invalidate its signature.
- Public-release privacy changes are implemented in 0.8.1. Read PUBLIC_RELEASE.md
  for upload instructions and docs/REVIEWER_TESTS.md for manual acceptance checks.
  The maintainer will upload; no new version has been submitted or signed by the agent.
- Keep private-window support (explicit maintainer choice). Both save paths set the
  private context. HLS fetch omits background cookies, uses captured headers and
  rejects redirects. MP4 container transfers are rejected rather than using normal cookies.
- Required data declarations cover site URLs, cookies and authentication, not telemetry.
  Firefox 142+ avoids inherited Android consent-version validation warnings without
  opting into Android listing. No gecko_android key is present; desktop remains the target.
- Existing private Mozilla management entry supplied by the maintainer:
  https://addons.mozilla.org/en-US/developers/addon/deb8f7d0adf14cafaa24/edit
  The agent's signed-out browser showed Not Found, not the add-on's settings.
  Use the existing owner account; do not infer the entry was deleted.
- Test procedures and verification status are in docs/REVIEWER_TESTS.md.
  Use neutral test media; private HLS browsing examples are not needed.
- Video examples supplied in conversation are for troubleshooting only. Do not
  publish their links or titles in project documentation, listing text, screenshots,
  or reviewer submissions. The public listing should describe extension features.

## Maintainer preferences and GitHub configuration

- Maintainer-only project: no external contributions or support requests.
- For the public Mozilla listing, use the GitHub README as the help page and state
  that individual support is not offered. Keep personal email out of public metadata;
  Mozilla's developer-account contact is for private review correspondence.
- Public and **not archived**, verified through GitHub's API on 2026-09-20.
- Issues, Discussions, Pull Requests, Wiki, and Projects are disabled. Keep them
  disabled unless the maintainer asks otherwise; retain the ability to push updates.
- The maintainer selected MIT for public release. LICENSE and package metadata now
  record that choice. Keep the public name Corn Downloader.
- Use this public GitHub noreply identity for commits:
  `306683804+StiffyTime@users.noreply.github.com`.
- The original two commits were rewritten to remove the maintainer's personal
  email. Do not reintroduce old history from another checkout or archive.
- Git configuration is not cloned with the repository. On a fresh checkout, run:

```sh
git config --local user.name StiffyTime
git config --local user.email 306683804+StiffyTime@users.noreply.github.com
```

## Architecture

- `manifest.json`: permissions, popup, identity, version, background script order.
  Keep the add-on ID `corn-downloader@local` for future updates.
- `background.js`: HLS playlist capture/parsing, quality matching, header replay,
  bounded worker pool, retries/cancellation, in-memory assembly, shared job state,
  popup messages, and Firefox save completion.
- `direct.js`: MP4 discovery from response type/URL, fragment filtering, direct
  Firefox downloads, progress queries. Loaded after background.js; both scripts
  share the background global scope. This order matters.
- `popup/popup.js`, `.html`, `.css`: stream cards, settings, progress, cancellation.
- `tests/background.test.cjs`: Node VM with mocked Firefox APIs/network/timers.
- `tests/popup.test.cjs`: popup polling and DOM behaviour with lightweight mocks.
- Plain JavaScript: no build, bundler, runtime dependencies, external server,
  account service, telemetry, or remote executable code.

HLS concurrency choices are **2/4/6/8**, default **4**. Four works well for the
maintainer. Direct MP4 transfers use Firefox's download manager, not the HLS worker
pool, and are not buffered in memory by the extension. One active job per tab.

## Verification

On 2026-09-21 all **42 tests passed**, and all three runtime scripts passed syntax
checks. No dependencies need installing; a modern Node.js runtime is sufficient:

```sh
node --test tests/background.test.cjs tests/popup.test.cjs
node --check background.js
node --check direct.js
node --check popup/popup.js
```

Mozilla web-ext 10.6.0 lint on the extracted 0.8.1 upload package reported
**0 errors, 0 warnings, 0 notices**, with no unknown minified files. The package
script compares every ZIP entry against source and records a SHA-256 checksum.
No live Firefox download acceptance result or AMO submission is recorded yet.

Tests mock Firefox; they do not establish compatibility with every site. The user
reported the earlier HLS build worked well and is happy with the delivered project.
The maintainer reported a working MP4 example; there is still no recorded
independent end-to-end MP4 download test by the agent. Public HLS demo playback
was verified in the in-app browser, not with the Firefox extension. Use the
manual checks in README.md after changes involving requests or downloads.

## Release process

1. Make the requested change and run relevant tests plus syntax checks.
2. Update manifest.json and package.json to the same new version, plus notes.
3. Test temporarily in Firefox through `about:debugging#/runtime/this-firefox`,
   loading manifest.json. Reload the video page to capture fresh traffic.
4. Run scripts/package.ps1. Its explicit list includes runtime files, icons,
   privacy page/policy, LICENSE, README and reviewer notes. It verifies every ZIP
   entry against source and writes a SHA-256 file. Do not package `.git`, old
   archives, credentials or development-only files.
5. Submit the new ZIP under the existing add-on in Mozilla's developer account for
   signing. The maintainer controls this account; credentials are not stored here.
   The new version is intended for the listed/On this site channel. Older signed
   versions used self-distribution. Keep their signed files unchanged.
6. Download Mozilla's signed XPI and retain it unchanged under Archive. Verify its
   version and runtime source match the intended release. Update the README's
   installer link and these handoff notes, then commit/push the release files.

There is no custom update URL in the manifest and no established GitHub Release
workflow. Current releases are installed manually; Firefox can update these installs
to a higher-version AMO-listed release with the same ID once available. Do not describe an
unsigned ZIP or GitHub source archive as a normal Firefox installer.

## Known limitations and important fixes to preserve

- HLS assembles the full file in RAM; large files can use substantial memory.
- No DRM/decryption, HLS byte-range downloading, separate audio muxing, full live
  recording, or DASH support. Init URL changes are rejected rather than concatenated.
- HLS capture currently depends on `.m3u8` URLs; popup HLS cards depend on a master
  playlist. Standalone media playlists are a future improvement.
- Discovery observes requested media, not unloaded page links. MP4 authentication
  supports selected headers and normal/private browser cookies; container downloads
  are rejected. HLS redirects and arbitrary custom authentication headers are unsupported.
- Full-path matching accommodates CDN mirrors but can be ambiguous. Clear, top-level
  navigation and closure clear detections. Active jobs retain information until settled;
  closure cancels them. Popup cancellation survives cleared/evicted detections.
- Keep per-request replay identities, request deadlines, cancellable retry waits,
  per-tab playlist storage, correct segment ordering, and save-dialog cleanup.
- Do not restore dynamic innerHTML assignments: Mozilla flagged that in 0.7.1;
  0.7.2 replaced them with DOM creation and textContent.

## Starting again

Open this repository in a new Codex task, or clone it from GitHub, and ask the agent
to read HANDOFF.md and README.md before starting the next requested change.
The original chat is not needed to recover the source, installers, or these notes.
GitHub/Mozilla authentication still belongs to the maintainer and may need reconnecting.
