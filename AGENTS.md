Buggag is a no-build Chrome Extension (Manifest V3) that gathers relevant data
from issue pages and timeline selections, then turns that data into a
copy-ready debugging prompt for coding LLMs.

Project Stage

- This repo is no longer a blank scaffold. It contains a working MV3 extension,
  custom UI, generated branding assets, and a heuristic DOM scraper.
- Prefer small, surgical changes over rewrites. Most work here should be
  incremental refinement of scraping, formatting, UI behavior, and branding.

Architecture

- `manifest.json`: extension entrypoint, permissions, icons, popup config, and
  content script registration.
- `content.js`: the main product logic. It injects the floating BugGag UI,
  detects supported pages, scrapes visible data, builds the markdown prompt,
  and manages timeline/inbox behavior.
- `content.css`: all in-page styling for the floating launcher and modal.
- `popup.html`, `popup.css`, `popup.js`: minimal extension popup used to open
  BugGag on the active tab.
- `assets/icons/*`: production icon set used by the manifest.
- `assets/branding/*`: source branding art and promo illustration.

Product Constraints

- Keep the extension dependency-free and build-free unless there is a strong
  reason to change that.
- Preserve the current heuristic DOM-driven approach. Do not introduce brittle
  hard-coded class names unless there is no better option.
- The generated prompt should stay editable in the modal, and the copy button
  must copy whatever text is currently in the textarea.
- When scraping data by clicking around tabs or toggles, restore the page to
  the user’s original visible state before leaving the modal open.
- On timeline pages, prefer capturing the currently expanded event details.
  Only fall back to issue selection UI when there is no active expanded event.

UI Guidance

- Maintain the current playful BugGag visual identity: dark navy base, bright
  coral/pink/cyan/lime accents, cute mascot-driven branding.
- Keep the modal simple. Prefer a single clear primary action over multiple
  secondary controls.
- Avoid adding back low-value support UI like redundant summary panels unless
  the user explicitly asks for them.
- Guard against layout regressions with long titles, narrow widths, and nested
  scrollbars.

Prompt Guidance

- Favor readable markdown over raw dumps.
- Prefer tables for structured sections like request, user, device, or app
  data when possible.
- Keep fallback page snapshots minimal and only include them when structured
  extraction is insufficient.
- Be conservative about noisy values from filter bars, headers, and dashboard
  chrome.

Validation

- After editing JS, run `node --check content.js` and `node --check popup.js`.
- After editing `manifest.json`, validate that it parses as JSON.
- When changing icons or art, confirm exported icon sizes still exist at
  `16`, `32`, `48`, and `128`.
- If changing scraping behavior, prioritize testing against both issue pages
  and timeline-expanded event views.

Editing Notes

- Use `apply_patch` for normal edits.
- Preserve ASCII unless the file already relies on a specific Unicode glyph.
- Do not add a build system, bundler, or framework just to reorganize the
  current code.
