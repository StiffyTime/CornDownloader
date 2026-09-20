# Release testing procedure

Updated 2026-09-21. This is a test plan, not a completed Firefox
release sign-off. The release candidate is 0.8.2, requiring Firefox desktop 142+.

Video examples supplied in conversation are for troubleshooting only. Do not copy
their URLs or titles into public documentation, listing text, screenshots, or
reviewer submissions. If Mozilla needs a reproducible example, prepare neutral test
media separately; the public listing should describe features, not list videos.

## HLS

Use a neutral, unencrypted HLS test stream with an adaptive master playlist and
combined audio/video. A public demo was checked for playback in the in-app browser;
Corn Downloader's Firefox detection and download behaviour remain to be tested.

Firefox procedure:

1. Install/load the intended Corn Downloader release candidate and grant the site
   access needed for the player and its media host. Reload the demo after loading
   the extension so it can observe the master playlist.
2. Play the stream. Choose a fixed quality in the player's controls if needed,
   and allow that quality to load before opening Corn Downloader. The extension only downloads a quality
   whose media playlist has been captured; seeing the master alone is insufficient.
3. Open Corn Downloader, click Refresh, select the captured HLS quality, and use
   four workers. Click Download. Keep the player running; if the job waits for a
   fresh segment, seek to an unbuffered part of the video.
4. Choose a save destination when prompted. Expect a .ts file for an MPEG-TS
   stream, not an MP4 conversion. Play the file in a compatible media player and
   check picture, sound, beginning/end, and duration against the source.
5. Repeat the relevant checks below on the final candidate.

Private HLS site examples are unnecessary.

## MP4

The maintainer reported a successful MP4 download. Independent end-to-end Firefox
testing by the agent remains pending. Use neutral test media for reviewer examples
and screenshots; do not publish the maintainer's troubleshooting example.

Firefox procedure:

1. With the candidate extension loaded and site access granted, reload the page
   and play the video so the browser requests its MP4 media.
2. Open Corn Downloader and click Refresh. Select the Direct MP4 entry, click
   Download, and choose a save destination.
3. Confirm Firefox receives the complete file, not a range fragment. Check playback,
   audio, duration against the page, and completion in Firefox's download manager.
4. Confirm changing HLS worker count does not change the native MP4 transfer path.

Do not mark the MP4 download test passed merely because the page opens.

## Release checks to record for both formats

Automated checks: 44 tests passed; syntax checks passed; web-ext 10.6.0 lint on the
0.8.2 package returned 0 errors, 0 warnings and 0 notices. ZIP contents are verified
against source. These checks were run by the agent on 2026-09-21.

Live Firefox acceptance remains pending. The available connected browser is the
in-app browser, which cannot validate this Firefox extension's private download
context, cookie behaviour, install/upgrade consent prompt or native save dialog.

Record extension version, Firefox version, OS, date, and outcome. Leave checks
pending until actually performed on the release candidate:

- [ ] Detection and completed download; saved file playback/audio/duration.
- [ ] Popup close/reopen retains accurate active-job progress.
- [ ] Popup displays v0.8.2; rapid Refresh clicks leave one current result list
      and retain working progress/Cancel controls during an active download.
- [ ] Cancel while downloading, and dismiss the save dialog without a stuck job.
- [ ] Clear removes detected entries; closing the source tab follows documented
      active-job/retention behaviour.
- [ ] Host permission granted/revoked; no unhandled errors or misleading progress.
- [ ] Private-window behaviour after privacy fixes, if supported in the release.
- [ ] A second HLS quality and worker choices 2/4/6/8; default remains four.

Browser playback above and mocked regression tests do not replace these checks.
The current REVIEWER_NOTES.md describes 0.8.2. Record actual Firefox test outcomes
here before treating this candidate as accepted for publication.
