const openButton = document.getElementById('open-current')
const statusNode = document.querySelector('[data-status]')

function setStatus(message, tone = '') {
  statusNode.textContent = message
  if (tone) {
    statusNode.dataset.tone = tone
  } else {
    delete statusNode.dataset.tone
  }
}

async function openBugGag() {
  openButton.disabled = true
  setStatus('Connecting to the current tab...')

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.id) {
      throw new Error('No active tab found.')
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'BUGGAG_OPEN' })

    if (!response?.ok) {
      throw new Error(response?.message || 'BugGag is not available on this page.')
    }

    const context = response.pageType === 'timeline' ? 'timeline' : 'issue page'
    setStatus(`BugGag opened on the ${context}.`, 'ok')
    window.close()
  } catch (error) {
    setStatus(
      error?.message || 'Open an issue or timeline page, then try again.',
      'error',
    )
  } finally {
    openButton.disabled = false
  }
}

openButton.addEventListener('click', openBugGag)
