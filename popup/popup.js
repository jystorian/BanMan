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

  // 상태 변수 선언 (TDZ 방지 및 안전한 스코프 유지)
  let blacklist_rules = {};
  let currentLang = 'ko';
  let detectedType = 'url'; // 'webstore' | 'domain' | 'url' | 'system'
  let webstoreExtId = null;
  let webstoreTitle = '';
  let domainHost = '';
  let currentUrl = '';
  let tab = null;

  // 1. 다국어 및 블랙리스트 규칙 초기 로드
  try {
    const [lang, stored] = await Promise.all([
      getAppLanguage(),
      chrome.storage.local.get('blacklist_rules')
    ]);
    currentLang = lang;
    blacklist_rules = stored.blacklist_rules || {};
  } catch (err) {
    console.error('BanMan init error:', err);
  }

  langSelect.value = currentLang;
  applyTranslations(currentLang);

  // 대상 판별 함수
  function getSelectedTarget() {
    if (detectedType === 'webstore') {
      return { target: webstoreExtId, type: 'webstore' };
    }
    if (detectedType === 'system') {
      return { target: null, type: 'system' };
    }
    // 기본값: 현재 URL만 (url)
    const scope = document.querySelector('input[name="targetScope"]:checked')?.value || 'url';
    if (scope === 'domain') {
      return { target: domainHost, type: 'domain' };
    } else {
      return { target: currentUrl, type: 'url' };
    }
  }

  // 배지 업데이트 함수
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

  // 기존 등록 여부 확인 및 UI 반영
  function checkExistingRule() {
    if (detectedType === 'system') return;
    const { target } = getSelectedTarget();
    if (!target) return;

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

  // 언어 선택 변경 이벤트
  langSelect.addEventListener('change', async (e) => {
    currentLang = e.target.value;
    await setAppLanguage(currentLang);
    applyTranslations(currentLang);
    updateTargetBadge();
    checkExistingRule();
  });

  // 옵션 페이지 열기
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 스코프 라디오 변경 시 기존 데이터 재확인
  document.querySelectorAll('input[name="targetScope"]').forEach(radio => {
    radio.addEventListener('change', checkExistingRule);
  });

  // 스토리지 변경 시 실시간 동기화
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blacklist_rules) {
      blacklist_rules = changes.blacklist_rules.newValue || {};
      checkExistingRule();
    }
  });

  // 2. 현재 활성 탭 분석
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  } catch (e) {
    console.error('Failed to query tab:', e);
  }

  if (!tab || !tab.url) {
    targetUrlText.textContent = t('tab_info_error', currentLang);
    saveBtn.disabled = true;
    return;
  }

  currentUrl = tab.url;
  const webMatch = currentUrl.match(WEBSTORE_REGEX);

  if (webMatch) {
    detectedType = 'webstore';
    webstoreExtId = webMatch[1].toLowerCase();
    // 탭 제목에서 웹스토어 확장 프로그램 이름 추출 (예: "확장 프로그램 이름 - Chrome 웹스토어")
    if (tab.title) {
      webstoreTitle = tab.title.replace(/\s*-\s*Chrome.*$/i, '').trim();
    }
    // 기존에 저장된 타이틀이 있다면 보존/우선
    if (!webstoreTitle && blacklist_rules[webstoreExtId]?.title) {
      webstoreTitle = blacklist_rules[webstoreExtId].title;
    }
    updateTargetBadge();
    targetDomain.textContent = webstoreTitle ? `${webstoreTitle} (${webstoreExtId.substring(0, 8)}...)` : `ID: ${webstoreExtId.substring(0, 12)}...`;
    targetUrlText.textContent = currentUrl;
    scopeSelector.style.display = 'none';
  } else if (currentUrl.startsWith('http://') || currentUrl.startsWith('https://')) {
    try {
      const parsedUrl = new URL(currentUrl);
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

  // 초기 상태 로드
  checkExistingRule();

  // 저장 버튼 이벤트
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const { target, type } = getSelectedTarget();
    if (!target) return;

    const action = document.querySelector('input[name="actionType"]:checked')?.value || 'block';
    const memo = memoInput.value.trim();

    const now = new Date();
    const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const ruleObj = {
      target,
      type,
      action,
      memo,
      createdAt
    };

    // 웹스토어 확장 프로그램 이름이 있는 경우 함께 저장
    if (type === 'webstore') {
      const titleToSave = webstoreTitle || (blacklist_rules[target]?.title) || '';
      if (titleToSave) {
        ruleObj.title = titleToSave;
      }
    }

    blacklist_rules[target] = ruleObj;

    await chrome.storage.local.set({ blacklist_rules });

    // 웹스토어의 경우 즉시 배지 반영
    if (type === 'webstore' && (action === 'warn' || action === 'block')) {
      try {
        if (tab && tab.id) {
          await chrome.action.setBadgeText({ tabId: tab.id, text: 'BAD' });
          await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#D32F2F' });
        }
      } catch (e) {}
    }

    statusMsg.style.color = '#2e7d32';
    statusMsg.textContent = t('status_saved', currentLang);

    setTimeout(() => {
      window.close();
    }, 450);
  });

  // 삭제 버튼 이벤트
  deleteBtn.addEventListener('click', async () => {
    deleteBtn.disabled = true;
    const { target } = getSelectedTarget();
    if (!target) return;

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
