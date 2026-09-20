# Corn Downloader privacy statement — draft

This describes the reviewed 0.8.0 behaviour. It is not a finalized statement for
the proposed public release. Reconcile it with the actual release code and Firefox
data-consent declarations before publication.

## Local information

Corn Downloader observes media-related network requests from pages visited in
Firefox. It holds detected media URLs, playlist contents/analysis, selected request
headers and download status in memory. URLs or headers may contain site session
information or signed access tokens. The HLS worker-count setting is saved using
Firefox's local extension storage. Video files are saved to a destination you choose.

The extension does not operate a developer server, analytics service, advertising
service, or cloud media-processing service. It does not send telemetry or usage
reports to the developer.

## Network requests

When you choose Download, the extension or Firefox requests the selected media from
its media host/CDN. These requests disclose ordinary connection information, such
as your IP address, to that host. They may include signed URL parameters, Referer,
cookies or Authorization/request headers needed by the website. HLS may retry
failed requests. The media host's own privacy practices apply to those requests.

## Retention and controls

Clear removes detected media records for the current tab. Closing a tab also removes
its detected media records. An already-running download may continue after tab closure.
Current job records can retain media URLs in memory until replaced or the background
context ends. The public-release implementation must review that retention before
claiming all tab data is erased immediately.

Firefox manages downloaded files and its download history separately. Removing the
extension does not delete video files already saved. Local extension settings can be
removed through Firefox. Firefox's site-access controls govern which hosts the
extension can observe. No privacy claim here promises that website operators cannot
see the media requests necessary to serve a download.

## Private browsing

Final support and behaviour are pending the public-release privacy fixes and tests.
Do not publish this draft as a guarantee of private-window or container isolation.

## Contact

Project documentation is available at
https://github.com/StiffyTime/CornDownloader#readme . Individual support and external
contributions are not offered. The maintainer has chosen not to publish a personal
email address. Mozilla's developer-account contact remains available to Mozilla
for review correspondence; it is not a public support channel.
