// popup.js - Active tab inspection and rule management

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

  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    targetUrlText.textContent = '활성화된 탭 정보를 가져올 수 없습니다.';
    saveBtn.disabled = true;
    return;
  }

  const currentUrl = tab.url;
  let parsedUrl = null;
  let detectedType = 'domain'; // 'webstore' | 'domain' | 'url'
  let webstoreExtId = null;
  let domainHost = '';

  const webMatch = currentUrl.match(WEBSTORE_REGEX);

  if (webMatch) {
    detectedType = 'webstore';
    webstoreExtId = webMatch[1].toLowerCase();
    targetTypeBadge.textContent = '크롬 웹스토어 확장';
    targetTypeBadge.className = 'badge webstore';
    targetDomain.textContent = `확장 ID: ${webstoreExtId.substring(0, 12)}...`;
    targetUrlText.textContent = currentUrl;
    scopeSelector.style.display = 'none';
  } else if (currentUrl.startsWith('http://') || currentUrl.startsWith('https://')) {
    try {
      parsedUrl = new URL(currentUrl);
      domainHost = parsedUrl.hostname.toLowerCase();
      targetTypeBadge.textContent = '일반 웹사이트';
      targetTypeBadge.className = 'badge web';
      targetDomain.textContent = domainHost;
      targetUrlText.textContent = currentUrl;
      scopeSelector.style.display = 'block';
    } catch (e) {
      targetUrlText.textContent = 'URL 파싱 실패';
      saveBtn.disabled = true;
      return;
    }
  } else {
    targetTypeBadge.textContent = '특수 페이지';
    targetDomain.textContent = '제한된 시스템 URL';
    targetUrlText.textContent = currentUrl;
    memoInput.disabled = true;
    saveBtn.disabled = true;
    statusMsg.textContent = '시스템/내부 페이지는 등록할 수 없습니다.';
    return;
  }

  // 기존 등록 여부 확인
  const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');

  function getSelectedTarget() {
    if (detectedType === 'webstore') {
      return { target: webstoreExtId, type: 'webstore' };
    }
    const scope = document.querySelector('input[name="targetScope"]:checked')?.value || 'domain';
    if (scope === 'domain') {
      return { target: domainHost, type: 'domain' };
    } else {
      // 쿼리스트링/해시 포함 또는 정규화된 URL
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

      saveBtn.textContent = '메모 및 설정 수정';
      deleteBtn.style.display = 'block';
      statusMsg.textContent = `[등록됨: ${existing.createdAt || '일자 미상'}]`;
    } else {
      // 미등록인 경우 폼 기본화
      if (memoInput.value === '') {
        // 기존 텍스트 유지
      }
      saveBtn.textContent = '블랙리스트 등록';
      deleteBtn.style.display = 'none';
      statusMsg.textContent = '미등록 상태';
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
    statusMsg.textContent = '성공적으로 저장되었습니다!';

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
    statusMsg.textContent = '블랙리스트에서 삭제되었습니다.';

    setTimeout(() => {
      window.close();
    }, 400);
  });
});
