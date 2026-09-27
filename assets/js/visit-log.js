/*
	VISIT LOGGER
	============
	Sends a small record of this page view to our own AWS endpoint, so
	we can see which pages get visited, which posted link (query-string
	tag) brought the visitor here, and investigate abuse (traffic
	spikes, bad status codes, automated attacks) if it happens. See
	privacy.html section 2 for what visitors are told, and the Data
	Protection Pack's Legitimate Interests Assessment for the legal
	basis. Every record is deleted automatically after a fixed number
	of days (RETENTION_DAYS in the Lambda function).

	This script itself sends only:
	  - page  : the page path, e.g. "/index.html"
	  - src   : the "src" tag from the URL, if any, e.g. "?src=yt"
	  - ref   : document.referrer -- the page that linked here, if any

	Everything else in the stored record is added by the Lambda function
	from the request itself: the time the request reached AWS (so a
	visitor's wrong device clock no longer matters), the User-Agent
	header every browser sends anyway, and a KEYED HASH of the caller's
	IP address. The raw IP address is never stored -- see the "IP
	ADDRESS HASHING" section of hunchtrail_visit_logger.py.

	Three IP-free checks run first to skip the most obvious browser
	automation before anything is sent. These are a soft, best-effort
	filter, not a security boundary: a script that hits the AWS endpoint
	directly never runs this file at all. The real abuse ceiling is the
	request-rate limit on the AWS endpoint itself (Step 6 of the AWS
	setup guide).
*/
(function () {
	"use strict";

	// The API Gateway invoke URL from Step 7 of the AWS setup guide. Set
	// it to "" to switch logging off without removing this file.
	var ENDPOINT = "https://5ed1e2x0oi.execute-api.ap-southeast-2.amazonaws.com/log";
	if (!ENDPOINT) { return; }

	// --- Check 1: navigator.webdriver ----------------------------------
	// Automation frameworks (Selenium, Puppeteer, Playwright) set this
	// flag to true by default. A human visitor's browser never sets it.
	// It won't catch a bot that fakes this value on purpose.
	if (navigator.webdriver) { return; }

	// --- Check 2: a real page has a real window -------------------------
	// Simple headless fetchers that don't run a full browser engine
	// typically report 0 for these, or don't define them at all.
	if (!window.innerWidth || !window.innerHeight) { return; }

	// --- Check 3: obvious bot/crawler User-Agent strings ------------------
	// Checked locally only -- this decides whether to send anything at
	// all; it doesn't add navigator.userAgent to the payload.
	if (/bot|crawl|spider|headless|curl|wget|python|scrapy|phantomjs/i.test(navigator.userAgent)) {
		return;
	}

	// --- Build the payload -----------------------------------------------
	// document.referrer is the one field only available here: the HTTP
	// Referer header on THIS request would just show the current page,
	// not the page that led here. The page path is sent exactly as the
	// browser reports it; the Lambda function tidies "/" into
	// "/index.html" and blanks an unusable src tag.
	var params = new URLSearchParams(window.location.search);
	var payload = {
		page: window.location.pathname,
		src: params.get("src") || "",
		ref: document.referrer || ""
	};

	// A Blob with an explicit content type: sendBeacon does not stringify
	// objects for you. "text/plain" (not "application/json") keeps this a
	// CORS-simple request, so the browser skips the extra OPTIONS
	// preflight round-trip. The body is still valid JSON text.
	var body = new Blob([JSON.stringify(payload)], { type: "text/plain" });

	// --- Send it, without blocking or slowing the page --------------------
	// sendBeacon (Safari on iOS since 11.3, March 2018 -- inside the
	// 7-year window) queues the request and returns immediately, so it
	// never delays rendering even on a slow connection.
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
