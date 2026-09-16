// background.js - Service Worker for BanMan (Chrome City Protector)

try {
  importScripts('i18n.js');
} catch (e) {
  console.warn('importScripts i18n.js failed:', e);
}

const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

// O(1) 고속 조회를 위한 인메모리 인덱스 캐시 (10,000개 이상 대용량 대응)
let ruleIndex = null;
let lastRulesRef = null;

function buildRuleIndex(rules = {}) {
  const domainMap = new Map();
  const webstoreMap = new Map();
  const urlRules = [];

  for (const [key, rule] of Object.entries(rules)) {
    const target = (rule.target || key).toLowerCase().trim();
    if (!target) continue;

    if (rule.type === 'webstore') {
      webstoreMap.set(target, rule);
    } else if (rule.type === 'domain') {
      domainMap.set(target, rule);
    } else {
      urlRules.push({ target, rule });
      if (rule.rawUrl) {
        const rawTarget = rule.rawUrl.toLowerCase().trim();
        if (rawTarget && rawTarget !== target) {
          urlRules.push({ target: rawTarget, rule });
        }
      }
    }
  }

  return { domainMap, webstoreMap, urlRules };
}

// Helper: URL 매칭 검사 (O(1) 고속 매칭)
function findMatchingRule(urlStr, rules = {}) {
  if (!urlStr || urlStr.startsWith('chrome://') || urlStr.startsWith('chrome-extension://') || urlStr.startsWith('about:')) {
    return null;
  }

  if (lastRulesRef !== rules || !ruleIndex) {
    ruleIndex = buildRuleIndex(rules);
    lastRulesRef = rules;
  }

  // 1. 크롬 웹스토어 확장 ID 매칭 (O(1))
  const webstoreMatch = urlStr.match(WEBSTORE_REGEX);
  if (webstoreMatch) {
    const extId = webstoreMatch[1].toLowerCase();
    if (ruleIndex.webstoreMap.has(extId)) {
      return ruleIndex.webstoreMap.get(extId);
    }
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

  // 2. 도메인 매칭 (O(1) 정확 매칭 및 서브도메인 계층 검사)
  // 예: a.b.example.com -> b.example.com -> example.com
  let currentHost = hostname;
  while (currentHost) {
    if (ruleIndex.domainMap.has(currentHost)) {
      return ruleIndex.domainMap.get(currentHost);
    }
    const dotIndex = currentHost.indexOf('.');
    if (dotIndex === -1) break;
    currentHost = currentHost.slice(dotIndex + 1);
  }

  // 3. URL 접두사 또는 포함 매칭 (경로가 포함된 특수 규칙만 순회)
  if (ruleIndex.urlRules.length > 0) {
    const lowerUrl = urlStr.toLowerCase();
    for (let i = 0; i < ruleIndex.urlRules.length; i++) {
      if (lowerUrl.includes(ruleIndex.urlRules[i].target)) {
        return ruleIndex.urlRules[i].rule;
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
      await chrome.action.setBadgeText({ tabId, text: 'BAN' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#DC2626' });
      await chrome.tabs.update(tabId, { url: blockedPageUrl });
    } catch (e) {
      // 탭이 사용자에 의해 닫혔거나 탐색이 취소된 경우 조용히 무시
    }
    return;
  }

  // 2. 주의 (Warn) 또는 웹스토어 비추천
  if (matchedRule.action === 'warn') {
    try {
      await chrome.action.setBadgeText({ tabId, text: 'BAD' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#EA580C' });

      // 시스템 데스크톱 알림 생성 (BanMan 주체 명시 및 다국어 지원)
      const notifId = `warn_${matchedRule.target}_${Date.now()}`;
      const langData = await chrome.storage.local.get('app_lang').catch(() => ({}));
      const lang = langData?.app_lang || 'ko';

      let notifTitle = '[BanMan] ⚠️ 주의 대상 웹사이트 감지';
      let notifMessage = `[사유: ${matchedRule.memo || '미기재'}]\n사용자가 등록한 주의/비추천 대상 웹사이트입니다.`;

      if (lang === 'en') {
        notifTitle = '[BanMan] ⚠️ Caution Target Detected';
        notifMessage = `[Reason: ${matchedRule.memo || 'Not specified'}]\nThis site is registered in your BanMan caution list.`;
      } else if (lang === 'ja') {
        notifTitle = '[BanMan] ⚠️ 注意対象を検出しました';
        notifMessage = `[理由: ${matchedRule.memo || '未記入'}]\nBanManの注意リストに登録されたサイトです。`;
      }

      await chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: notifTitle,
        message: notifMessage,
        priority: 2
      });
    } catch (e) {
      // 탭이 닫히거나 알림 생성이 취소된 경우 조용히 무시
    }
    return;
  }

  // 3. hide 모드일 때 (직접 진입한 경우 배지만 간단히 표시)
  if (matchedRule.action === 'hide') {
    try {
      await chrome.action.setBadgeText({ tabId, text: 'HIDE' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748B' });
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

// 웹스토어 확장 프로그램 제목 조회 헬퍼 함수
async function fetchWebstoreTitleDirect(extId) {
  extId = (extId || '').toLowerCase().trim();
  if (!extId) return null;

  try {
    const url = `https://chromewebstore.google.com/detail/${encodeURIComponent(extId)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en;q=0.9' } });
    if (!res.ok) return null;
    const html = await res.text();

    // 1. <title> 태그 검색
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].replace(/\s*-\s*Chrome.*$/i, '').replace(/\s*-\s*크롬.*$/i, '').trim();
      if (title && !title.toLowerCase().includes('chrome web store') && !title.toLowerCase().includes('chrome 웹스토어')) {
        return title;
      }
    }

    // 2. <meta property="og:title"> 검색
    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch && ogMatch[1]) {
      const title = ogMatch[1].replace(/\s*-\s*Chrome.*$/i, '').replace(/\s*-\s*크롬.*$/i, '').trim();
      if (title) return title;
    }
  } catch (err) {
    console.warn('background fetch webstore title failed:', err);
  }

  return null;
}

let lastContextMetadata = null;

// 메시지 수신 핸들러 (Content Script 또는 Pages 통신)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_CONTEXT_METADATA') {
    lastContextMetadata = message.data || null;
    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'GET_RULES') {
    chrome.storage.local.get('blacklist_rules').then(({ blacklist_rules = {} }) => {
      sendResponse({ rules: blacklist_rules });
    });
    return true; // 비동기 응답 유지
  }

  // 웹스토어 확장 프로그램 제목 조회 (Service Worker의 host_permissions로 CORS 없이 fetch)
  if (message.type === 'FETCH_WEBSTORE_TITLE') {
    (async () => {
      const title = await fetchWebstoreTitleDirect(message.extId);
      sendResponse({ title });
    })();
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

// ==========================================
// Context Menu Actions for Links
// ==========================================

let menuSetupPromise = null;

async function setupContextMenus(lang) {
  // 동시 다발적 호출 시 이전 생성이 완료될 때까지 대기 (경쟁 상태 완벽 방지)
  if (menuSetupPromise) {
    try {
      await menuSetupPromise;
    } catch (e) {}
  }

  menuSetupPromise = (async () => {
    try {
      if (!lang) {
        lang = await getAppLanguage();
      }

      const CONTEXT_TARGETS = ['link', 'video', 'audio', 'image', 'frame'];

      // 1. 기존 메뉴를 비동기로 깨끗이 제거 후 완료 대기
      await new Promise((resolve) => {
        chrome.contextMenus.removeAll(() => {
          if (chrome.runtime.lastError) {
            // Unchecked runtime.lastError 방지
          }
          resolve();
        });
      });

      // 2. chrome.runtime.lastError를 항시 점검하여 Unchecked 에러를 원천 차단하는 안전한 생성 래퍼
      const safeCreate = (properties) => {
        return new Promise((resolve) => {
          chrome.contextMenus.create(properties, () => {
            if (chrome.runtime.lastError) {
              // 중복 생성이나 이미 존재하는 항목 에러를 안전하게 점검/억제하여 크롬 에러 콘솔 오염 방지
            }
            resolve();
          });
        });
      };

      // 3. 부모 메뉴가 완전히 생성된 후 자식 메뉴가 등록되도록 순차적(Sequential) 생성
      // 3-1. Root Menu (모든 웹 영역에서 우클릭 가능하도록 'all' 설정)
      await safeCreate({
        id: 'banman_root',
        title: t('ctx_root', lang),
        contexts: ['all']
      });

      // 3-2. Direct 1-click Actions (URL/Media)
      await safeCreate({
        id: 'banman_block',
        parentId: 'banman_root',
        title: t('ctx_block', lang),
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_warn',
        parentId: 'banman_root',
        title: t('ctx_warn', lang),
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_hide',
        parentId: 'banman_root',
        title: t('ctx_hide', lang),
        contexts: CONTEXT_TARGETS
      });

      // 3-3. Highlight Submenu & Actions
      await safeCreate({
        id: 'banman_highlight',
        parentId: 'banman_root',
        title: t('ctx_highlight', lang),
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_hl_star',
        parentId: 'banman_highlight',
        title: t('ctx_hl_star', lang),
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_hl_pin',
        parentId: 'banman_highlight',
        title: t('ctx_hl_pin', lang),
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_hl_custom',
        parentId: 'banman_highlight',
        title: t('ctx_hl_custom', lang),
        contexts: CONTEXT_TARGETS
      });

      // 3-4. Separator
      await safeCreate({
        id: 'banman_sep',
        parentId: 'banman_root',
        type: 'separator',
        contexts: CONTEXT_TARGETS
      });

      // 3-5. Remove Menu
      await safeCreate({
        id: 'banman_remove',
        parentId: 'banman_root',
        title: t('ctx_remove', lang),
        contexts: CONTEXT_TARGETS
      });

      // 3-6. Separator & Element Picker (사파리 스타일 화면 요소 선택 가리기)
      await safeCreate({
        id: 'banman_sep_picker',
        parentId: 'banman_root',
        type: 'separator',
        contexts: CONTEXT_TARGETS
      });

      await safeCreate({
        id: 'banman_pick_element',
        parentId: 'banman_root',
        title: t('ctx_element_picker', lang),
        contexts: ['all']
      });
    } catch (err) {
      console.warn('setupContextMenus error:', err);
    }
  })();

  try {
    await menuSetupPromise;
  } finally {
    menuSetupPromise = null;
  }
}

// 사용자 피드백 안내 함수 (인페이지 토스트 및 데스크톱 알림)
async function notifyUser(tabId, messageText, level = 'success') {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_TOAST',
      message: messageText,
      level: level
    }).catch(() => {
      // 탭에 content script가 없거나 권한이 없는 내부 페이지일 경우 안전하게 패스
    });
  }

  try {
    const notifId = `ctx_${Date.now()}`;
    await chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'BanMan',
      message: messageText,
      priority: 1
    });
  } catch (e) {}
}

// 긴 URL 스마트 축약 (도메인은 살리고 쿼리 파라미터는 슬림하게)
function formatDisplayUrl(rawUrl, maxLen = 42) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    const host = parsed.hostname;
    let path = parsed.pathname + parsed.search;
    if (path === '/' || !path) return host;
    if (host.length + path.length > maxLen) {
      const remain = Math.max(8, maxLen - host.length - 4);
      path = path.slice(0, remain) + '...';
    }
    return host + path;
  } catch (e) {
    return rawUrl.length > maxLen ? rawUrl.slice(0, maxLen - 3) + '...' : rawUrl;
  }
}

// 광고 또는 리디렉션 추적 URL에서 실제 목적지 URL 추출
function extractActualTargetUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const searchParams = parsed.searchParams;
    const candidateKeys = ['adurl', 'url', 'dest', 'destination', 'target', 'redirect', 'r', 'out', 'link'];
    for (const key of candidateKeys) {
      const val = searchParams.get(key);
      if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
        try {
          return decodeURIComponent(val);
        } catch (e) {
          return val;
        }
      }
    }
  } catch (e) {}
  return rawUrl;
}

// 우클릭 컨텍스트 메뉴 클릭 이벤트 처리 (해당 URL만 즉시 1클릭 처리 + 스마트 광고/iframe/비디오/이미지 감지)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const menuItemId = info?.menuItemId;
    if (!menuItemId) return;

    let targetTab = tab;
    if (!targetTab?.id) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTab = tabs && tabs[0];
      } catch (e) {}
    }

    // 사파리 스타일 화면 요소 선택 모드 시작 요청 처리
    if (menuItemId === 'banman_pick_element') {
      if (targetTab?.id) {
        chrome.tabs.sendMessage(targetTab.id, { type: 'START_ELEMENT_PICKER' }).catch(() => {});
      }
      return;
    }

    let rawLinkUrl = (info.linkUrl || info.srcUrl || info.frameUrl || '').trim();
    if (!rawLinkUrl && lastContextMetadata?.mediaSrc) {
      rawLinkUrl = lastContextMetadata.mediaSrc.trim();
    }
    if (!rawLinkUrl && lastContextMetadata?.href) {
      rawLinkUrl = lastContextMetadata.href.trim();
    }

    const lang = await getAppLanguage();
    let action = '';
    let highlightType = 'star';

    if (menuItemId === 'banman_block') action = 'block';
    else if (menuItemId === 'banman_warn') action = 'warn';
    else if (menuItemId === 'banman_hide') action = 'hide';
    else if (menuItemId === 'banman_hl_star') { action = 'highlight'; highlightType = 'star'; }
    else if (menuItemId === 'banman_hl_pin') { action = 'highlight'; highlightType = 'pin'; }
    else if (menuItemId === 'banman_hl_custom') { action = 'highlight'; highlightType = 'custom'; }
    else if (menuItemId === 'banman_remove') action = 'remove';

    if (!action) return;

    // URL이 없는 동적 배너/요소의 '숨기기' 요청 처리 (현재 화면에서 DOM 즉시 은닉)
    if (!rawLinkUrl) {
      if (action === 'hide' && targetTab?.id) {
        chrome.tabs.sendMessage(targetTab.id, {
          type: 'APPLY_LINK_ACTION',
          action: 'hide',
          linkUrl: '',
          rawLinkUrl: '',
          target: '',
          rule: null
        }).catch(() => {});
        notifyUser(targetTab.id, t('toast_element_hidden', lang) || '[BanMan] 선택한 요소를 화면에서 숨겼습니다.', 'info');
      }
      return;
    }

    const frameUrl = (info.frameUrl || '').trim();
    const frameId = info.frameId || 0;
    const linkUrl = extractActualTargetUrl(rawLinkUrl);

    // 특수/시스템 URL 검증
    if (rawLinkUrl.startsWith('chrome://') || rawLinkUrl.startsWith('chrome-extension://') || rawLinkUrl.startsWith('about:') || rawLinkUrl.startsWith('javascript:')) {
      notifyUser(targetTab?.id, t('toast_invalid_url', lang), 'error');
      return;
    }

  const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');

  // 웹스토어 링크 감지
  const webMatch = linkUrl.match(WEBSTORE_REGEX);
  const isWebstore = !!webMatch;
  const extId = webMatch ? webMatch[1].toLowerCase() : null;

  let target = '';
  let targetType = 'url';

  if (isWebstore) {
    target = extId;
    targetType = 'webstore';
  } else {
    // 사용자의 명시적 요청: 우클릭 시에는 해당 URL만 타겟팅
    target = linkUrl;
    targetType = 'url';
  }

  // 1. 등록 해제 액션
  if (action === 'remove') {
    let removed = false;
    let removeKey = target;

    if (blacklist_rules[target]) {
      delete blacklist_rules[target];
      removed = true;
    } else {
      try {
        const parsed = new URL(linkUrl);
        const host = parsed.hostname.toLowerCase();
        if (blacklist_rules[host]) {
          delete blacklist_rules[host];
          removed = true;
          removeKey = host;
        } else if (blacklist_rules[linkUrl]) {
          delete blacklist_rules[linkUrl];
          removed = true;
          removeKey = linkUrl;
        }
      } catch (e) {}
    }

    if (removed) {
      await chrome.storage.local.set({ blacklist_rules });

      // 화면에 실시간 즉시 반영 (리프레시 불필요 + 메인 및 서브프레임 동시 전달)
      if (targetTab?.id) {
        const payload = {
          type: 'APPLY_LINK_ACTION',
          linkUrl: linkUrl,
          rawLinkUrl: rawLinkUrl,
          frameUrl: frameUrl,
          frameId: frameId,
          target: target,
          action: 'remove',
          rule: null
        };
        chrome.tabs.sendMessage(targetTab.id, payload).catch(() => {});
        if (frameId > 0) {
          chrome.tabs.sendMessage(targetTab.id, payload, { frameId }).catch(() => {});
        }
      }

      const displayRemoveKey = formatDisplayUrl(removeKey, 42);
      const msg = t('toast_removed', lang, { target: displayRemoveKey });
      notifyUser(targetTab?.id, msg, 'info');
    } else {
      const displayTarget = formatDisplayUrl(target, 42);
      notifyUser(targetTab?.id, `[BanMan] '${displayTarget}' 등록된 규칙을 찾을 수 없습니다.`, 'info');
    }
    return;
  }

  // 2. 등록/수정 액션 (block, warn, hide)
  let title = '';
  let thumbnail = '';

  if (targetType === 'webstore') {
    try {
      title = await fetchWebstoreTitleDirect(extId);
    } catch (e) {}
  } else if (lastContextMetadata && (
    lastContextMetadata.href === rawLinkUrl || lastContextMetadata.href === linkUrl ||
    lastContextMetadata.mediaSrc === rawLinkUrl || lastContextMetadata.mediaSrc === linkUrl
  )) {
    title = lastContextMetadata.title || '';
    thumbnail = lastContextMetadata.thumbnail || '';
  }

  // 썸네일이 없고 도메인이 식별 가능한 경우 고화질 파비콘 또는 미디어 주소를 자동 기본값으로 설정
  if (!thumbnail) {
    if (info.mediaType === 'image' && rawLinkUrl) {
      thumbnail = rawLinkUrl;
    } else {
      try {
        const parsed = new URL(linkUrl.startsWith('http') ? linkUrl : 'https://' + linkUrl);
        if (parsed.hostname) {
          thumbnail = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
        }
      } catch (e) {}
    }
  }

  const now = new Date();
  const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 메모는 빈 문자열로 등록하여 배지에 군더더기 문구 표시 방지
  const newRule = {
    target: target,
    type: targetType,
    action: action,
    memo: '',
    title: title || '',
    thumbnail: thumbnail || '',
    createdAt: createdAt,
    updatedAt: now.toISOString()
  };

  if (action === 'highlight') {
    newRule.highlightType = highlightType || 'star';
  }

  if (rawLinkUrl && rawLinkUrl !== target) {
    newRule.rawUrl = rawLinkUrl;
  }

  blacklist_rules[target] = newRule;
  await chrome.storage.local.set({ blacklist_rules });

  // 화면에 실시간 즉시 반영 (리프레시 불필요 + 메인 및 서브프레임 동시 전달)
  if (targetTab?.id) {
    const payload = {
      type: 'APPLY_LINK_ACTION',
      linkUrl: linkUrl,
      rawLinkUrl: rawLinkUrl,
      frameUrl: frameUrl,
      frameId: frameId,
      target: target,
      action: action,
      rule: newRule
    };
    chrome.tabs.sendMessage(targetTab.id, payload).catch(() => {});
    if (frameId > 0) {
      chrome.tabs.sendMessage(targetTab.id, payload, { frameId }).catch(() => {});
    }
  }

  let actionName = t(`stat_${action}`, lang) || action;
  if (action === 'highlight') {
    actionName = t(`hl_type_${newRule.highlightType}`, lang) || actionName;
  }
  const displayTarget = formatDisplayUrl(target, 42);
  const successMsg = t('toast_registered', lang, {
    action: actionName,
    target: displayTarget
  });

  notifyUser(targetTab?.id, successMsg, action === 'block' ? 'error' : (action === 'warn' ? 'warn' : 'success'));
  } catch (err) {
    console.error('BanMan contextMenu onClicked error:', err);
  }
});

// 확장 프로그램 설치 및 업데이트 시 컨텍스트 메뉴 초기화
chrome.runtime.onInstalled.addListener(async () => {
  const lang = await getAppLanguage();
  await setupContextMenus(lang);
});

// 브라우저 시작 시 컨텍스트 메뉴 검증
chrome.runtime.onStartup.addListener(async () => {
  const lang = await getAppLanguage();
  await setupContextMenus(lang);
});

// 언어 변경 시 컨텍스트 메뉴 즉시 갱신
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.app_lang) {
    await setupContextMenus(changes.app_lang.newValue);
  }
});

// 서비스 워커 로드 시에도 안전하게 컨텍스트 메뉴 즉시 초기화 (동시 호출 시 뮤텍스로 안전 직렬화)
setupContextMenus();
