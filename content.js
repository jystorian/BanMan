// content.js - DOM link inspection, annotation, and blocking

(() => {
  let cachedRules = {};
  let ruleIndex = { domainMap: new Map(), webstoreMap: new Map(), urlRules: [] };
  const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

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
      }
    }

    return { domainMap, webstoreMap, urlRules };
  }

  // 1. 규칙 로드 및 스토리지 변경 실시간 감지
  async function loadRules() {
    try {
      const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
      cachedRules = blacklist_rules;
      ruleIndex = buildRuleIndex(cachedRules);
      processAllLinks();
      processAllIframes();
    } catch (e) {
      console.error('규칙 로드 실패:', e);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blacklist_rules) {
      cachedRules = changes.blacklist_rules.newValue || {};
      ruleIndex = buildRuleIndex(cachedRules);
      // 기존 적용 표식 및 인라인 display/컨테이너 초기화
      document.querySelectorAll('[data-cb-annotated]').forEach(el => {
        el.removeAttribute('data-cb-annotated');
        el.classList.remove('cb-link-hidden', 'cb-link-warn', 'cb-link-block');
        el.style.display = '';
        el.title = '';
      });
      document.querySelectorAll('.cb-container-hidden').forEach(c => {
        c.classList.remove('cb-container-hidden');
        c.removeAttribute('data-cb-hidden-for');
        c.style.display = '';
      });
      document.querySelectorAll('.cb-badge').forEach(b => b.remove());
      processAllLinks();
      processAllIframes();
    }
  });

  // 2. URL 매칭 로직 (O(1) 인덱스 조회)
  function matchLink(href) {
    if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) {
      return null;
    }

    // 웹스토어 링크 감지 (O(1))
    const webMatch = href.match(WEBSTORE_REGEX);
    if (webMatch) {
      const extId = webMatch[1].toLowerCase();
      if (ruleIndex.webstoreMap.has(extId)) return ruleIndex.webstoreMap.get(extId);
      if (cachedRules[extId]) return cachedRules[extId];
    }

    let parsed;
    try {
      parsed = new URL(href, window.location.origin);
    } catch (e) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();

    // 도메인 매칭 (O(1) 정확 매칭 및 서브도메인 계층 검사)
    let currentHost = hostname;
    while (currentHost) {
      if (ruleIndex.domainMap.has(currentHost)) {
        return ruleIndex.domainMap.get(currentHost);
      }
      const dotIndex = currentHost.indexOf('.');
      if (dotIndex === -1) break;
      currentHost = currentHost.slice(dotIndex + 1);
    }

    // URL 접두사/포함 매칭 (특수 규칙만 순회)
    if (ruleIndex.urlRules.length > 0) {
      const hrefLower = href.toLowerCase();
      for (let i = 0; i < ruleIndex.urlRules.length; i++) {
        if (hrefLower.includes(ruleIndex.urlRules[i].target)) {
          return ruleIndex.urlRules[i].rule;
        }
      }
    }

    return null;
  }

  // 3. 차단 토스트 표시
  function showBlockedToast(rule, targetUrl) {
    let container = document.querySelector('.cb-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'cb-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'cb-toast';
    const iconUrl = chrome.runtime.getURL('icons/face-b-badge-48.png');
    toast.innerHTML = `
      <div class="cb-toast-title">
        <img src="${iconUrl}" style="width:18px;height:18px;image-rendering:pixelated;vertical-align:middle;margin-right:6px;">
        BanMan: 차단된 링크 접근 제한
      </div>
      <div class="cb-toast-memo"><strong>사유:</strong> ${rule.memo || '사유 미기재'}</div>
      <div style="font-size: 11px; color: #888; margin-top: 4px;">대상: ${rule.target}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // 3-1. 컨텍스트 메뉴 액션 알림 토스트 (우클릭 차단/주의/숨김/해제 결과)
  function showActionToast(message, level = 'success') {
    // 서브프레임(iframe)에서는 중복 토스트 팝업 방지 (최상위 창에서만 표시)
    if (window !== window.top) return;

    let container = document.querySelector('.cb-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'cb-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'cb-toast';
    const iconUrl = chrome.runtime.getURL('icons/face-b-badge-48.png');
    const borderColor = level === 'error' ? '#ef4444' : (level === 'warn' ? '#f59e0b' : '#3b82f6');
    toast.style.borderLeft = `5px solid ${borderColor}`;

    const titleEl = document.createElement('div');
    titleEl.className = 'cb-toast-title';
    titleEl.style.color = '#0f172a';
    titleEl.innerHTML = `
      <img src="${iconUrl}" style="width:18px;height:18px;image-rendering:pixelated;vertical-align:middle;margin-right:6px;border-radius:3px;">
      BanMan - Chrome City Protector
    `;

    const msgEl = document.createElement('div');
    msgEl.className = 'cb-toast-memo';
    msgEl.style.color = '#1e293b';
    msgEl.style.fontWeight = '600';
    msgEl.textContent = message;

    toast.appendChild(titleEl);
    toast.appendChild(msgEl);
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) container.remove();
      }, 300);
    }, 3200);
  }

  // 스마트 컨테이너 감지: 링크를 둘러싼 독립형 광고 카드, 상품 카드, 배너 박스 식별
  function getSmartContainer(link) {
    if (!link || !link.parentElement) return null;

    const FORBIDDEN_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION']);
    let current = link.parentElement;
    let bestCandidate = null;

    // 최대 5단계 조상까지 탐색
    for (let depth = 0; depth < 5 && current; depth++) {
      if (FORBIDDEN_TAGS.has(current.tagName)) break;

      const cls = (current.className || '').toString().toLowerCase();
      const id = (current.id || '').toString().toLowerCase();
      const tagName = current.tagName.toLowerCase();

      // 1. 광고 및 스폰서 명시적 컨테이너
      const isExplicitAd = cls.includes('ad-') || cls.includes('ad_') || cls.includes('ads-') ||
                           cls.includes('ads_') || cls.includes('banner') || cls.includes('sponsor') ||
                           cls.includes('advert') || id.includes('ad-') || id.includes('banner') ||
                           id.includes('sponsor') || id.includes('advert');

      // 2. 카드 및 상품 단위 아이템 (li, article, .card, div.item 등)
      const isItemContainer = tagName === 'article' ||
                              (tagName === 'li' && (cls.includes('item') || cls.includes('product') || cls.includes('card') || cls.includes('unit') || cls.includes('entry'))) ||
                              (cls.includes('card') || cls.includes('product-item') || cls.includes('product_item') || cls.includes('thumb-box'));

      if (isExplicitAd || isItemContainer) {
        const distinctLinks = new Set();
        const allInnerLinks = current.querySelectorAll('a[href]');
        for (let l of allInnerLinks) {
          const clean = l.href.replace(/[?#].*$/, '');
          distinctLinks.add(clean);
        }

        // 단일 목적지 링크(썸네일+제목 등)이거나 링크가 2개 이하인 단일 품목/배너 카드일 때만 선택
        if (distinctLinks.size <= 2) {
          bestCandidate = current;
          if (isExplicitAd) break;
        }
      }

      current = current.parentElement;
    }

    return bestCandidate;
  }

  // 단일 링크의 규칙 표식 및 배지 초기화
  function clearRuleFromElement(link) {
    if (!link) return;
    link.removeAttribute('data-cb-annotated');
    link.classList.remove('cb-link-hidden', 'cb-link-warn', 'cb-link-block');
    link.style.display = '';
    link.title = '';

    // 바로 뒤에 붙어 있는 cb-badge 요소 제거
    if (link.nextSibling && link.nextSibling.nodeType === Node.ELEMENT_NODE && link.nextSibling.classList.contains('cb-badge')) {
      link.nextSibling.remove();
    }

    // 스마트 컨테이너 복원
    const container = getSmartContainer(link);
    if (container && container !== link && container.classList.contains('cb-container-hidden')) {
      container.classList.remove('cb-container-hidden');
      container.removeAttribute('data-cb-hidden-for');
      container.style.display = '';
    }
  }

  // 단일 링크에 규칙 스타일 및 배지 적용 (스마트 컨테이너 숨김 포함)
  function applyRuleToElement(link, rule, href) {
    if (!link || !rule) return;

    if (rule.action === 'hide') {
      link.classList.add('cb-link-hidden');
      link.style.display = 'none';

      // 스마트 컨테이너 동시 숨김 (카드, 배너 박스 잔여 공간 제거)
      const container = getSmartContainer(link);
      if (container && container !== link) {
        container.classList.add('cb-container-hidden');
        container.setAttribute('data-cb-hidden-for', href || link.href);
      }
    } else if (rule.action === 'warn') {
      link.classList.add('cb-link-warn');
      const hasMemo = !!(rule.memo && rule.memo.trim());
      link.title = `[BanMan 주의]${hasMemo ? ' ' + rule.memo.trim() : ''}`;

      const badge = document.createElement('span');
      badge.className = 'cb-badge cb-badge-warn';
      badge.title = hasMemo ? `[BanMan 주의 사유] ${rule.memo.trim()}` : '[BanMan 주의 대상]';

      const flagIcon = document.createElement('span');
      flagIcon.className = 'cb-flag-icon';
      flagIcon.textContent = '🚩';
      badge.appendChild(flagIcon);

      if (hasMemo) {
        badge.appendChild(document.createTextNode(` [${rule.memo.trim()}]`));
      }

      if (link.nextSibling) {
        link.parentNode.insertBefore(badge, link.nextSibling);
      } else {
        link.parentNode.appendChild(badge);
      }
    } else if (rule.action === 'block') {
      link.classList.add('cb-link-block');
      const hasMemo = !!(rule.memo && rule.memo.trim());
      link.title = `[BanMan 차단]${hasMemo ? ' ' + rule.memo.trim() : ''}`;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showBlockedToast(rule, href || link.href);
      }, true);

      const badge = document.createElement('span');
      badge.className = 'cb-badge cb-badge-block';
      badge.title = hasMemo ? `[BanMan 차단 사유] ${rule.memo.trim()}` : '[BanMan 차단 대상]';

      const cowlImg = document.createElement('img');
      cowlImg.src = chrome.runtime.getURL('icons/icon-16.png');
      cowlImg.className = 'cb-cowl-icon';
      cowlImg.alt = 'BAN';

      badge.appendChild(cowlImg);
      const blockMemo = hasMemo ? ` [차단: ${rule.memo.trim()}]` : ' [차단]';
      badge.appendChild(document.createTextNode(blockMemo));

      if (link.nextSibling) {
        link.parentNode.insertBefore(badge, link.nextSibling);
      } else {
        link.parentNode.appendChild(badge);
      }
    }
  }

  // 우클릭 메뉴 동작 시 해당 링크 실시간 즉시 조치 (페이지 리프레시 불필요 + iframe 프레임 광고 실시간 제거)
  function applyDirectLinkAction(linkUrl, target, action, rule, frameUrl, rawLinkUrl) {
    if (!document.body) return;

    // 1. 메모리 캐시 및 검색 인덱스 즉시 동기화
    if (action === 'remove') {
      if (target && cachedRules[target]) delete cachedRules[target];
      if (linkUrl && cachedRules[linkUrl]) delete cachedRules[linkUrl];
      if (rawLinkUrl && cachedRules[rawLinkUrl]) delete cachedRules[rawLinkUrl];
    } else if (rule && target) {
      cachedRules[target] = rule;
    }
    ruleIndex = buildRuleIndex(cachedRules);

    // 2. iframe 프레임 광고 실시간 제거 (우클릭이 iframe에서 발생했거나 프레임 URL이 일치할 때)
    if (action === 'hide') {
      const matchUrls = [frameUrl, rawLinkUrl, linkUrl, target].filter(Boolean);
      document.querySelectorAll('iframe').forEach(iframe => {
        let src = '';
        try {
          src = iframe.src || iframe.getAttribute('src') || '';
        } catch (e) {}
        if (!src) return;

        const isIframeHit = matchUrls.some(u => src === u || src.includes(u) || u.includes(src));
        if (isIframeHit) {
          iframe.classList.add('cb-container-hidden');
          if (iframe.parentElement && !['BODY', 'HTML', 'MAIN'].includes(iframe.parentElement.tagName)) {
            const parentCls = (iframe.parentElement.className || '').toString().toLowerCase();
            if (parentCls.includes('ad') || parentCls.includes('banner') || iframe.parentElement.offsetHeight <= iframe.offsetHeight + 30) {
              iframe.parentElement.classList.add('cb-container-hidden');
            }
          }
        }
      });
    }

    // 3. 현재 화면의 모든 매칭 링크 탐색 후 1ms 내 즉시 갱신
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.href;
      let isMatch = (href === linkUrl || (rawLinkUrl && href === rawLinkUrl));
      if (!isMatch && target) {
        if (href === target || href.includes(target) || target.includes(href)) {
          isMatch = true;
        }
      }
      if (!isMatch && rule) {
        const testRule = matchLink(href);
        if (testRule && (testRule.target === target || testRule.target === linkUrl || (rawLinkUrl && testRule.target === rawLinkUrl))) {
          isMatch = true;
        }
      }

      if (isMatch) {
        clearRuleFromElement(link);
        if (action !== 'remove' && rule) {
          link.setAttribute('data-cb-annotated', 'true');
          applyRuleToElement(link, rule, href);
        }
      }
    });

    if (action === 'hide') {
      processAllIframes();
    }
  }

  // 백그라운드 메시지 수신 (SHOW_TOAST 및 실시간 APPLY_LINK_ACTION)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'SHOW_TOAST') {
      showActionToast(msg.message, msg.level);
      sendResponse({ received: true });
    } else if (msg.type === 'APPLY_LINK_ACTION') {
      applyDirectLinkAction(msg.linkUrl, msg.target, msg.action, msg.rule, msg.frameUrl, msg.rawLinkUrl);
      sendResponse({ received: true, applied: true });
    }
  });

  // 4. 링크 검사 및 DOM 조작
  function processAllLinks() {
    if (!document.body) return;
    const links = document.querySelectorAll('a[href]:not([data-cb-annotated])');
    if (links.length === 0) return;

    // 배치 처리로 브라우저 메인 스레드 부담 최소화
    const BATCH_SIZE = 40;
    let index = 0;

    function processBatch() {
      const end = Math.min(index + BATCH_SIZE, links.length);
      for (let i = index; i < end; i++) {
        const link = links[i];
        link.setAttribute('data-cb-annotated', 'true');
        const href = link.href;
        const rule = matchLink(href);

        if (!rule) continue;
        applyRuleToElement(link, rule, href);
      }

      index = end;
      if (index < links.length) {
        requestAnimationFrame(processBatch);
      }
    }

    processBatch();
  }

  // 4-1. iframe 광고 및 프레임 검사/제거
  function processAllIframes() {
    if (!document.body) return;
    document.querySelectorAll('iframe').forEach(iframe => {
      let src = '';
      try {
        src = iframe.src || iframe.getAttribute('src') || '';
      } catch (e) {}

      if (!src) return;

      const rule = matchLink(src);
      if (rule && rule.action === 'hide') {
        iframe.classList.add('cb-container-hidden');
        if (iframe.parentElement && !['BODY', 'HTML', 'MAIN'].includes(iframe.parentElement.tagName)) {
          const parentCls = (iframe.parentElement.className || '').toString().toLowerCase();
          if (parentCls.includes('ad') || parentCls.includes('banner') || iframe.parentElement.offsetHeight <= iframe.offsetHeight + 30) {
            iframe.parentElement.classList.add('cb-container-hidden');
          }
        }
      }
    });
  }

  // 5. 동적 렌더링(무한 스크롤, SPA 등) 대응 디바운스 옵저버
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processAllLinks();
      processAllIframes();
    }, 150);
  });

  // 6. 우클릭 시점의 링크/상품 메타데이터(타이틀, 썸네일 이미지) 캡처
  document.addEventListener('contextmenu', (e) => {
    try {
      const link = e.target.closest('a[href]');
      if (!link) return;

      // 1) 타이틀 추출
      let title = (link.getAttribute('title') || '').trim();
      if (!title) {
        const text = (link.textContent || '').trim();
        if (text && text.length >= 2 && text.length <= 100) {
          title = text.replace(/\s+/g, ' ');
        }
      }

      // 2) 썸네일 이미지 추출
      let thumbnail = '';
      let imgEl = (e.target.tagName === 'IMG') ? e.target : link.querySelector('img');
      if (!imgEl) {
        const container = link.closest('[class*="ad-"], [class*="card"], [class*="item"], li, article');
        if (container) {
          imgEl = container.querySelector('img');
        }
      }

      if (imgEl) {
        thumbnail = imgEl.currentSrc || imgEl.src || imgEl.getAttribute('data-src') || '';
        if (!title && imgEl.alt) {
          title = imgEl.alt.trim();
        }
      }

      // 3) 백그라운드로 우클릭 메타데이터 즉시 전송
      chrome.runtime.sendMessage({
        type: 'UPDATE_CONTEXT_METADATA',
        data: {
          href: link.href,
          title: title || '',
          thumbnail: thumbnail || ''
        }
      }).catch(() => {});
    } catch (err) {}
  }, true);

  // 초기 시작
  loadRules();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
