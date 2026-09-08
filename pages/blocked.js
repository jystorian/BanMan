// blocked.js - Logic for blocked page navigation & bypass with i18n

document.addEventListener('DOMContentLoaded', async () => {
  const currentLang = await getAppLanguage();
  applyTranslations(currentLang);

  const params = new URLSearchParams(window.location.search);
  const target = params.get('target') || '-';
  const memo = params.get('memo') || t('blocked_no_memo', currentLang);
  const origUrl = params.get('origUrl') || '';

  const targetDisplay = document.getElementById('targetDisplay');
  const memoDisplay = document.getElementById('memoDisplay');
  const origUrlDisplay = document.getElementById('origUrlDisplay');
  const goBackBtn = document.getElementById('goBackBtn');
  const bypassBtn = document.getElementById('bypassBtn');
  const manageRuleLink = document.getElementById('manageRuleLink');

  targetDisplay.textContent = target;
  memoDisplay.textContent = memo;
  origUrlDisplay.textContent = origUrl || '-';

  // 안전 폴백 함수 (새 탭으로 안전하게 이동 또는 닫기)
  async function navigateToSafeFallback() {
    try {
      let tabId = null;
      try {
        const currentTab = await chrome.tabs.getCurrent();
        tabId = currentTab?.id;
      } catch (e) {}

      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }

      if (tabId) {
        await chrome.runtime.sendMessage({ type: 'SAFE_BACK', tabId });
        return;
      }
    } catch (e) {}

    try {
      window.close();
    } catch (e) {
      window.location.href = 'chrome://newtab/';
    }
  }

  // 1. 뒤로가기 버튼
  goBackBtn.addEventListener('click', async () => {
    goBackBtn.disabled = true;

    // 히스토리가 2개 초과일 때: 이전 정상 페이지 -> 차단 사이트 -> 차단 안내 페이지
    // 2단계 뒤로(go(-2)) 가야 차단 사이트를 건너뛰고 정상 페이지로 돌아감
    if (window.history.length > 2) {
      window.history.go(-2);

      // 리디렉션 체인 등으로 450ms 후에도 여전히 이 차단 페이지에 머물러 있다면 안전 폴백
      setTimeout(async () => {
        await navigateToSafeFallback();
      }, 450);
    } else {
      await navigateToSafeFallback();
    }
  });

  // 2. 이 탭에서 1회 임시 허용
  bypassBtn.addEventListener('click', async () => {
    if (!origUrl) return;

    bypassBtn.disabled = true;
    bypassBtn.textContent = t('blocked_bypassing', currentLang);

    try {
      let tabId = null;
      try {
        const currentTab = await chrome.tabs.getCurrent();
        tabId = currentTab?.id;
      } catch (e) {}

      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }

      if (tabId) {
        const res = await chrome.runtime.sendMessage({
          type: 'ALLOW_ONCE',
          tabId: tabId,
          origUrl: origUrl,
          target: target
        });

        if (!res || !res.success) {
          window.location.href = origUrl;
        }
      } else {
        window.location.href = origUrl;
      }
    } catch (e) {
      console.error('임시 허용 요청 실패:', e);
      window.location.href = origUrl;
    }
  });

  // 3. 규칙 관리 페이지 열기
  manageRuleLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
