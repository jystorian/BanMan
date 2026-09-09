// background.js - Service Worker for BanMan (Chrome City Protector)

const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

// Helper: URL 매칭 검사
function findMatchingRule(urlStr, rules = {}) {
  if (!urlStr || urlStr.startsWith('chrome://') || urlStr.startsWith('chrome-extension://') || urlStr.startsWith('about:')) {
    return null;
  }

  // 1. 크롬 웹스토어 확장 ID 매칭
  const webstoreMatch = urlStr.match(WEBSTORE_REGEX);
  if (webstoreMatch) {
    const extId = webstoreMatch[1].toLowerCase();
    if (rules[extId]) {
      return rules[extId];
    }
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlStr);
  } catch (e) {
    return null;
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 2. 도메인 및 URL 매칭
  for (const [key, rule] of Object.entries(rules)) {
    const target = (rule.target || key).toLowerCase().trim();
    if (!target) continue;

    if (rule.type === 'webstore') {
      // 이미 웹스토어 매칭에서 확인됨
      continue;
    }

    if (rule.type === 'domain') {
      // 정확한 호스트명이거나 서브도메인인 경우 (예: blog.example.com -> example.com)
      if (hostname === target || hostname.endsWith('.' + target)) {
        return rule;
      }
    } else {
      // URL 접두사 또는 포함 매칭
      if (urlStr.toLowerCase().includes(target)) {
        return rule;
      }
    }
  }

  return null;
}

// 탭 URL 검사 및 처리 (차단 리디렉션, 배지, 알림)
async function evaluateTab(tabId, url) {
  if (!url) return;

  // 임시 허용 여부 세션 확인 (무한 루프 방지)
  try {
    const bypassKey = `bypass_${tabId}`;
    const sessionData = await chrome.storage.session.get(bypassKey);
    if (sessionData[bypassKey] && url.startsWith(sessionData[bypassKey])) {
      // 이번 1회는 통과
      return;
    }
  } catch (e) {
    // 세션 스토리지 미지원 또는 에러 무시
  }

  const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
  const matchedRule = findMatchingRule(url, blacklist_rules);

  if (!matchedRule) {
    // 매칭되는 규칙이 없으면 배지 초기화
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
    } catch (e) {}
    return;
  }

  // 1. 사전 차단 (Block)
  if (matchedRule.action === 'block') {
    const blockedPageUrl = chrome.runtime.getURL('pages/blocked.html') +
      `?target=${encodeURIComponent(matchedRule.target)}` +
      `&memo=${encodeURIComponent(matchedRule.memo || '')}` +
      `&origUrl=${encodeURIComponent(url)}`;

    try {
      await chrome.tabs.update(tabId, { url: blockedPageUrl });
    } catch (e) {
      console.error('차단 페이지 리디렉션 실패:', e);
    }
    return;
  }

  // 2. 경고 (Warn) 또는 웹스토어 비추천
  if (matchedRule.action === 'warn') {
    try {
      await chrome.action.setBadgeText({ tabId, text: 'BAD' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#D32F2F' });

      // 시스템 데스크톱 알림 생성
      const notifId = `warn_${matchedRule.target}_${Date.now()}`;
      await chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: '⚠️ 주의/비추천 대상 감지',
        message: `[사유: ${matchedRule.memo || '미기재'}]\n등록된 주의 대상 웹사이트 또는 확장입니다.`,
        priority: 2
      });
    } catch (e) {
      console.error('배지/알림 설정 실패:', e);
    }
    return;
  }

  // 3. hide 모드일 때 (직접 진입한 경우 배지만 간단히 표시)
  if (matchedRule.action === 'hide') {
    try {
      await chrome.action.setBadgeText({ tabId, text: 'HIDE' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#757575' });
    } catch (e) {}
  }
}

// 탭 업데이트 감지 (로딩 시작 시점 및 URL 변경 시점)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const targetUrl = changeInfo.url || tab.url;
  if (targetUrl) {
    evaluateTab(tabId, targetUrl);
  }
});

// 탭 전환(활성화) 감지
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      evaluateTab(activeInfo.tabId, tab.url);
    }
  } catch (e) {}
});

// 메시지 수신 핸들러 (Content Script 또는 Pages 통신)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_RULES') {
    chrome.storage.local.get('blacklist_rules').then(({ blacklist_rules = {} }) => {
      sendResponse({ rules: blacklist_rules });
    });
    return true; // 비동기 응답 유지
  }

  if (message.type === 'ALLOW_ONCE') {
    (async () => {
      const { tabId, origUrl } = message;
      if (tabId && origUrl) {
        const bypassKey = `bypass_${tabId}`;
        await chrome.storage.session.set({ [bypassKey]: origUrl });
        await chrome.tabs.update(tabId, { url: origUrl });
        sendResponse({ success: true });
      }
    })();
    return true;
  }
});
