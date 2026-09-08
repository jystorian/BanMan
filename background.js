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

// 탭별 1회 임시 허용(Bypass) 인메모리 관리 맵 (무한 리디렉션 루프 완벽 방지)
const activeBypasses = new Map(); // tabId -> { target, origUrl, host, extId, expiresAt }

async function isBypassed(tabId, url) {
  if (!tabId || !url) return false;

  // 1. 메모리 맵 확인
  let bypass = activeBypasses.get(tabId);
  if (bypass) {
    if (Date.now() > bypass.expiresAt) {
      activeBypasses.delete(tabId);
      bypass = null;
    }
  }

  // 2. 세션 스토리지 보조 확인 (서비스 워커 재시작 대비)
  if (!bypass) {
    try {
      const bypassKey = `bypass_${tabId}`;
      const sessionData = await chrome.storage.session.get(bypassKey);
      if (sessionData[bypassKey]) {
        const stored = sessionData[bypassKey];
        if (Date.now() < stored.expiresAt) {
          bypass = stored;
          activeBypasses.set(tabId, stored);
        } else {
          await chrome.storage.session.remove(bypassKey);
        }
      }
    } catch (e) {}
  }

  if (!bypass) return false;

  // 검증: URL, 호스트, 확장ID 일치 여부 다각도 점검
  if (url === bypass.origUrl || url.startsWith(bypass.origUrl) || bypass.origUrl.startsWith(url)) {
    return true;
  }

  if (bypass.host) {
    try {
      const parsedHost = new URL(url).hostname.toLowerCase();
      if (parsedHost === bypass.host || parsedHost.endsWith('.' + bypass.host)) {
        return true;
      }
    } catch (e) {}
  }

  if (bypass.extId) {
    const match = url.match(WEBSTORE_REGEX);
    if (match && match[1].toLowerCase() === bypass.extId) {
      return true;
    }
  }

  if (bypass.target && (url.includes(bypass.target) || bypass.target === url)) {
    return true;
  }

  return false;
}

// 닫힌 탭 관련 에러 감지 (정상적인 탭 생명주기 이벤트)
function isTabClosedError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return msg.includes('no tab with id') || msg.includes('tab was closed') || msg.includes('cannot be queried');
}

// 탭 URL 검사 및 처리 (차단 리디렉션, 배지, 알림)
async function evaluateTab(tabId, url) {
  if (!url) return;

  // 내부 URL 및 크롬 시스템 페이지 검사 제외
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    return;
  }

  // 탭이 여전히 유효하게 열려 있는지 사전 검증 (이미 닫힌 탭 에러 방지)
  try {
    const activeTab = await chrome.tabs.get(tabId);
    if (!activeTab) return;
  } catch (e) {
    // 탭이 이미 닫혔거나 조기 종료된 경우 안전하게 리턴
    return;
  }

  // 임시 허용 여부 확인
  if (await isBypassed(tabId, url)) {
    return;
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
      if (!isTabClosedError(e)) {
        console.error('차단 페이지 리디렉션 실패:', e);
      }
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
      if (!isTabClosedError(e)) {
        console.error('배지/알림 설정 실패:', e);
      }
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
      const { tabId, origUrl, target } = message;
      if (tabId && origUrl) {
        let host = '';
        try {
          host = new URL(origUrl).hostname.toLowerCase();
        } catch (e) {}

        const webMatch = origUrl.match(WEBSTORE_REGEX);
        const extId = webMatch ? webMatch[1].toLowerCase() : null;

        const bypassData = {
          target: target || '',
          origUrl: origUrl,
          host: host,
          extId: extId,
          expiresAt: Date.now() + 180000 // 3분간 임시 허용 유지
        };

        // 1. 메모리 등록
        activeBypasses.set(tabId, bypassData);

        // 2. 세션 스토리지 보조 등록
        try {
          const bypassKey = `bypass_${tabId}`;
          await chrome.storage.session.set({ [bypassKey]: bypassData });
        } catch (e) {}

        // 3. 탭 이동 수행
        try {
          await chrome.tabs.update(tabId, { url: origUrl });
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      } else {
        sendResponse({ success: false, error: 'Missing tabId or origUrl' });
      }
    })();
    return true;
  }

  if (message.type === 'SAFE_BACK') {
    (async () => {
      const { tabId } = message;
      try {
        if (tabId) {
          await chrome.tabs.update(tabId, { url: 'chrome://newtab/' });
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});
