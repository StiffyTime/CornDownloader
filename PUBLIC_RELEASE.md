# Mozilla public release preparation

Status: planning/review, not submitted. Current runtime version is 0.8.0.
Suggested next release: 0.8.1, after the items below are resolved.

## Agreed decisions

- Keep the name **Corn Downloader**.
- License: **MIT**, copyright holder **StiffyTime**, as chosen by the maintainer.
- Firefox desktop only for the initial public listing.
- Keep the existing add-on identity `corn-downloader@local` and use the Mozilla
  account that already owns the signed add-on. Do not create a duplicate identity.
- External contributions remain closed. A public listing does not require enabling
  GitHub Issues or Pull Requests. The developer must still respond to Mozilla reviews.
- Help page: https://github.com/StiffyTime/CornDownloader#readme . Individual support
  is not offered. Keep personal email out of public metadata; Mozilla can use the
  developer-account contact for review correspondence.

## Verified starting point

- All 27 Node regression tests pass on the reviewed source.
- Mozilla web-ext lint, run against a temporary runtime-only copy of 0.8.0:
  **0 errors, 0 warnings, 0 notices**.
- Linter metadata includes background.js in `unknownMinifiedFiles` despite this
  being handwritten, readable source without a build step. No warning was emitted;
  explain the source arrangement if a reviewer asks. Automated lint is not approval
  and does not replace browser tests or privacy review.
- No telemetry, external processing service, remote executable code, or dependencies
  bundled into the extension. Current privacy claims still need the review below.
- Existing runtime files and signed installers are unchanged by this preparation.

## Changes to complete before submission

1. **Privacy disclosure and consent.** The manifest currently declares
   `data_collection_permissions.required: ["none"]`. HLS downloads replay player
   request headers (including cookies where present); MP4 downloads can send Referer
   and Authorization and use Firefox's cookies. No analytics does not mean no data
   transmission. Check the final data flows against Mozilla's taxonomy, resolve the
   relevant websiteContent/browsingActivity/authenticationInfo declarations, and
   implement appropriate consent. Do not claim the `none` declaration is established
   as correct for the public release. Consider Firefox 140+ as the minimum if using
   only Firefox's built-in consent system. Review any effect on existing users.
2. **Private browsing and data lifetime.** MP4 forwards `incognito` to downloads;
   HLS currently does not. Fix the HLS save context and test it, or explicitly decide
   to disallow private-window operation until it is supported correctly. Audit header
   replay across redirects/origins, and cookie-store behaviour. Completed jobs retain
   media URLs in memory after source-tab closure; align cleanup and privacy wording.
3. **Bound memory and capture lifetime.** Manifest response capture currently buffers
   the entire response without a size cap; manifestRecords is uncapped until Clear or
   tab closure. Add limits and stream-filter error cleanup before wider deployment.
   Ensure cleanup does not interrupt page playback or lose active download controls.
4. **Listing and presentation.** Add a recognizable icon in the manifest and toolbar;
   take screenshots of the real popup with non-sensitive test media. Supply a concise
   summary, accurate feature/limitation description, MIT selection, privacy policy,
   and reviewer instructions. Draft text is in docs/AMO_LISTING_DRAFT.md and
   docs/PRIVACY_DRAFT.md. Use the agreed README help page with no individual support;
   do not expose the personal email previously removed from Git history.
5. **Reproducible reviewer tests.** Provide accessible HLS and MP4 test pages and
   concrete steps. Test installed Firefox behaviour, file playback/audio/duration,
   cancellation, reopen-popup progress, granted/revoked host access, and normal/private
   contexts as supported. The current tests mock Firefox APIs and do not cover these
   full browser behaviours.
6. **Release packaging.** Bump both version fields after implementation; include icons,
   LICENSE, privacy text and runtime source using an explicit file list. Update reviewer
   notes for the listed channel, rerun lint/tests, and create a fresh unsigned upload
   ZIP. Never edit or repackage the existing signed XPI as the new release.

These are review recommendations, not claims that Mozilla has rejected 0.8.0.
Separate-audio muxing, DASH, live recording and disk-streaming HLS can remain
unsupported if the listing is explicit. Do not promise support for every video site.

## Needed from the maintainer

- Existing Mozilla management link supplied:
  https://addons.mozilla.org/en-US/developers/addon/deb8f7d0adf14cafaa24/edit
  The signed-out browser shows Not Found; the private entry and its distribution
  settings have not been inspected. Use the account that owns it when submitting.
  Do not put credentials in the repository or chat.
- The maintainer's MP4 example was for troubleshooting only, not publication.
  Do not include conversation-supplied video links or titles in the listing,
  repository documentation, screenshots, or reviewer submissions. Use generic
  feature descriptions publicly. See docs/REVIEWER_TESTS.md for testing procedures.
  No private HLS browsing examples are needed or should be requested.
- Any preferred icon direction (otherwise a simple corn/download design is reasonable).
- Public help/support choice is settled: use the GitHub README, with no individual
  support. Keep the private Mozilla developer-account contact reachable.
- A decision on any new consent prompt/private-browsing scope after the implementation
  review; this is not a reason to weaken the required disclosure or privacy safeguards.

## Submission and updates

Use the existing add-on's developer management page to prepare a higher-version
release in the **listed / On this site** channel. The exact account page needs
inspection before giving click-by-click conversion instructions. Complete metadata,
validation, and any review questions before calling it published.

Submission sequence once the release candidate is ready:

1. Sign into the existing owner's Mozilla account and open the management link above.
2. Open **Manage Status & Versions** and start a new version submission for this
   existing add-on. In the hosting/channel choice, select **On this site** (listed).
   The signed-in page has not been inspected, so intermediate button labels may vary.
3. Upload the newly prepared runtime ZIP with a higher version, keeping the same
   add-on ID. Do not upload GitHub's whole-repository ZIP or reuse version 0.8.0.
4. Resolve validation issues and select Firefox desktop compatibility. The current
   source has no compilation/bundling step; answer the source-code question accordingly.
5. Complete the public description, MIT license, README help URL, finalized privacy
   policy, icon/screenshots, and reviewer notes. Keep troubleshooting video examples
   and personal email out of public fields.
6. Submit the version, then check its actual signing/review/publication status and
   any Mozilla messages. A GitHub push alone does not publish on Mozilla.

The repository currently contains preparation drafts, not a finished 0.8.1 upload.
Complete the release checks above before following the upload step.

Keep the same add-on ID and omit a custom update_url. Mozilla documents that Firefox
checks AMO for higher-version listed releases even for self-distributed installations
without a custom update URL. This corrects the earlier simplified manual-update-only
wording. Do not guarantee delivery until an eligible listed release exists.

## Sources

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/self-distribution/
- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://opensource.org/license/mit
