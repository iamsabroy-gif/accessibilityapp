# LinkedIn Post — Chrome Extension Update

Most accessibility scanners can only see what's public.

That's been the frustration behind a lot of my work on AccessScan. You run a scan, get a clean report, and then remember that the parts of your product that actually matter — the dashboard behind the login, the checkout modal, the localhost build you're mid-refactor on — were never scanned at all. A server-side crawler can't reach any of it.

So this week I shipped a Chrome extension.

It runs the full accessibility engine client-side, inside the tab you're already looking at. Which means it scans the things a crawler can't:

→ Authenticated pages — your session, your cookies, your real app
→ SPAs in their actual DOM state, not the empty shell on first paint
→ Open modals, expanded menus, mid-interaction UI
→ localhost:3000, before anything ships

You get a score ring, a violation breakdown by impact, and a deep link into the full report when you want remediation guidance. No page data leaves the browser to do the scan.

The interesting part was the engine port. The scanner runs on a Go backend with Puppeteer, and the same rule set — including the custom checks for things axe doesn't cover, like caption presence, focus order cycling, and context change on focus — now compiles into a single browser bundle that runs everywhere.

Still rough in places. Store listing is in progress. But it already caught issues on my own dashboard that the crawler never saw, which is roughly the point.

More at accessscan.in — happy to hand out early builds if you want to break it.
