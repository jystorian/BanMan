// popup.js - Active tab inspection and rule management with multi-language support

const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

document.addEventListener('DOMContentLoaded', async () => {
  const targetTypeBadge = document.getElementById('targetTypeBadge');
  const targetDomain = document.getElementById('targetDomain');
  const targetUrlText = document.getElementById('targetUrlText');
  const scopeSelector = document.getElementById('scopeSelector');
  const memoInput = document.getElementById('memoInput');
  const saveBtn = document.getElementById('saveBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const statusMsg = document.getElementById('statusMsg');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const langSelect = document.getElementById('langSelect');

  // 다국어 초기화 및 이벤트 리스너
  let currentLang = await getAppLanguage();
  langSelect.value = currentLang;
  applyTranslations(currentLang);

  langSelect.addEventListener('change', async (e) => {
    currentLang = e.target.value;
    await setAppLanguage(currentLang);
    applyTranslations(currentLang);
    updateTargetBadge();
    checkExistingRule();
  });

  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    targetUrlText.textContent = t('tab_info_error', currentLang);
    saveBtn.disabled = true;
    return;
  }

  const currentUrl = tab.url;
  let parsedUrl = null;
  let detectedType = 'url'; // 'webstore' | 'domain' | 'url'
  let webstoreExtId = null;
  let domainHost = '';

  const webMatch = currentUrl.match(WEBSTORE_REGEX);

  function updateTargetBadge() {
    if (detectedType === 'webstore') {
      targetTypeBadge.textContent = t('badge_webstore', currentLang);
      targetTypeBadge.className = 'badge webstore';
    } else if (detectedType === 'domain' || detectedType === 'url') {
      targetTypeBadge.textContent = t('badge_web', currentLang);
      targetTypeBadge.className = 'badge web';
    } else {
      targetTypeBadge.textContent = t('badge_system', currentLang);
      targetTypeBadge.className = 'badge system';
    }
  }

  if (webMatch) {
    detectedType = 'webstore';
    webstoreExtId = webMatch[1].toLowerCase();
    updateTargetBadge();
    targetDomain.textContent = `ID: ${webstoreExtId.substring(0, 12)}...`;
    targetUrlText.textContent = currentUrl;
    scopeSelector.style.display = 'none';
  } else if (currentUrl.startsWith('http://') || currentUrl.startsWith('https://')) {
    try {
      parsedUrl = new URL(currentUrl);
      domainHost = parsedUrl.hostname.toLowerCase();
      detectedType = 'url';
      updateTargetBadge();
      targetDomain.textContent = domainHost;
      targetUrlText.textContent = currentUrl;
      scopeSelector.style.display = 'block';
    } catch (e) {
      targetUrlText.textContent = t('url_parse_error', currentLang);
      saveBtn.disabled = true;
      return;
    }
  } else {
    detectedType = 'system';
    updateTargetBadge();
    targetDomain.textContent = currentUrl.split(':')[0] || 'internal';
    targetUrlText.textContent = currentUrl;
    memoInput.disabled = true;
    saveBtn.disabled = true;
    statusMsg.textContent = t('status_system_page', currentLang);
    return;
  }

  // 기존 등록 여부 확인
  const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');

  function getSelectedTarget() {
    if (detectedType === 'webstore') {
      return { target: webstoreExtId, type: 'webstore' };
    }
    // 기본값: 현재 URL만 (url)
    const scope = document.querySelector('input[name="targetScope"]:checked')?.value || 'url';
    if (scope === 'domain') {
      return { target: domainHost, type: 'domain' };
    } else {
      return { target: currentUrl, type: 'url' };
    }
  }

  function checkExistingRule() {
    const { target } = getSelectedTarget();
    const existing = blacklist_rules[target];

    if (existing) {
      memoInput.value = existing.memo || '';
      const actionRadio = document.querySelector(`input[name="actionType"][value="${existing.action}"]`);
      if (actionRadio) actionRadio.checked = true;

      saveBtn.textContent = t('save_btn_edit', currentLang);
      deleteBtn.style.display = 'block';
      statusMsg.textContent = t('status_registered', currentLang, { date: existing.createdAt || '-' });
    } else {
      saveBtn.textContent = t('save_btn_add', currentLang);
      deleteBtn.style.display = 'none';
      statusMsg.textContent = t('status_unregistered', currentLang);
    }
  }

  // 스코프 라디오 변경 시 기존 데이터 재확인
  document.querySelectorAll('input[name="targetScope"]').forEach(radio => {
    radio.addEventListener('change', checkExistingRule);
  });

  // 초기 상태 로드
  checkExistingRule();

  // 저장 버튼
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const { target, type } = getSelectedTarget();
    const action = document.querySelector('input[name="actionType"]:checked')?.value || 'block';
    const memo = memoInput.value.trim();

    const now = new Date();
    const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    blacklist_rules[target] = {
      target,
      type,
      action,
      memo,
      createdAt
    };

    await chrome.storage.local.set({ blacklist_rules });

    // 웹스토어의 경우 즉시 배지 반영
    if (type === 'webstore' && (action === 'warn' || action === 'block')) {
      chrome.action.setBadgeText({ tabId: tab.id, text: 'BAD' });
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#D32F2F' });
    }

    statusMsg.style.color = '#2e7d32';
    statusMsg.textContent = t('status_saved', currentLang);

    setTimeout(() => {
      window.close();
    }, 450);
  });

  // 삭제 버튼
  deleteBtn.addEventListener('click', async () => {
    deleteBtn.disabled = true;
    const { target } = getSelectedTarget();

    delete blacklist_rules[target];
    await chrome.storage.local.set({ blacklist_rules });

    try {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    } catch (e) {}

    statusMsg.style.color = '#555';
    statusMsg.textContent = t('status_deleted', currentLang);

    setTimeout(() => {
      window.close();
    }, 400);
  });
});
