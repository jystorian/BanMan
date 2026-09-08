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

  // 1. 뒤로가기 버튼
  goBackBtn.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  });

  // 2. 이 탭에서 1회 임시 허용
  bypassBtn.addEventListener('click', async () => {
    if (!origUrl) return;

    bypassBtn.disabled = true;
    bypassBtn.textContent = t('blocked_bypassing', currentLang);

    try {
      const currentTab = await chrome.tabs.getCurrent();
      if (currentTab) {
        chrome.runtime.sendMessage({
          type: 'ALLOW_ONCE',
          tabId: currentTab.id,
          origUrl: origUrl
        });
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
