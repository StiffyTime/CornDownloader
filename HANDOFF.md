# Corn Downloader — development handoff

Last verified: 2026-09-20. This file preserves project context independently of
the original Codex conversation. Read README.md and REVIEWER_NOTES.md as well.

## Current state

- Repository: https://github.com/StiffyTime/CornDownloader, branch `main`.
- Latest extension version: **0.8.0**, Firefox desktop, Manifest V3.
- Supports unencrypted HLS and direct HTTP(S) MP4 downloads.
- Signed installer: `Archive/deb8f7d0adf14cafaa24-0.8.0.xpi`.
- Unsigned signing submission package: `Archive/CornDownloader-0.8.0.zip`.
- Older installers and ZIPs are retained under Archive. Do not confuse them with
  the current version or modify a signed XPI in place.
- Source documentation can be newer than documentation bundled inside an already
  signed installer. That does not change its runtime code or invalidate its signature.
- The user is happy with the delivered result. No unfinished feature request or
  active development task remains. README's next-work ideas are optional, not a backlog
  to implement automatically.

## Maintainer preferences and GitHub configuration

- Maintainer-only project: no external contributions or support requests.
- Public and **not archived**, verified through GitHub's API on the date above.
- Issues, Discussions, Pull Requests, Wiki, and Projects are disabled. Keep them
  disabled unless the maintainer asks otherwise; retain the ability to push updates.
- No LICENSE file has been selected. Do not introduce a license without a decision
  from the maintainer.
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

On 2026-09-20 all **27 tests passed**, and all three runtime scripts passed syntax
checks. No dependencies need installing; a modern Node.js runtime is sufficient:

```sh
node --test tests/background.test.cjs tests/popup.test.cjs
node --check background.js
node --check direct.js
node --check popup/popup.js
```

Tests mock Firefox; they do not establish compatibility with every site. The user
reported the earlier HLS build worked well and is happy with the delivered project.
There is no recorded independent end-to-end MP4 site test by the agent. Use the
manual checks in README.md after changes involving requests or downloads.

## Release process

1. Make the requested change and run relevant tests plus syntax checks.
2. Update manifest.json and package.json to the same new version, plus notes.
3. Test temporarily in Firefox through `about:debugging#/runtime/this-firefox`,
   loading manifest.json. Reload the video page to capture fresh traffic.
4. Package only manifest.json, background.js, direct.js, popup/popup.html,
   popup/popup.css, popup/popup.js, README.md, and REVIEWER_NOTES.md. Keep manifest
   at the archive root and use `/` in ZIP entry paths. Do not package `.git`, old
   Archive contents, credentials, or development-only files.
5. Submit the new ZIP under the existing add-on in Mozilla's developer account for
   signing. The maintainer controls this account; credentials are not stored here.
   Existing distribution uses the unlisted/self-distributed channel.
6. Download Mozilla's signed XPI and retain it unchanged under Archive. Verify its
   version and runtime source match the intended release. Update the README's
   installer link and these handoff notes, then commit/push the release files.

There is no automatic update URL in the manifest and no established GitHub Release
workflow. Current users install newer signed XPIs manually. Do not describe an
unsigned ZIP or GitHub source archive as a normal Firefox installer.

## Known limitations and important fixes to preserve

- HLS assembles the full file in RAM; large files can use substantial memory.
- No DRM/decryption, HLS byte-range downloading, separate audio muxing, full live
  recording, or DASH support. Init URL changes are rejected rather than concatenated.
- HLS capture currently depends on `.m3u8` URLs; popup HLS cards depend on a master
  playlist. Standalone media playlists are a future improvement.
- Discovery observes requested media, not unloaded page links. MP4 authentication
  supports selected headers and normal/private browser cookies; custom headers
  and non-default container cookie stores may need extra work.
- Full-path matching accommodates CDN mirrors but can be ambiguous. Captures can
  outlive same-tab navigation; Clear and tab closure remove them.
- Keep per-request replay identities, request deadlines, cancellable retry waits,
  per-tab playlist storage, correct segment ordering, and save-dialog cleanup.
- Do not restore dynamic innerHTML assignments: Mozilla flagged that in 0.7.1;
  0.7.2 replaced them with DOM creation and textContent.

## Starting again

Open this repository in a new Codex task, or clone it from GitHub, and ask the agent
to read HANDOFF.md and README.md before starting the next requested change.
The original chat is not needed to recover the source, installers, or these notes.
GitHub/Mozilla authentication still belongs to the maintainer and may need reconnecting.
