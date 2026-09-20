/*
	VISIT LOGGER
	============
	Sends a small, anonymous record of this page view to our own AWS
	endpoint, so we can see which pages get visited and which posted
	link (query-string tag) brought the visitor here.

	What this deliberately does NOT collect: no IP address, no cookie,
	no device fingerprint, no name, nothing that identifies a person.
	The only things sent are:
	  - page  : the page path, e.g. "/index.html"
	  - ts    : the UTC timestamp of the view
	  - src   : the "src" tag from the URL, if any, e.g. "?src=yt"

	Three IP-free checks run first to skip the most obvious browser
	automation before anything is sent. These are a soft, best-effort
	filter, not a security boundary — a script that hits the AWS
	endpoint directly, without ever loading this page, never runs this
	file at all, so it can't be stopped here. The real abuse ceiling is
	the request-rate limit configured on the AWS endpoint itself (see
	Step 6 of the AWS setup guide) — that is what actually bounds the
	cost and the flood, not this file.
*/
(function () {
	"use strict";

	// Replace with your real API Gateway invoke URL once Step 6 of the
	// AWS setup guide is done. Left blank for now so nothing is sent
	// (and nothing errors) until it's filled in.
	var ENDPOINT = "";
	if (!ENDPOINT) { return; }

	// --- Check 1: navigator.webdriver ----------------------------------
	// Automation frameworks (Selenium, Puppeteer, Playwright) set this
	// flag to true by default when driving a real browser engine. A
	// human visitor's browser never sets it. This catches automation
	// that runs full JS but hasn't gone out of its way to hide itself —
	// it will not catch a bot that fakes this value on purpose.
	if (navigator.webdriver) { return; }

	// --- Check 2: a real page has a real window -------------------------
	// Simple headless fetchers that don't run a full browser engine
	// typically report 0 for these, or don't define them at all.
	if (!window.innerWidth || !window.innerHeight) { return; }

	// --- Check 3: obvious bot/crawler User-Agent strings ------------------
	// Read locally, checked locally, and never sent anywhere — the User-
	// Agent string itself is not part of the payload below, so this adds
	// no data collection at all, just a local decision not to send.
	if (/bot|crawl|spider|headless|curl|wget|python|scrapy|phantomjs/i.test(navigator.userAgent)) {
		return;
	}

	// --- Build the payload -----------------------------------------------
	var params = new URLSearchParams(window.location.search);
	var payload = {
		page: window.location.pathname,
		ts: new Date().toISOString(),
		src: params.get("src") || ""
	};

	// A Blob with an explicit content type, rather than a plain object —
	// sendBeacon does not stringify objects or set a content type for
	// you. The type is deliberately "text/plain" and not
	// "application/json": text/plain is one of the handful of types a
	// browser treats as CORS-simple, so this skips the extra OPTIONS
	// preflight round-trip a JSON content type would otherwise trigger
	// for a cross-origin request like this one. The body is still valid
	// JSON text either way — the Lambda function parses it directly.
	var body = new Blob([JSON.stringify(payload)], { type: "text/plain" });

	// --- Send it, without blocking or slowing the page --------------------
	// sendBeacon is supported on every browser this site targets
	// (Safari on iOS since 11.3, March 2018 — inside the 7-year window),
	// and is built for exactly this "fire and forget" case: it queues
	// the request and returns immediately, so it never delays rendering
	// or blocks the page even if the network is slow.
	if (navigator.sendBeacon) {
		navigator.sendBeacon(ENDPOINT, body);
	} else {
		// Fallback for the rare browser without sendBeacon.
		fetch(ENDPOINT, { method: "POST", body: body, keepalive: true }).catch(function () {
			// Deliberately silent: a missed visit-count row is not worth
			// showing the visitor an error, or retrying and slowing the
			// page down.
		});
	}
})();
