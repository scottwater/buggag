# BugGag

BugGag is a Manifest V3 Chrome extension that turns BugSnag issue pages into an LLM-ready debugging prompt.

## What It Does

- Adds a floating `BugGag` launcher on BugSnag issue pages.
- Scrapes the visible issue details, including stack trace, request details, user data, breadcrumbs, metadata, and summary stats when they are available on the page.
- Opens a modal with a plain-text prompt you can review and copy into ChatGPT, Claude, or another coding assistant.
- Adds lightweight `BugGag` buttons next to visible issue links on the BugSnag timeline so you can jump straight from the timeline to an issue and auto-open the prompt builder.

## Load It In Chrome

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select this folder: `/Users/Scott.Watermasysk/projects/buggag`.

## Current Behavior

- Issue pages: click the floating `BugGag` button or the extension popup.
- Timeline pages: click an inline `BugGag` badge next to an issue, or open the extension popup and choose from the visible issue links.
- The extractor is heuristic and DOM-driven so it does not depend on BugSnag’s private CSS class names.

## Notes

- This first version is intentionally no-build and framework-free so it is easy to load and iterate on.
- The next refinement step is testing it against a live authenticated BugSnag session and tightening the selectors around the actual issue tabs and summary cards.
