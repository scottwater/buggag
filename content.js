(() => {
  if (window.__buggagLoaded) {
    return
  }

  window.__buggagLoaded = true

  const ROOT_ID = 'buggag-root'
  const AUTO_OPEN_KEY = 'buggag:auto-open'
  const ISSUE_PATH_PATTERN = /\/errors\/[^/?#]+/
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], button, [role="tab"], summary'
  const SECTION_DEFS = [
    { key: 'stackTrace', title: 'Stack Trace', matchers: ['stack trace', 'stacktrace', 'threads'] },
    { key: 'request', title: 'Request', matchers: ['request', 'headers', 'query'] },
    { key: 'user', title: 'User', matchers: ['user', 'account'] },
    { key: 'breadcrumbs', title: 'Breadcrumbs', matchers: ['breadcrumbs'] },
    { key: 'metadata', title: 'Metadata', matchers: ['metadata', 'custom data', 'diagnostics'] },
    { key: 'device', title: 'Device', matchers: ['device', 'browser', 'environment'] },
    { key: 'app', title: 'App', matchers: ['app', 'release', 'version'] },
    { key: 'featureFlags', title: 'Feature Flags', matchers: ['feature flags', 'experiments'] },
  ]
  const SUMMARY_FIELDS = [
    { label: 'Status', matchers: ['status'] },
    { label: 'Events', matchers: ['events', 'occurrences'] },
    { label: 'Users', matchers: ['users', 'people'] },
    { label: 'First seen', matchers: ['first seen'] },
    { label: 'Last seen', matchers: ['last seen'] },
    { label: 'Release stage', matchers: ['release stage'] },
    { label: 'App version', matchers: ['app version', 'release'] },
    { label: 'Context', matchers: ['context'] },
  ]

  const state = {
    ui: null,
    lastResult: null,
    lastUrl: location.href,
    timelineEnhanceTimer: null,
    autoOpenTimer: null,
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  function normalizeText(value) {
    return (value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase().replace(/[:\s]+/g, ' ').trim()
  }

  function escapeHtml(value) {
    return (value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false
    }

    if (element.closest(`#${ROOT_ID}`)) {
      return false
    }

    const style = window.getComputedStyle(element)

    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false
    }

    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function intersectsViewport(element) {
    if (!isVisible(element)) {
      return false
    }

    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight

    return rect.bottom > 0
      && rect.right > 0
      && rect.top < viewportHeight
      && rect.left < viewportWidth
  }

  function cleanBlockText(value, maxLength = 12000) {
    const text = normalizeText(value)

    if (text.length <= maxLength) {
      return text
    }

    return `${text.slice(0, maxLength)}\n… [truncated]`
  }

  function getPageType(url = location) {
    const pathname = typeof url === 'string' ? new URL(url).pathname : url.pathname

    if (/\/timeline\b/.test(pathname)) {
      return 'timeline'
    }

    if (ISSUE_PATH_PATTERN.test(pathname)) {
      return 'issue'
    }

    return 'unsupported'
  }

  function canonicalizeUrl(href) {
    const url = new URL(href, location.origin)
    url.hash = ''
    return url.toString()
  }

  function ensureUi() {
    if (state.ui) {
      return state.ui
    }

    const root = document.createElement('div')
    root.id = ROOT_ID
    root.innerHTML = `
      <button class="buggag-launcher" type="button" hidden>
        <span class="buggag-launcher-mark">BG</span>
        <span class="buggag-launcher-copy">
          <span class="buggag-launcher-eyebrow">Incident brief</span>
          <span class="buggag-launcher-label">Build prompt</span>
        </span>
      </button>
      <div class="buggag-backdrop" hidden></div>
      <section class="buggag-modal" role="dialog" aria-modal="true" hidden>
        <header class="buggag-header">
          <div>
            <p class="buggag-kicker">BugGag Dispatch</p>
            <h2 class="buggag-title">BugGag</h2>
            <p class="buggag-subtitle">Catch the noisy bits, keep the signal, and spin this page into a copy-ready debugging brief.</p>
          </div>
          <button class="buggag-close" type="button" aria-label="Close BugGag">×</button>
        </header>
        <div class="buggag-body"></div>
      </section>
    `

    document.documentElement.append(root)

    const ui = {
      root,
      launcher: root.querySelector('.buggag-launcher'),
      launcherLabel: root.querySelector('.buggag-launcher-label'),
      backdrop: root.querySelector('.buggag-backdrop'),
      modal: root.querySelector('.buggag-modal'),
      title: root.querySelector('.buggag-title'),
      subtitle: root.querySelector('.buggag-subtitle'),
      body: root.querySelector('.buggag-body'),
      close: root.querySelector('.buggag-close'),
    }

    ui.launcher.addEventListener('click', () => {
      void openBugGag()
    })

    ui.close.addEventListener('click', closeModal)
    ui.backdrop.addEventListener('click', closeModal)

    ui.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]')

      if (!button) {
        return
      }

      const { action, url } = button.dataset

      if (action === 'copy-prompt') {
        void copyPrompt(button)
      }

      if (action === 'choose-issue' && url) {
        navigateToIssue(url)
      }

      if (action === 'choose-timeline-selection') {
        const selectionIndex = Number(button.dataset.selectionIndex)
        void chooseTimelineSelection(selectionIndex)
      }
    })

    state.ui = ui
    return ui
  }

  function setHeader(title, subtitle) {
    const ui = ensureUi()
    ui.title.textContent = title
    ui.subtitle.textContent = subtitle
  }

  function setBodyMode(mode = '') {
    const ui = ensureUi()
    ui.body.classList.toggle('buggag-body--result', mode === 'result')
  }

  function openModal() {
    const ui = ensureUi()
    ui.backdrop.hidden = false
    ui.modal.hidden = false
  }

  function isModalOpen() {
    const ui = ensureUi()
    return !ui.modal.hidden
  }

  function closeModal() {
    const ui = ensureUi()
    ui.backdrop.hidden = true
    ui.modal.hidden = true
  }

  function renderLoading(title, subtitle) {
    const ui = ensureUi()
    setBodyMode('loading')
    setHeader(title, subtitle)
    ui.body.innerHTML = `
      <div class="buggag-loading">
        <div class="buggag-spinner" aria-hidden="true"></div>
        <h3>Spinning up the brief</h3>
        <p>BugGag is combing through the open issue, cracking open the useful tabs, and building a clean prompt you can paste straight into an LLM.</p>
      </div>
    `
  }

  function renderError(title, message) {
    const ui = ensureUi()
    setBodyMode('error')
    setHeader(title, message)
    ui.body.innerHTML = `
      <div class="buggag-error">
        <h3>Couldn’t build the brief</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    `
  }

  function renderChooser(issueLinks) {
    const ui = ensureUi()
    setBodyMode('chooser')
    setHeader('Pick an issue', 'Choose any visible issue from the timeline and BugGag will jump in, then build the brief automatically.')

    if (!issueLinks.length) {
      ui.body.innerHTML = `
        <div class="buggag-chooser-empty">
          <h3>No visible issues found</h3>
          <p>Scroll the timeline until issue links are visible, or open an issue page directly and run BugGag there.</p>
        </div>
      `
      return
    }

    ui.body.innerHTML = `
      <div class="buggag-chooser">
        <p class="buggag-chooser-copy">BugGag detected ${issueLinks.length} issue link${issueLinks.length === 1 ? '' : 's'} on this page.</p>
        <ul class="buggag-issue-list">
          ${issueLinks
            .map(
              (issue) => `
                <li class="buggag-issue-row">
                  <div>
                    <p class="buggag-issue-title">${escapeHtml(issue.title)}</p>
                    <p class="buggag-issue-url">${escapeHtml(issue.url)}</p>
                  </div>
                  <button class="buggag-button" type="button" data-action="choose-issue" data-url="${escapeHtml(issue.url)}">
                    Open and build prompt
                  </button>
                </li>
              `,
            )
            .join('')}
        </ul>
      </div>
    `
  }

  function renderTimelineSelectionChooser(selections) {
    const ui = ensureUi()
    setBodyMode('chooser')
    setHeader('Pick an expanded issue', 'More than one timeline event is open. Choose the one BugGag should use, and it will collapse the others first.')

    ui.body.innerHTML = `
      <div class="buggag-chooser">
        <p class="buggag-chooser-copy">BugGag found ${selections.length} expanded timeline selection${selections.length === 1 ? '' : 's'}.</p>
        <ul class="buggag-issue-list">
          ${selections
            .map(
              (selection, index) => `
                <li class="buggag-issue-row">
                  <div>
                    <p class="buggag-issue-title">${escapeHtml(selection.title)}</p>
                    <p class="buggag-issue-url">${escapeHtml(selection.subtitle || selection.url || 'Current timeline selection')}</p>
                  </div>
                  <button class="buggag-button" type="button" data-action="choose-timeline-selection" data-selection-index="${index}">
                    Use this selection
                  </button>
                </li>
              `,
            )
            .join('')}
        </ul>
      </div>
    `
  }

  function renderResult(result) {
    const ui = ensureUi()
    setBodyMode('result')
    setHeader(result.title || 'BugGag prompt ready', 'Review the prompt, tweak anything you want, then copy it into your LLM of choice.')
    ui.body.innerHTML = `
      <section class="buggag-panel buggag-panel--solo">
        <div>
          <h3 class="buggag-panel-title">Prompt</h3>
          <p class="buggag-panel-copy">Edit anything you want before sharing. The copy button uses exactly what is in the box.</p>
        </div>
        <div class="buggag-actions">
          <button class="buggag-button" type="button" data-action="copy-prompt">Copy prompt</button>
        </div>
        <textarea class="buggag-textarea"></textarea>
      </section>
    `

    const textarea = ui.body.querySelector('.buggag-textarea')

    if (textarea) {
      textarea.value = result.prompt
      textarea.addEventListener('input', () => {
        if (state.lastResult) {
          state.lastResult.prompt = textarea.value
        }
      })
    }
  }

  async function copyPrompt(button) {
    const textarea = ensureUi().body.querySelector('.buggag-textarea')
    const promptText = textarea?.value || state.lastResult?.prompt || ''

    if (!promptText) {
      return
    }

    const originalLabel = button.textContent

    try {
      if (textarea) {
        textarea.focus()
        textarea.select()
      }

      await navigator.clipboard.writeText(promptText)
      button.textContent = 'Copied'
    } catch (error) {
      if (textarea) {
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
      }

      button.textContent = 'Copied'
    }

    window.setTimeout(() => {
      button.textContent = originalLabel
    }, 1200)
  }

  function getMainTitle(doc) {
    const heading = [...doc.querySelectorAll('h1, [role="heading"][aria-level="1"]')].find(isVisible)

    if (heading) {
      return cleanBlockText(heading.textContent, 240)
    }

    return cleanBlockText((doc.title || '').replace(/\s*-\s*BugSnag.*$/i, ''), 240)
  }

  function collectIssueLinks(doc = document) {
    const seen = new Set()

    return [...doc.querySelectorAll('a[href*="/errors/"]')]
      .filter((anchor) => isVisible(anchor) && !anchor.closest(`#${ROOT_ID}`))
      .map((anchor) => {
        const url = canonicalizeUrl(anchor.href)
        const key = new URL(url).pathname

        if (seen.has(key)) {
          return null
        }

        seen.add(key)

        return {
          anchor,
          url,
          title: cleanBlockText(anchor.innerText || anchor.textContent || 'Untitled issue', 180),
        }
      })
      .filter(Boolean)
  }

  function getExpandedTimelineSummaryRows({ viewportOnly = false } = {}) {
    return [...document.querySelectorAll('tr.EventsTable-row.DataTable-row--inlineDetailRow')]
      .filter((row) => isVisible(row) && (!viewportOnly || intersectsViewport(row)))
  }

  function getTimelineDetailRowForSummaryRow(summaryRow) {
    if (!summaryRow) {
      return null
    }

    if (summaryRow.matches?.('tr.DataTable-inlineDetail')) {
      return summaryRow
    }

    return summaryRow.closest?.('tr.DataTable-inlineDetail')
      || (summaryRow.nextElementSibling?.matches?.('tr.DataTable-inlineDetail') ? summaryRow.nextElementSibling : null)
      || null
  }

  function getInlineTimelineDetailRow() {
    const visibleSummaryRow = getExpandedTimelineSummaryRows({ viewportOnly: true })[0]

    if (visibleSummaryRow) {
      return getTimelineDetailRowForSummaryRow(visibleSummaryRow) || visibleSummaryRow
    }

    const anySummaryRow = getExpandedTimelineSummaryRows()[0]

    if (anySummaryRow) {
      return getTimelineDetailRowForSummaryRow(anySummaryRow) || anySummaryRow
    }

    return [...document.querySelectorAll('tr.DataTable-inlineDetail')].find(isVisible) || null
  }

  function getInlineTimelineSummaryRow(container = null) {
    const detailRow = container?.matches?.('tr.DataTable-inlineDetail')
      ? container
      : container?.closest?.('tr.DataTable-inlineDetail') || getInlineTimelineDetailRow()

    if (!detailRow) {
      return getExpandedTimelineSummaryRows({ viewportOnly: true })[0]
        || getExpandedTimelineSummaryRows()[0]
        || null
    }

    const nestedSummaryRow = detailRow.querySelector('tr.EventsTable-row.DataTable-row--inlineDetailRow')

    if (nestedSummaryRow) {
      return nestedSummaryRow
    }

    let current = detailRow.previousElementSibling

    while (current) {
      if (current.matches?.('tr.EventsTable-row')) {
        return current
      }

      current = current.previousElementSibling
    }

    return null
  }

  function getTimelineSelectionSubtitle(container) {
    const summaryRow = getInlineTimelineSummaryRow(container)
    const lines = normalizeText(
      summaryRow?.querySelector('.DataTable-primaryContent')?.innerText
        || summaryRow?.innerText
        || '',
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length <= 1) {
      return ''
    }

    return cleanBlockText(lines.slice(1, 3).join(' - '), 180)
  }

  function collectExpandedTimelineSelections() {
    const summaryRows = getExpandedTimelineSummaryRows({ viewportOnly: true })
    const candidates = summaryRows.length ? summaryRows : getExpandedTimelineSummaryRows()

    return candidates
      .map((summaryRow) => {
        const detailRow = getTimelineDetailRowForSummaryRow(summaryRow) || summaryRow

        return {
          detailRow,
          summaryRow,
          title: getTimelineSelectionTitle(detailRow) || 'Expanded issue',
          subtitle: getTimelineSelectionSubtitle(detailRow),
          url: getTimelineSelectionUrl(detailRow),
        }
      })
  }

  function getExpandedTimelineContainer() {
    const inlineDetailRow = getInlineTimelineDetailRow()

    if (inlineDetailRow) {
      return inlineDetailRow
    }

    const controls = [...document.querySelectorAll('button, [role="tab"], summary, a')].filter(
      (element) => isVisible(element) && matchesAny(element.innerText || element.textContent, ['stacktrace']),
    )

    for (const control of controls) {
      let current = control

      while (current && current !== document.body) {
        const text = normalizeText(current.innerText || current.textContent)
        const lower = text.toLowerCase()
        const hasTabSet = ['stacktrace', 'breadcrumbs', 'request', 'app', 'device'].filter((label) => lower.includes(label)).length >= 3
        const hasExpandedDetails = Boolean(current.querySelector('pre, code')) || /raw view/i.test(text)

        if (hasTabSet && hasExpandedDetails) {
          return current
        }

        current = current.parentElement
      }
    }

    return null
  }

  function hasExpandedTimelineSelection() {
    return Boolean(getExpandedTimelineContainer())
  }

  function getTimelineSelectionReferenceNode(container) {
    if (!container) {
      return null
    }

    const summaryRow = getInlineTimelineSummaryRow(container)

    if (summaryRow) {
      return summaryRow
    }

    const preferredSelectors = [
      '[role="tablist"]',
      '[role="tab"][aria-selected="true"]',
      'button[aria-selected="true"]',
      'pre',
      'code',
    ]

    for (const selector of preferredSelectors) {
      const match = [...container.querySelectorAll(selector)].find(isVisible)

      if (match) {
        return match
      }
    }

    return [...container.querySelectorAll('button, [role="tab"], summary, div, section')].find(
      (element) => isVisible(element) && /raw view/i.test(element.innerText || element.textContent || ''),
    ) || null
  }

  function getTimelineSelectionIssueLink(container) {
    if (!container) {
      return null
    }

    const scopedAnchors = collectIssueLinks(container)

    if (!scopedAnchors.length) {
      return null
    }

    if (scopedAnchors.length === 1) {
      return {
        url: scopedAnchors[0].url,
        title: cleanBlockText(scopedAnchors[0].title, 240),
      }
    }

    const referenceNode = getTimelineSelectionReferenceNode(container)

    if (!referenceNode) {
      const fallbackAnchor = scopedAnchors[scopedAnchors.length - 1]
      return {
        url: fallbackAnchor.url,
        title: cleanBlockText(fallbackAnchor.title, 240),
      }
    }

    const precedingAnchors = scopedAnchors.filter(({ anchor }) => {
      const position = anchor.compareDocumentPosition(referenceNode)
      return position === 0 || Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)
    })

    const matchedAnchor = precedingAnchors[precedingAnchors.length - 1] || scopedAnchors[0]

    if (matchedAnchor) {
      return {
        url: matchedAnchor.url,
        title: cleanBlockText(matchedAnchor.title, 240),
      }
    }

    return null
  }

  function cleanTimelineTitleCandidate(value) {
    const candidate = cleanBlockText((value || '').split('•')[0].trim(), 240)

    if (!candidate) {
      return ''
    }

    if (/^(?:event|release stage|severity|users?|app types?|releases?|hosts?)$/i.test(candidate)) {
      return ''
    }

    return candidate
  }

  function getTimelineSelectionTitle(container) {
    if (!container) {
      return ''
    }

    const summaryRow = getInlineTimelineSummaryRow(container)
    const summaryTitle = cleanTimelineTitleCandidate(
      summaryRow?.querySelector('.DataTable-primaryContent')?.innerText
        || summaryRow?.innerText
        || '',
    )

    if (summaryTitle) {
      return summaryTitle
    }

    const linkedTitle = cleanTimelineTitleCandidate(getTimelineSelectionIssueLink(container)?.title || '')

    if (linkedTitle) {
      return linkedTitle
    }

    const beforeTabs = (container.innerText || container.textContent || '').split(/\bstacktrace\b/i)[0] || ''
    const lines = beforeTabs
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (line) => !/^\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago$/i.test(line)
          && !/^[A-Z][a-z]{2}\s+\d{1,2},/i.test(line)
          && !/^demo$/i.test(line)
          && !/^(?:handled|unhandled)$/i.test(line)
          && !/^(?:event|release stage|severity)$/i.test(line)
          && !/^(?:stacktrace|breadcrumbs|app|device|request|user|trace|custom|raw view|full trace|project code)$/i.test(line),
      )

    const strongCandidate = lines.find((line) => /::|error|exception|failure|failed|invalid|not found|notfound|timeout|rejection/i.test(line))
    const preferred = cleanTimelineTitleCandidate(strongCandidate || lines[0] || '')

    if (preferred) {
      return preferred
    }

    return cleanBlockText(lines.slice(0, 2).join(' - ') || lines[0] || '', 240)
  }

  function getTimelineSelectionUrl(container) {
    return getTimelineSelectionIssueLink(container)?.url || location.href
  }

  function collectSummaryStats(doc) {
    const pairs = []

    for (const term of doc.querySelectorAll('dt')) {
      if (!isVisible(term) || !term.nextElementSibling) {
        continue
      }

      const label = normalizeKey(term.textContent)
      const value = cleanBlockText(term.nextElementSibling.innerText || term.nextElementSibling.textContent, 160)

      if (label && value) {
        pairs.push({ label, value })
      }
    }

    for (const header of doc.querySelectorAll('th')) {
      const cell = header.parentElement?.querySelector('td')

      if (!isVisible(header) || !cell) {
        continue
      }

      const label = normalizeKey(header.textContent)
      const value = cleanBlockText(cell.innerText || cell.textContent, 160)

      if (label && value) {
        pairs.push({ label, value })
      }
    }

    const text = cleanBlockText(doc.body?.innerText || '', 20000)

    return SUMMARY_FIELDS.map((field) => {
      const fromPairs = pairs.find((pair) => field.matchers.includes(pair.label))

      if (fromPairs) {
        return { label: field.label, value: fromPairs.value }
      }

      for (const matcher of field.matchers) {
        const pattern = new RegExp(`(?:^|\\n)${matcher.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\n+([^\\n]+)`, 'i')
        const match = text.match(pattern)

        if (match?.[1]) {
          return { label: field.label, value: cleanBlockText(match[1], 160) }
        }
      }

      return null
    }).filter(Boolean)
  }

  function matchesAny(text, matchers) {
    const normalized = normalizeKey(text)
    return matchers.some((matcher) => normalized === matcher || normalized.includes(matcher))
  }

  function findMatchingControls(doc, matchers) {
    return [...doc.querySelectorAll('button, [role="tab"], summary')]
      .filter((element) => isVisible(element) && matchesAny(element.innerText || element.textContent, matchers))
      .sort((left, right) => (left.innerText || left.textContent || '').length - (right.innerText || right.textContent || '').length)
  }

  function getSelectedTabPeer(control) {
    const tablist = control.closest('[role="tablist"]')

    if (!tablist) {
      return null
    }

    return [...tablist.querySelectorAll('[role="tab"]')].find(
      (candidate) => candidate !== control && candidate.getAttribute('aria-selected') === 'true',
    ) || null
  }

  function snapshotToggleControl(control) {
    const details = control.tagName === 'SUMMARY' ? control.closest('details') : null

    return {
      control,
      ariaExpanded: control.getAttribute('aria-expanded'),
      ariaPressed: control.getAttribute('aria-pressed'),
      detailsOpen: details ? details.open : null,
    }
  }

  async function restoreSelectedTab(control) {
    if (!control?.isConnected || control.getAttribute('aria-selected') === 'true') {
      return
    }

    control.click()
    await sleep(120)
  }

  async function restoreToggleControl(snapshot) {
    const control = snapshot?.control

    if (!control?.isConnected) {
      return
    }

    const details = control.tagName === 'SUMMARY' ? control.closest('details') : null

    if (details && snapshot.detailsOpen !== null && details.open !== snapshot.detailsOpen) {
      control.click()
      await sleep(100)
      return
    }

    if (snapshot.ariaExpanded !== null && control.getAttribute('aria-expanded') !== snapshot.ariaExpanded) {
      control.click()
      await sleep(100)
      return
    }

    if (snapshot.ariaPressed !== null && control.getAttribute('aria-pressed') !== snapshot.ariaPressed) {
      control.click()
      await sleep(100)
    }
  }

  function findAssociatedPanel(control) {
    const controlsId = control.getAttribute('aria-controls')

    if (controlsId) {
      const panel = document.getElementById(controlsId)
      if (panel) {
        return panel
      }
    }

    if (control.id) {
      const labelledPanel = document.querySelector(`[aria-labelledby~="${CSS.escape(control.id)}"]`)
      if (labelledPanel) {
        return labelledPanel
      }
    }

    const tabContainer = control.closest('[role="tablist"]')?.parentElement

    if (tabContainer) {
      const panel = [...tabContainer.querySelectorAll('[role="tabpanel"], section, article, div')].find(
        (element) => isVisible(element) && cleanBlockText(element.innerText || element.textContent, 2000).length > 80,
      )

      if (panel) {
        return panel
      }
    }

    return findInformativeContainer(control)
  }

  function findInformativeContainer(element) {
    let current = element

    while (current && current !== document.body) {
      const text = cleanBlockText(current.innerText || current.textContent, 3000)

      if (text.length > 120 && text.length < 14000) {
        return current
      }

      current = current.parentElement
    }

    return null
  }

  function collectFollowingText(heading) {
    const container = heading.closest('section, article, [role="region"]')

    if (container) {
      const text = cleanBlockText(container.innerText || container.textContent)

      if (text.length > 60 && text.length < 14000) {
        return text
      }
    }

    const chunks = []
    let current = heading.nextElementSibling
    let inspected = 0

    while (current && inspected < 14) {
      if (current.matches?.(HEADING_SELECTOR)) {
        break
      }

      const text = cleanBlockText(current.innerText || current.textContent, 2000)

      if (text) {
        chunks.push(text)
      }

      current = current.nextElementSibling
      inspected += 1
    }

    return cleanBlockText(chunks.join('\n\n'))
  }

  async function expandNestedContent(scope) {
    const controls = [...scope.querySelectorAll('button, summary')]
      .filter((element) => isVisible(element) && /show more|show all|expand|load more|view all/i.test(element.innerText || element.textContent))
      .slice(0, 6)
    const snapshots = []

    for (const control of controls) {
      snapshots.push(snapshotToggleControl(control))
      control.click()
      await sleep(140)
    }

    return snapshots
  }

  async function extractSection(definition) {
    const controls = findMatchingControls(document, definition.matchers)

    for (const control of controls) {
      const restoreTab = getSelectedTabPeer(control)
      const toggleSnapshot = restoreTab ? null : snapshotToggleControl(control)
      let nestedSnapshots = []

      try {
        control.click()
        await sleep(180)

        const panel = findAssociatedPanel(control)

        if (panel) {
          nestedSnapshots = await expandNestedContent(panel)
          const text = cleanBlockText(panel.innerText || panel.textContent)

          if (text.length > 40) {
            return text
          }
        }
      } finally {
        for (const snapshot of nestedSnapshots.reverse()) {
          await restoreToggleControl(snapshot)
        }

        await restoreSelectedTab(restoreTab)
        await restoreToggleControl(toggleSnapshot)
      }
    }

    const heading = [...document.querySelectorAll(HEADING_SELECTOR)].find(
      (element) => isVisible(element) && matchesAny(element.innerText || element.textContent, definition.matchers),
    )

    if (heading) {
      const text = collectFollowingText(heading)

      if (text.length > 40) {
        return text
      }
    }

    return ''
  }

  function extractStackTraceFallback(doc) {
    const stackBlock = [...doc.querySelectorAll('pre, code')]
      .filter(isVisible)
      .map((element) => cleanBlockText(element.innerText || element.textContent, 9000))
      .find((text) => /\bat\b.+:\d+/m.test(text) || /Exception|Error:/m.test(text))

    if (stackBlock) {
      return stackBlock
    }

    const lines = (doc.body?.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\bat\b.+:\d+/i.test(line) || /https?:\/\/.+:\d+/i.test(line))

    return cleanBlockText(lines.slice(0, 80).join('\n'), 9000)
  }

  const FALLBACK_NOISE_PATTERNS = [
    /^jump to$/i,
    /^menu$/i,
    /^filter bar$/i,
    /^sidebar$/i,
    /^table$/i,
    /^overview$/i,
    /^inbox$/i,
    /^timeline$/i,
    /^performance$/i,
    /^releases$/i,
    /^features$/i,
    /^stage$/i,
    /^release$/i,
    /^severity$/i,
    /^status:open$/i,
    /^filtersets$/i,
    /^< inbox$/i,
    /^linked issues$/i,
    /^create or link an issue$/i,
    /^trend$/i,
    /^view on timeline/i,
    /^summaries$/i,
    /^release stages$/i,
    /^app types$/i,
    /^hosts$/i,
    /^assign$/i,
    /^mark as fixed$/i,
    /^fix with mcp$/i,
    /^new$/i,
    /^snooze$/i,
    /^ignore$/i,
    /^comments & activity$/i,
    /^1h$/i,
    /^3h$/i,
    /^1d$/i,
    /^7d$/i,
    /^30d$/i,
    /^all$/i,
    /^edt$/i,
    /^utc$/i,
    /^any$/i,
    /^\d{1,3}\.\d%$/,
  ]

  function isFallbackNoiseLine(line) {
    const normalized = normalizeText(line)

    if (!normalized) {
      return true
    }

    return FALLBACK_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))
  }

  function discoverUnvisitedSectionLabels() {
    const allMatchers = SECTION_DEFS.flatMap((def) => def.matchers)

    const knownControls = [...document.querySelectorAll('button, [role="tab"], summary')]
      .filter((element) => isVisible(element) && matchesAny(element.innerText || element.textContent, allMatchers))

    // Need at least 2 known tabs to confirm we are looking at a tabbed section layout.
    if (knownControls.length < 2) {
      return []
    }

    const containers = new Set()

    for (const control of knownControls) {
      const tablist = control.closest('[role="tablist"]')
      containers.add(tablist || control.parentElement)
    }

    const seen = new Set()
    const labels = []

    for (const container of containers) {
      if (!container) {
        continue
      }

      const controls = [...container.querySelectorAll('button, [role="tab"], summary')].filter(isVisible)

      for (const control of controls) {
        const label = normalizeText(control.innerText || control.textContent)

        if (!label || label.length > 40 || label.length < 2) {
          continue
        }

        if (matchesAny(label, allMatchers)) {
          continue
        }

        if (FALLBACK_NOISE_PATTERNS.some((pattern) => pattern.test(label))) {
          continue
        }

        const key = normalizeKey(label)

        if (seen.has(key)) {
          continue
        }

        seen.add(key)
        labels.push(label)
      }
    }

    return labels
  }

  async function extractUnvisitedTabSections() {
    const labels = discoverUnvisitedSectionLabels()
    const sections = []

    for (const label of labels) {
      const key = normalizeKey(label)
      const text = await extractSection({ key, title: label, matchers: [key] })

      if (text) {
        sections.push({ title: label, text })
      }
    }

    return sections
  }

  function sanitizeFallbackSnapshot(text) {
    const lines = normalizeText(text)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !isFallbackNoiseLine(line))

    const deduped = []

    for (const line of lines) {
      if (deduped[deduped.length - 1] !== line) {
        deduped.push(line)
      }
    }

    return cleanBlockText(deduped.slice(0, 60).join('\n'), 2400)
  }

  function shouldIncludePageExcerpt(sections) {
    if (sections.length < 2) {
      return true
    }

    const titles = new Set(sections.map((section) => section.title))
    const hasDiagnosticSection = ['Request', 'User', 'Breadcrumbs', 'Device', 'App', 'Metadata'].some((title) => titles.has(title))

    return !hasDiagnosticSection
  }

  function buildPageExcerpt(doc, capturedSections) {
    if (!shouldIncludePageExcerpt(capturedSections)) {
      return ''
    }

    const capturedText = capturedSections.map((section) => section.text).join('\n')
    const pageText = sanitizeFallbackSnapshot(doc.body?.innerText || '')

    if (!pageText) {
      return ''
    }

    if (capturedText && pageText.startsWith(capturedText.slice(0, 100))) {
      return ''
    }

    return pageText
  }

  function splitParagraphs(text) {
    return normalizeText(text)
      .split(/\n\s*\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
  }

  function looksLikeFieldLabel(value) {
    const candidate = normalizeText(value)

    if (!candidate || candidate.length > 48 || candidate.includes('\n')) {
      return false
    }

    if (/[.!?]$/.test(candidate)) {
      return false
    }

    return /^[A-Za-z0-9_./:()[\]\-]+(?: [A-Za-z0-9_./:()[\]\-]+){0,3}$/.test(candidate)
  }

  function escapeMarkdownTableCell(value) {
    return normalizeText(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>')
  }

  function formatCodeBlock(text, language = 'text') {
    const fence = text.includes('```') ? '~~~~' : '```'
    return `${fence}${language}\n${text}\n${fence}`
  }

  function formatMarkdownTable(headers, rows) {
    if (!rows.length) {
      return ''
    }

    const headerRow = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`
    const dividerRow = `| ${headers.map(() => '---').join(' | ')} |`
    const bodyRows = rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`)

    return [headerRow, dividerRow, ...bodyRows].join('\n')
  }

  function parseKeyValueParagraphArray(paragraphs) {
    const pairs = []
    const remainder = []
    let index = 0

    while (index < paragraphs.length) {
      const key = paragraphs[index]
      const value = paragraphs[index + 1]

      if (value && looksLikeFieldLabel(key) && !isBreadcrumbTimestamp(key) && !isBreadcrumbTimestamp(value)) {
        pairs.push({ key, value })
        index += 2
        continue
      }

      remainder.push(key)
      index += 1
    }

    return { pairs, remainder }
  }

  function parseKeyValueSection(text) {
    return parseKeyValueParagraphArray(splitParagraphs(text))
  }

  function isLowSignalStat(stat) {
    const value = normalizeKey(stat.value)
    return !value || value === 'any' || value === 'severity' || value === '[empty]' || value === '0 items'
  }

  function formatOverviewSection(result) {
    const rows = [
      ['Title', result.title || 'Unknown issue'],
      ['BugSnag URL', result.url],
      ['Captured at', result.capturedAt],
    ]

    for (const stat of result.stats.filter((entry) => !isLowSignalStat(entry))) {
      rows.push([stat.label, stat.value])
    }

    return ['## Issue Overview', formatMarkdownTable(['Field', 'Value'], rows)].join('\n\n')
  }

  function formatStructuredSection(title, text) {
    const { pairs, remainder } = parseKeyValueSection(text)

    if (pairs.length < 2) {
      return `## ${title}\n\n${formatCodeBlock(text)}`
    }

    const blocks = [
      `## ${title}`,
      formatMarkdownTable(
        ['Field', 'Value'],
        pairs.map((pair) => [pair.key, pair.value]),
      ),
    ]

    if (remainder.length) {
      blocks.push('Additional notes:')
      blocks.push(remainder.map((item) => `- ${item}`).join('\n'))
    }

    return blocks.join('\n\n')
  }

  function isBreadcrumbTimestamp(value) {
    const candidate = normalizeText(value)
    return /^(?:\d+(?:ms|s|m|h|d)(?: \d+(?:ms|s|m|h|d))*) before$/i.test(candidate)
      || /^(?:just now|\d+ (?:seconds?|minutes?|hours?|days?) ago)$/i.test(candidate)
  }

  function startsBreadcrumbDetailSequence(paragraphs, index) {
    const current = paragraphs[index]
    const next = paragraphs[index + 1]

    if (!current || !next || isBreadcrumbTimestamp(current) || isBreadcrumbTimestamp(next)) {
      return false
    }

    if (!looksLikeFieldLabel(current)) {
      return false
    }

    if (looksLikeFieldLabel(next) && paragraphs[index + 2]) {
      return false
    }

    return true
  }

  function parseBreadcrumbs(text) {
    const paragraphs = splitParagraphs(text)
    const events = []
    let index = paragraphs.findIndex((paragraph) => isBreadcrumbTimestamp(paragraph))

    if (index === -1) {
      return []
    }

    while (index < paragraphs.length) {
      const timestamp = paragraphs[index]

      if (!isBreadcrumbTimestamp(timestamp)) {
        index += 1
        continue
      }

      let cursor = index + 1
      const type = paragraphs[cursor] || 'UNKNOWN'
      cursor += 1

      const summaryParts = []

      while (
        cursor < paragraphs.length
        && !isBreadcrumbTimestamp(paragraphs[cursor])
        && !startsBreadcrumbDetailSequence(paragraphs, cursor)
        && summaryParts.length < 2
      ) {
        summaryParts.push(paragraphs[cursor])
        cursor += 1
      }

      const detailParagraphs = []

      while (cursor < paragraphs.length && !isBreadcrumbTimestamp(paragraphs[cursor])) {
        detailParagraphs.push(paragraphs[cursor])
        cursor += 1
      }

      const { pairs, remainder } = parseKeyValueParagraphArray(detailParagraphs)
      events.push({
        timestamp,
        type,
        summary: summaryParts.join(' - '),
        details: pairs,
        remainder,
      })

      index = cursor
    }

    return events
  }

  function formatBreadcrumbsSection(text) {
    const events = parseBreadcrumbs(text)

    if (!events.length) {
      return `## Breadcrumbs\n\n${formatCodeBlock(text)}`
    }

    const blocks = ['## Breadcrumbs']

    for (const [index, event] of events.entries()) {
      blocks.push(`### ${index + 1}. ${event.timestamp} - ${event.type}`)

      if (event.summary) {
        blocks.push(`- Summary: ${event.summary}`)
      }

      if (event.details.length) {
        blocks.push(
          formatMarkdownTable(
            ['Field', 'Value'],
            event.details.map((detail) => [detail.key, detail.value]),
          ),
        )
      }

      if (event.remainder.length) {
        blocks.push(event.remainder.map((item) => `- ${item}`).join('\n'))
      }
    }

    return blocks.join('\n\n')
  }

  function cleanStackTraceText(text) {
    const lines = normalizeText(text)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line && !/^view details$/i.test(line) && !/^raw view$/i.test(line))

    return lines.join('\n')
  }

  function formatSection(section) {
    if (section.title === 'Stack Trace') {
      return `## ${section.title}\n\n${formatCodeBlock(cleanStackTraceText(section.text))}`
    }

    if (section.title === 'Breadcrumbs') {
      return formatBreadcrumbsSection(section.text)
    }

    return formatStructuredSection(section.title, section.text)
  }

  function buildPrompt(result) {
    const blocks = [
      '# BugSnag Issue Investigation Brief',
      '## Requested Analysis\n- Identify the likely root cause.\n- Call out the most relevant stack frames or breadcrumbs.\n- Suggest a concrete fix.\n- Note any follow-up checks, edge cases, or missing context.\n- Treat request and user information as sensitive and avoid repeating secrets unless they are essential to the diagnosis.',
    ]

    blocks.push(formatOverviewSection(result))

    for (const section of result.sections) {
      blocks.push(formatSection(section))
    }

    if (result.pageExcerpt) {
      blocks.push(`## Additional Raw Page Snapshot\n\n${formatCodeBlock(result.pageExcerpt)}`)
    }

    return blocks.join('\n\n')
  }

  async function extractIssue() {
    const title = getMainTitle(document)

    if (!title && getPageType() !== 'issue') {
      throw new Error('Open an issue page, or choose an issue from the timeline first.')
    }

    const stats = collectSummaryStats(document)
    const sections = []

    for (const definition of SECTION_DEFS) {
      const text = await extractSection(definition)

      if (text) {
        sections.push({ title: definition.title, text })
      }
    }

    sections.push(...await extractUnvisitedTabSections())

    if (!sections.some((section) => section.title === 'Stack Trace')) {
      const fallbackStack = extractStackTraceFallback(document)

      if (fallbackStack) {
        sections.unshift({ title: 'Stack Trace', text: fallbackStack })
      }
    }

    const filteredSections = sections.filter(
      (section, index, all) => all.findIndex((candidate) => candidate.title === section.title) === index,
    )
    const pageExcerpt = buildPageExcerpt(document, filteredSections)

    return {
      title: title || 'Issue',
      url: location.href,
      capturedAt: new Date().toLocaleString(),
      stats,
      sections: filteredSections,
      pageExcerpt,
      prompt: '',
    }
  }

  async function waitForIssueContent(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (getMainTitle(document) || document.querySelector('pre, code, dt, h1')) {
        return
      }

      await sleep(240)
    }
  }

  async function waitForTimelineSelection(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const container = getExpandedTimelineContainer()

      if (container) {
        return container
      }

      await sleep(220)
    }

    return null
  }

  async function chooseTimelineSelection(selectionIndex) {
    const selections = collectExpandedTimelineSelections()
    const target = selections[selectionIndex]

    if (!target?.summaryRow) {
      renderError('Selection disappeared', 'BugGag could not find that expanded timeline issue anymore. Reopen it and try again.')
      return
    }

    renderLoading('Focusing your selection', 'BugGag is collapsing the other open timeline items so it can read the one you picked cleanly.')

    for (const selection of selections) {
      if (selection.summaryRow === target.summaryRow || !selection.summaryRow?.isConnected) {
        continue
      }

      selection.summaryRow.click()
      await sleep(180)
    }

    let container = await waitForTimelineSelection(1200)
    let activeSummaryRow = getInlineTimelineSummaryRow(container)

    if (activeSummaryRow !== target.summaryRow && target.summaryRow.isConnected) {
      target.summaryRow.click()
      await sleep(220)
      container = await waitForTimelineSelection(1200)
      activeSummaryRow = getInlineTimelineSummaryRow(container)
    }

    if (!container || activeSummaryRow !== target.summaryRow) {
      renderError('Unable to isolate selection', 'BugGag could not narrow the timeline to the issue you picked. Collapse the others manually and try again.')
      return
    }

    await captureCurrentIssue({
      announce: false,
      titleOverride: getTimelineSelectionTitle(container),
      urlOverride: getTimelineSelectionUrl(container),
    })
  }

  async function captureCurrentIssue({ announce = true, titleOverride = '', urlOverride = '' } = {}) {
    if (announce) {
      openModal()
    }

    renderLoading('Building the BugGag brief', 'BugGag is collecting stack traces, request details, user data, breadcrumbs, and the highest-signal facts it can find on this issue.')

    try {
      await waitForIssueContent()
      const result = await extractIssue()
      if (titleOverride) {
        result.title = titleOverride
      }

      if (urlOverride) {
        result.url = urlOverride
      }

      result.prompt = buildPrompt(result)
      state.lastResult = result
      renderResult(result)
    } catch (error) {
      renderError('Unable to capture this page', error?.message || 'BugGag could not find issue details on the current page.')
    }
  }

  function navigateToIssue(url) {
    sessionStorage.setItem(AUTO_OPEN_KEY, '1')
    window.location.assign(url)
  }

  function enhanceTimelineLinks() {
    const pageType = getPageType()

    if (pageType !== 'timeline') {
      cleanupTimelineButtons()
      return
    }

    for (const issue of collectIssueLinks()) {
      if (issue.anchor.dataset.buggagEnhanced === 'true') {
        continue
      }

      issue.anchor.dataset.buggagEnhanced = 'true'

      const button = document.createElement('button')
      button.className = 'buggag-inline-button'
      button.type = 'button'
      button.textContent = 'BugGag'
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        navigateToIssue(issue.url)
      })

      issue.anchor.insertAdjacentElement('afterend', button)
    }
  }

  function cleanupTimelineButtons() {
    for (const button of document.querySelectorAll('.buggag-inline-button')) {
      button.remove()
    }

    for (const anchor of document.querySelectorAll('a[data-buggag-enhanced="true"]')) {
      delete anchor.dataset.buggagEnhanced
    }
  }

  function scheduleTimelineEnhancement() {
    window.clearTimeout(state.timelineEnhanceTimer)
    state.timelineEnhanceTimer = window.setTimeout(enhanceTimelineLinks, 180)
  }

  async function openBugGag() {
    const pageType = getPageType()

    if (pageType === 'issue') {
      await captureCurrentIssue()
      return { ok: true, pageType }
    }

    if (pageType === 'timeline') {
      const expandedSelections = collectExpandedTimelineSelections()

      if (expandedSelections.length > 1) {
        openModal()
        renderTimelineSelectionChooser(expandedSelections)
        return { ok: true, pageType }
      }

      const container = await waitForTimelineSelection(1200)

      if (container) {
        const titleOverride = getTimelineSelectionTitle(container)
        const urlOverride = getTimelineSelectionUrl(container)
        await captureCurrentIssue({ titleOverride, urlOverride })
        return { ok: true, pageType }
      }

      openModal()
      renderChooser(collectIssueLinks())
      return { ok: true, pageType }
    }

    return {
      ok: false,
      pageType,
      message: 'BugGag only runs on issue pages and timeline views.',
    }
  }

  function syncUiToRoute() {
    const pageType = getPageType()
    const ui = ensureUi()

    if (pageType === 'unsupported') {
      ui.launcher.hidden = true
      closeModal()
      cleanupTimelineButtons()
      return
    }

    ui.launcher.hidden = false
    ui.launcherLabel.textContent = pageType === 'timeline' && !hasExpandedTimelineSelection() ? 'Pick issue' : 'Build prompt'

    if (pageType === 'timeline') {
      scheduleTimelineEnhancement()
    } else {
      cleanupTimelineButtons()
      maybeAutoOpen()
    }
  }

  function maybeAutoOpen() {
    if (getPageType() !== 'issue') {
      return
    }

    const pending = sessionStorage.getItem(AUTO_OPEN_KEY)

    if (!pending) {
      return
    }

    sessionStorage.removeItem(AUTO_OPEN_KEY)
    window.clearTimeout(state.autoOpenTimer)
    state.autoOpenTimer = window.setTimeout(() => {
      void captureCurrentIssue()
    }, 700)
  }

  function installNavigationHooks() {
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState

    const onNavigate = () => {
      if (location.href === state.lastUrl) {
        return
      }

      state.lastUrl = location.href
      window.setTimeout(syncUiToRoute, 40)
    }

    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args)
      onNavigate()
      return result
    }

    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args)
      onNavigate()
      return result
    }

    window.addEventListener('popstate', onNavigate)
    window.addEventListener('hashchange', onNavigate)
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'BUGGAG_OPEN') {
      return undefined
    }

    void openBugGag().then(sendResponse)
    return true
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isModalOpen()) {
      return
    }

    event.preventDefault()
    closeModal()
  })

  installNavigationHooks()
  new MutationObserver(() => {
    if (getPageType() === 'timeline') {
      scheduleTimelineEnhancement()
    }
  }).observe(document.documentElement, { childList: true, subtree: true })

  syncUiToRoute()
})()
