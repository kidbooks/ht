/*
	VISIT LOGGER
	============
	Sends a small record of this page view to our own AWS endpoint, so
	we can see which pages get visited, which posted link (query-string
	tag) brought the visitor here, and -- the reason this now includes
	the visitor's IP address -- investigate abuse (traffic spikes, bad
	status codes, automated attacks) if it happens. See privacy.html
	section 2 for what visitors are told, and the Data Protection
	Pack's Legitimate Interests Assessment for the legal basis. Every
	record is deleted automatically after a fixed number of days (see
	RETENTION_DAYS in the Lambda function) -- it is not kept indefinitely.

	This script itself sends only:
	  - page  : the page path, e.g. "/index.html"
	  - ts    : the UTC timestamp of the view
	  - src   : the "src" tag from the URL, if any, e.g. "?src=yt"
	  - ref   : document.referrer -- the page that linked here, if any

	The IP address and User-Agent are NOT sent by this script -- they
	are read by the Lambda function directly from the request itself
	(the caller's address, and the standard User-Agent header every
	browser already sends on every request), so there is nothing extra
	to add to the payload for those two.

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
	// Checked locally, against this same string. Note this is a separate
	// use from the User-Agent header the browser attaches to the request
	// below automatically (and which the Lambda function now reads and
	// stores) — this check just decides locally whether to send at all;
	// it doesn't add navigator.userAgent to the JSON payload itself.
	if (/bot|crawl|spider|headless|curl|wget|python|scrapy|phantomjs/i.test(navigator.userAgent)) {
		return;
	}

	// --- Build the payload -----------------------------------------------
	// document.referrer is the one field genuinely only available here —
	// unlike the IP address and User-Agent, there is no equivalent to
	// read on the server side: the HTTP Referer header on THIS request
	// would just show the current page, not the page that led here.
	var params = new URLSearchParams(window.location.search);
	var payload = {
		page: window.location.pathname,
		ts: new Date().toISOString(),
		src: params.get("src") || "",
		ref: document.referrer || ""
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
