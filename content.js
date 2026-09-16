// content.js - DOM link inspection, annotation, and blocking

(() => {
  let cachedRules = {};
  let ruleIndex = { domainMap: new Map(), webstoreMap: new Map(), urlRules: [] };
  let lastRightClickInfo = null;
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

  // 1. 규칙 로드 및 스토리지 변경 실시간 감지
  async function loadRules() {
    try {
      const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
      cachedRules = blacklist_rules;
      ruleIndex = buildRuleIndex(cachedRules);
      processAllLinks();
      processAllIframes();
      processAllVideos();
      await loadElementHideRules();
    } catch (e) {
      console.error('규칙 로드 실패:', e);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.element_hide_rules) {
        applyElementHideRules(changes.element_hide_rules.newValue || {});
      }
      if (changes.blacklist_rules) {
        cachedRules = changes.blacklist_rules.newValue || {};
        ruleIndex = buildRuleIndex(cachedRules);
        // 기존 적용 표식 및 인라인 display/컨테이너 초기화
        document.querySelectorAll('[data-cb-annotated]').forEach(el => {
          el.removeAttribute('data-cb-annotated');
          el.classList.remove('cb-link-hidden', 'cb-link-warn', 'cb-link-block', 'cb-link-highlight', 'cb-highlight-star', 'cb-highlight-pin', 'cb-highlight-custom');
          el.style.display = '';
          el.title = '';
        });
        document.querySelectorAll('.cb-container-hidden').forEach(c => {
          c.classList.remove('cb-container-hidden');
          c.removeAttribute('data-cb-hidden-for');
          c.style.display = '';
        });
        document.querySelectorAll('.cb-container-highlight').forEach(c => {
          c.classList.remove('cb-container-highlight', 'cb-highlight-star', 'cb-highlight-pin', 'cb-highlight-custom');
        });
        document.querySelectorAll('.cb-badge').forEach(b => b.remove());
        processAllLinks();
        processAllIframes();
        processAllVideos();
      }
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

    // URL 접두사/포함 매칭 (특수 규칙만 순회 + 디코딩 매칭)
    if (ruleIndex.urlRules.length > 0) {
      const hrefLower = href.toLowerCase();
      let decodedHref = '';
      try {
        decodedHref = decodeURIComponent(href).toLowerCase();
      } catch (e) {}

      for (let i = 0; i < ruleIndex.urlRules.length; i++) {
        const ruleTarget = ruleIndex.urlRules[i].target;
        if (hrefLower.includes(ruleTarget) || (decodedHref && decodedHref.includes(ruleTarget))) {
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

  // 스마트 컨테이너 감지: 링크 또는 클릭 요소를 둘러싼 독립형 광고 카드, 상품 카드, 배너 박스 식별
  function getSmartContainer(element) {
    if (!element || !element.parentElement) return null;

    const FORBIDDEN_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV']);
    let current = element.parentElement;
    let bestCandidate = null;

    // 명시적 광고 클래스/ID 패턴 (정규식)
    const AD_CLASS_REGEX = /(?:^|[\s_-])(?:ad|ads|advert|banner|sponsor|adfit|adsbygoogle|adbox|adarea|adunit|adwrap|adlayer|aside_ad|ad_section|ad_view|ad-area|ad-wrap|ad-slot)(?:[\s_-]|$)/i;

    // 최대 6단계 조상까지 탐색
    for (let depth = 0; depth < 6 && current; depth++) {
      if (FORBIDDEN_TAGS.has(current.tagName)) break;

      const cls = (current.className || '').toString();
      const id = (current.id || '').toString();
      const tagName = current.tagName.toLowerCase();

      // 1. 광고 및 스폰서 명시적 컨테이너
      const isExplicitAd = AD_CLASS_REGEX.test(cls) || AD_CLASS_REGEX.test(id) ||
                           current.hasAttribute('data-ad') || current.hasAttribute('data-ad-unit') ||
                           current.hasAttribute('data-ad-slot') || current.hasAttribute('data-ad-client') ||
                           current.hasAttribute('data-adfit') || current.classList.contains('adsbygoogle') ||
                           current.getAttribute('aria-label') === '광고' || current.getAttribute('aria-label') === 'AD';

      // 2. 카드 및 상품 단위 아이템 (li, article, .card, div.item 등)
      const isItemContainer = tagName === 'article' ||
                              (tagName === 'li' && (cls.includes('item') || cls.includes('product') || cls.includes('card') || cls.includes('unit') || cls.includes('entry'))) ||
                              (cls.includes('card') || cls.includes('product-item') || cls.includes('product_item') || cls.includes('thumb-box'));

      if (isExplicitAd) {
        // 명시적 광고는 링크 개수 상관없이 즉시 해당 컨테이너 선택
        bestCandidate = current;
        break;
      } else if (isItemContainer) {
        const distinctLinks = new Set();
        const allInnerLinks = current.querySelectorAll('a[href]');
        for (let l of allInnerLinks) {
          const clean = l.href.replace(/[?#].*$/, '');
          distinctLinks.add(clean);
        }

        // 단일 목적지 링크(썸네일+제목 등)이거나 링크가 3개 이하인 단일 품목/배너 카드일 때 선택
        if (distinctLinks.size <= 3) {
          bestCandidate = current;
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
    link.classList.remove('cb-link-hidden', 'cb-link-warn', 'cb-link-block', 'cb-link-highlight', 'cb-highlight-star', 'cb-highlight-pin', 'cb-highlight-custom');
    link.style.display = '';
    link.title = '';

    // 바로 뒤에 붙어 있는 cb-badge 요소 제거
    if (link.nextSibling && link.nextSibling.nodeType === Node.ELEMENT_NODE && link.nextSibling.classList.contains('cb-badge')) {
      link.nextSibling.remove();
    }

    // 스마트 컨테이너 복원
    const container = getSmartContainer(link);
    if (container && container !== link) {
      if (container.classList.contains('cb-container-hidden')) {
        container.classList.remove('cb-container-hidden');
        container.removeAttribute('data-cb-hidden-for');
        container.style.display = '';
      }
      if (container.classList.contains('cb-container-highlight')) {
        container.classList.remove('cb-container-highlight', 'cb-highlight-star', 'cb-highlight-pin', 'cb-highlight-custom');
      }
    }
  }

  // 단일 링크에 규칙 스타일 및 배지 적용 (스마트 컨테이너 숨김 및 강조 포함)
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
    } else if (rule.action === 'highlight') {
      let hlType = rule.highlightType || 'pin';
      if (hlType === 'star') hlType = 'heart';
      if (hlType === 'custom') hlType = 'bookmark';

      link.classList.add('cb-link-highlight', `cb-highlight-${hlType}`);

      const hasMemo = !!(rule.memo && rule.memo.trim());
      const labelText = hlType === 'pin' ? '검토' : (hlType === 'bookmark' ? '보관' : '좋아요');
      link.title = `[BanMan ${labelText}]${hasMemo ? ' ' + rule.memo.trim() : ''}`;

      // 스마트 컨테이너(카드/아이템 등)가 있을 경우 테두리 네온 강조
      const container = getSmartContainer(link);
      if (container && container !== link && container.offsetHeight < 800) {
        container.classList.add('cb-container-highlight', `cb-highlight-${hlType}`);
      }

      // 강조 뱃지 생성
      const badge = document.createElement('span');
      badge.className = `cb-badge cb-badge-highlight cb-badge-${hlType}`;
      badge.title = hasMemo ? `[BanMan ${labelText}] ${rule.memo.trim()}` : `[BanMan ${labelText}]`;

      const iconText = hlType === 'pin' ? '📌' : (hlType === 'bookmark' ? '🔖' : '❤️');
      const hlIcon = document.createElement('span');
      hlIcon.className = 'cb-highlight-icon';
      hlIcon.textContent = iconText;
      badge.appendChild(hlIcon);

      if (hasMemo) {
        badge.appendChild(document.createTextNode(` [${rule.memo.trim()}]`));
      } else {
        badge.appendChild(document.createTextNode(` [${labelText}]`));
      }

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

    // 2. 우클릭 직후 '숨김' 실행 시, 우클릭된 실제 DOM 노드(비디오, iframe, 링크 등) 및 스마트 컨테이너 즉시 은닉 (최우선 보장)
    if (action === 'hide' && lastRightClickInfo && (Date.now() - lastRightClickInfo.time < 20000)) {
      const directTarget = lastRightClickInfo.target;
      const directLink = lastRightClickInfo.link;
      const directVideo = lastRightClickInfo.video;
      const directIframe = lastRightClickInfo.iframe;

      if (directVideo && document.body.contains(directVideo)) {
        try { directVideo.pause(); } catch (e) {}
        directVideo.classList.add('cb-container-hidden');
        directVideo.style.display = 'none';
        const container = getSmartContainer(directVideo) || directVideo.closest('article, li, [class*="card"], [class*="ad"], [class*="banner"], [class*="player"], [class*="video"]');
        if (container && container !== directVideo && !['BODY', 'HTML', 'MAIN'].includes(container.tagName)) {
          container.classList.add('cb-container-hidden');
          container.style.display = 'none';
        }
      } else if (directIframe && document.body.contains(directIframe)) {
        directIframe.classList.add('cb-container-hidden');
        directIframe.style.display = 'none';
        const container = getSmartContainer(directIframe) || directIframe.closest('article, li, [class*="card"], [class*="ad"], [class*="banner"]');
        if (container && container !== directIframe && !['BODY', 'HTML', 'MAIN'].includes(container.tagName)) {
          container.classList.add('cb-container-hidden');
          container.style.display = 'none';
        }
      } else if (directLink && document.body.contains(directLink)) {
        directLink.classList.add('cb-link-hidden');
        directLink.style.display = 'none';
        const container = getSmartContainer(directLink);
        if (container && container !== directLink) {
          container.classList.add('cb-container-hidden');
          container.style.display = 'none';
        }
      } else if (directTarget && document.body.contains(directTarget)) {
        directTarget.classList.add('cb-container-hidden');
        directTarget.style.display = 'none';
        const container = getSmartContainer(directTarget) || directTarget.closest('article, li, [class*="card"], [class*="ad"], [class*="banner"], [class*="player"], [class*="video"]');
        if (container && !['BODY', 'HTML', 'MAIN'].includes(container.tagName)) {
          container.classList.add('cb-container-hidden');
          container.style.display = 'none';
        }
      }
    }

    // 2-1. 우클릭된 대상 링크가 있으면 최우선 즉시 갱신 (지연 없이 즉시 반영)
    if (lastRightClickInfo?.link && document.body.contains(lastRightClickInfo.link)) {
      clearRuleFromElement(lastRightClickInfo.link);
      if (action !== 'remove' && rule) {
        lastRightClickInfo.link.setAttribute('data-cb-annotated', 'true');
        applyRuleToElement(lastRightClickInfo.link, rule, lastRightClickInfo.link.href);
      }
    }

    // 3. iframe 프레임 내부일 때 자체 은닉 및 상위 윈도우에 은닉 메시지 전송
    if (action === 'hide' && window !== window.top) {
      document.documentElement.style.display = 'none';
      if (document.body) document.body.style.display = 'none';
      try {
        window.parent.postMessage({ type: 'BANMAN_HIDE_IFRAME' }, '*');
      } catch (e) {}
    }

    // 4. iframe 프레임 광고 실시간 제거 (우클릭이 iframe에서 발생했거나 프레임 URL이 일치할 때)
    if (action === 'hide') {
      const matchUrls = [frameUrl, rawLinkUrl, linkUrl, target].filter(Boolean);
      document.querySelectorAll('iframe').forEach(iframe => {
        let src = '';
        try {
          src = iframe.src || iframe.getAttribute('src') || '';
        } catch (e) {}
        if (!src) return;

        let isIframeHit = matchUrls.some(u => src === u || src.includes(u) || u.includes(src));
        if (!isIframeHit) {
          try {
            const decSrc = decodeURIComponent(src);
            isIframeHit = matchUrls.some(u => decSrc === u || decSrc.includes(u) || u.includes(decSrc));
          } catch (e) {}
        }

        if (isIframeHit) {
          iframe.classList.add('cb-container-hidden');
          iframe.style.display = 'none';
          const parentContainer = getSmartContainer(iframe) || iframe.parentElement;
          if (parentContainer && !['BODY', 'HTML', 'MAIN'].includes(parentContainer.tagName)) {
            const parentCls = (parentContainer.className || '').toString().toLowerCase();
            if (parentCls.includes('ad') || parentCls.includes('banner') || parentContainer.offsetHeight <= iframe.offsetHeight + 30) {
              parentContainer.classList.add('cb-container-hidden');
              parentContainer.style.display = 'none';
            }
          }
        }
      });
    }

    // 5. 현재 화면의 모든 매칭 링크 탐색 후 즉시 갱신 (인코딩된 링크 및 타겟 완벽 매칭)
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.href;
      let decHref = '';
      try { decHref = decodeURIComponent(href); } catch (e) {}

      let isMatch = (href === linkUrl || (rawLinkUrl && href === rawLinkUrl));
      if (!isMatch && decHref) {
        isMatch = (decHref === linkUrl || (rawLinkUrl && decHref === rawLinkUrl));
      }
      if (!isMatch && target) {
        if (href === target || href.includes(target) || target.includes(href) ||
            (decHref && (decHref === target || decHref.includes(target) || target.includes(decHref)))) {
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
      processAllVideos();
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

  // 4-2. 동영상 광고 검사 및 은닉 (배너 비디오 및 비디오 플레이어 광고)
  function processAllVideos() {
    if (!document.body) return;
    document.querySelectorAll('video').forEach(video => {
      let src = '';
      try {
        src = video.currentSrc || video.src || video.querySelector('source')?.src || video.getAttribute('data-src') || '';
      } catch (e) {}

      if (!src) return;

      const rule = matchLink(src);
      if (rule && rule.action === 'hide') {
        try { video.pause(); } catch (e) {}
        video.classList.add('cb-container-hidden');
        video.style.display = 'none';
        const parentContainer = getSmartContainer(video) || video.closest('article, li, [class*="card"], [class*="ad"], [class*="banner"], [class*="player"], [class*="video"]');
        if (parentContainer && !['BODY', 'HTML', 'MAIN'].includes(parentContainer.tagName)) {
          parentContainer.classList.add('cb-container-hidden');
          parentContainer.style.display = 'none';
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
      processAllVideos();
    }, 150);
  });

  // iframe 서브프레임에서 보낸 은닉 메시지 수신 (부모 창에서 iframe 요소 박스 완벽 정리)
  window.addEventListener('message', (ev) => {
    if (ev && ev.data && ev.data.type === 'BANMAN_HIDE_IFRAME') {
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          if (ifr.contentWindow === ev.source) {
            ifr.classList.add('cb-container-hidden');
            ifr.style.display = 'none';
            const parent = getSmartContainer(ifr) || ifr.parentElement;
            if (parent && !['BODY', 'HTML', 'MAIN'].includes(parent.tagName)) {
              parent.classList.add('cb-container-hidden');
              parent.style.display = 'none';
            }
          }
        } catch (e) {}
      });
    }
  });

  // 6. 우클릭 시점의 링크/동영상/광고/상품 메타데이터(타이틀, 썸네일) 및 클릭 노드 캡처
  document.addEventListener('contextmenu', (e) => {
    try {
      const target = e.target;
      const link = target.closest('a[href]');
      const video = target.closest('video') || (target.tagName === 'VIDEO' ? target : null) || target.querySelector('video') || target.parentElement?.querySelector('video');
      const iframe = target.closest('iframe') || (target.tagName === 'IFRAME' ? target : null);
      const img = (target.tagName === 'IMG') ? target : target.closest('img') || target.querySelector('img');

      let mediaSrc = '';
      if (video) {
        mediaSrc = video.currentSrc || video.src || video.querySelector('source')?.src || video.getAttribute('data-src') || '';
      } else if (iframe) {
        mediaSrc = iframe.src || iframe.getAttribute('src') || '';
      } else if (img) {
        mediaSrc = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      }

      lastRightClickInfo = {
        target: target,
        link: link,
        video: video,
        iframe: iframe,
        img: img,
        mediaSrc: mediaSrc,
        time: Date.now()
      };

      // 1) 타이틀 추출
      let title = '';
      if (link) {
        title = (link.getAttribute('title') || '').trim();
        if (!title) {
          const text = (link.textContent || '').trim();
          if (text && text.length >= 2 && text.length <= 100) {
            title = text.replace(/\s+/g, ' ');
          }
        }
      }
      if (!title && video) {
        title = (video.getAttribute('title') || video.getAttribute('aria-label') || '').trim();
        if (!title && video.parentElement) {
          const pTitle = (video.parentElement.getAttribute('title') || video.parentElement.getAttribute('aria-label') || '').trim();
          if (pTitle) title = pTitle;
        }
      }
      if (!title && iframe) {
        title = (iframe.getAttribute('title') || iframe.getAttribute('name') || '').trim();
      }
      if (!title && img && img.alt) {
        title = img.alt.trim();
      }

      // 2) 썸네일 이미지 추출
      let thumbnail = '';
      if (video && video.poster) {
        thumbnail = video.poster;
      } else if (img) {
        thumbnail = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      } else if (link) {
        let imgEl = link.querySelector('img');
        if (!imgEl) {
          const container = link.closest('[class*="ad-"], [class*="card"], [class*="item"], li, article');
          if (container) {
            imgEl = container.querySelector('img');
          }
        }
        if (imgEl) {
          thumbnail = imgEl.currentSrc || imgEl.src || imgEl.getAttribute('data-src') || '';
        }
      }

      // 3) 백그라운드로 우클릭 메타데이터 즉시 전송
      chrome.runtime.sendMessage({
        type: 'UPDATE_CONTEXT_METADATA',
        data: {
          href: link?.href || '',
          mediaSrc: mediaSrc || '',
          mediaType: video ? 'video' : (iframe ? 'iframe' : (img ? 'image' : '')),
          title: title || '',
          thumbnail: thumbnail || ''
        }
      }).catch(() => {});
    } catch (err) {}
  }, true);

  // ==========================================================================
  // Safari-style Distraction Control / Element Picker Engine
  // ==========================================================================

  let isPickerActive = false;
  let pickerHoverTarget = null;
  let pickerSelectedElement = null;
  let pickerOverlay = null;
  let pickerBadge = null;
  let pickerToolbar = null;
  let pickerUndoStack = [];
  let cachedAppLang = 'ko';

  async function getPickerLang() {
    try {
      if (typeof getAppLanguage === 'function') {
        cachedAppLang = await getAppLanguage();
      } else {
        const res = await chrome.storage.local.get('app_lang');
        if (res && res.app_lang) cachedAppLang = res.app_lang;
      }
    } catch (e) {}
    return cachedAppLang;
  }

  function tr(key, params = {}) {
    if (typeof t === 'function') {
      return t(key, cachedAppLang, params);
    }
    return key;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 1. 도메인별 영구 은닉 CSS 동적 생성 및 인젝션
  function applyElementHideRules(allRules = {}) {
    const hostname = window.location.hostname.toLowerCase();
    const activeSelectors = new Set();

    let currHost = hostname;
    while (currHost) {
      if (allRules[currHost] && Array.isArray(allRules[currHost])) {
        for (const r of allRules[currHost]) {
          if (r && r.selector) activeSelectors.add(r.selector);
        }
      }
      const dotIdx = currHost.indexOf('.');
      if (dotIdx === -1) break;
      currHost = currHost.slice(dotIdx + 1);
    }

    let styleTag = document.getElementById('bm-element-hide-styles');

    if (activeSelectors.size === 0) {
      if (styleTag) styleTag.textContent = '';
      return;
    }

    const cssText = Array.from(activeSelectors).join(',\n') + ` {
  display: none !important;
  margin: 0 !important;
  padding: 0 !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
}`;

    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'bm-element-hide-styles';
      (document.head || document.documentElement).appendChild(styleTag);
    }

    styleTag.textContent = cssText;
  }

  async function loadElementHideRules() {
    try {
      const { element_hide_rules = {} } = await chrome.storage.local.get('element_hide_rules');
      applyElementHideRules(element_hide_rules);
    } catch (e) {
      console.error('요소 숨김 규칙 로드 실패:', e);
    }
  }

  // 2. 안정적인 CSS 선택자 생성기 (무작위 해시 배제 + 시맨틱 클래스 + 계층 구조)
  function generateStableSelector(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return '';
    }

    // 1) 고유 ID 검사
    if (element.id && typeof element.id === 'string') {
      const id = element.id.trim();
      const isDynamicId = /^(:|ember|react|__)/.test(id) || /[a-f0-9]{8,}/i.test(id) || /^\d+$/.test(id);
      if (!isDynamicId) {
        const escapedId = '#' + CSS.escape(id);
        try {
          if (document.querySelectorAll(escapedId).length === 1) {
            return escapedId;
          }
        } catch (e) {}
      }
    }

    // 2) 고유 data-* 속성 검사 (광고 및 주요 위젯용)
    const candidateAttrs = ['data-ad-unit', 'data-ad-slot', 'data-ad-client', 'data-ad-area', 'data-widget-id', 'data-component', 'data-module', 'data-adfit'];
    for (const attr of candidateAttrs) {
      if (element.hasAttribute(attr)) {
        const val = element.getAttribute(attr);
        if (val) {
          const attrSelector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
          try {
            if (document.querySelectorAll(attrSelector).length === 1) {
              return attrSelector;
            }
          } catch (e) {}
        }
      }
    }

    // 3) 안정적인 클래스명 필터링 및 계층 경로 결합
    function getCleanClasses(el) {
      if (!el.className || typeof el.className !== 'string') return [];
      return el.className.split(/\s+/)
        .map(c => c.trim())
        .filter(c => {
          if (!c) return false;
          if (c.startsWith('bm-') || c.startsWith('cb-')) return false;
          if (c.length < 3) return false;
          if (/^[a-z0-9_-]{12,}$/i.test(c)) return false;
          if (/^(css|style)_[a-z0-9]+/i.test(c)) return false;
          return true;
        });
    }

    const pathParts = [];
    let curr = element;

    while (curr && curr !== document.body && curr !== document.documentElement && pathParts.length < 5) {
      let part = curr.tagName.toLowerCase();

      if (curr.id && typeof curr.id === 'string') {
        const id = curr.id.trim();
        const isDynamicId = /^(:|ember|react|__)/.test(id) || /[a-f0-9]{8,}/i.test(id) || /^\d+$/.test(id);
        if (!isDynamicId) {
          part = '#' + CSS.escape(id);
          pathParts.unshift(part);
          break;
        }
      }

      const cleanCls = getCleanClasses(curr);
      if (cleanCls.length > 0) {
        part += '.' + cleanCls.slice(0, 2).map(c => CSS.escape(c)).join('.');
      }

      if (curr.parentElement) {
        const siblings = Array.from(curr.parentElement.children).filter(ch => ch.tagName === curr.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(curr) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      pathParts.unshift(part);

      const testSelector = pathParts.join(' > ');
      try {
        if (document.querySelectorAll(testSelector).length === 1) {
          return testSelector;
        }
      } catch (e) {}

      curr = curr.parentElement;
    }

    return pathParts.join(' > ');
  }

  // 3. 사파리 시그니처 파티클 분해 소멸 애니메이션 ("Poof")
  function triggerPoofAnimation(rect) {
    if (!rect || rect.width === 0 || rect.height === 0) return;

    let canvas = document.getElementById('bm-particle-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'bm-particle-canvas';
      document.documentElement.appendChild(canvas);
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const particles = [];
    const particleCount = Math.min(60, Math.max(28, Math.round((rect.width * rect.height) / 3800)));
    const colors = ['#60a5fa', '#38bdf8', '#93c5fd', '#fde047', '#f8fafc', '#cbd5e1'];

    for (let i = 0; i < particleCount; i++) {
      const px = rect.left + Math.random() * rect.width;
      const py = rect.top + Math.random() * rect.height;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 1.5;

      particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed + (px - (rect.left + rect.width / 2)) * 0.03,
        vy: Math.sin(angle) * speed - Math.random() * 3.5 - 1.5,
        size: Math.random() * 4.5 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: Math.random() * 0.026 + 0.02,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.2
      });
    }

    function render() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;

      for (const p of particles) {
        if (p.alpha > 0) {
          alive = true;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.12;
          p.vx *= 0.98;
          p.alpha -= p.decay;
          p.rotation += p.spin;

          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (alive) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (canvas && canvas.parentNode) {
          canvas.remove();
        }
      }
    }

    render();
  }

  // 4. 요소 선택기 라이프사이클
  async function startElementPicker() {
    // 툴바 및 오버레이는 오직 최상위 메인 프레임에서만 기동 (iframe 내부 고립 및 잔여물 완벽 방지)
    if (window !== window.top) return;
    if (isPickerActive) return;
    isPickerActive = true;
    document.body?.classList.add('bm-picker-active');

    const lang = await getPickerLang();

    // 1) 오버레이 & 배지 생성
    pickerOverlay = document.createElement('div');
    pickerOverlay.className = 'bm-picker-overlay';
    pickerBadge = document.createElement('div');
    pickerBadge.className = 'bm-picker-badge';
    pickerOverlay.appendChild(pickerBadge);
    (document.body || document.documentElement).appendChild(pickerOverlay);

    // 2) 상단 플로팅 툴바 생성
    pickerToolbar = document.createElement('div');
    pickerToolbar.className = 'bm-picker-toolbar';
    pickerToolbar.innerHTML = `
      <div class="bm-picker-title-group">
        <span class="bm-picker-icon">🎯</span>
        <span class="bm-picker-title">${escapeHtml(tr('picker_bar_title'))}</span>
        <span class="bm-picker-hint">${escapeHtml(tr('picker_bar_hint'))}</span>
      </div>
      <div class="bm-picker-btn-group">
        <button type="button" class="bm-picker-btn bm-picker-btn-undo" id="bmPickerUndoBtn" disabled>
          <span>↩</span>
          <span>${escapeHtml(tr('picker_bar_undo'))}</span>
        </button>
        <button type="button" class="bm-picker-btn bm-picker-btn-done" id="bmPickerDoneBtn">
          <span>✓</span>
          <span>${escapeHtml(tr('picker_bar_done'))}</span>
        </button>
      </div>
    `;
    (document.body || document.documentElement).appendChild(pickerToolbar);

    const undoBtn = pickerToolbar.querySelector('#bmPickerUndoBtn');
    const doneBtn = pickerToolbar.querySelector('#bmPickerDoneBtn');

    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      undoLastHiddenElement();
    });

    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopElementPicker();
    });

    // 3) 이벤트 등록 (캡처 단계)
    document.addEventListener('mouseover', onPickerMouseOver, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeyDown, true);
  }

  function stopElementPicker() {
    isPickerActive = false;
    document.body?.classList.remove('bm-picker-active');

    // 1) 오버레이 & 배지 정리
    if (pickerOverlay) {
      pickerOverlay.remove();
      pickerOverlay = null;
      pickerBadge = null;
    }
    if (pickerToolbar) {
      pickerToolbar.remove();
      pickerToolbar = null;
    }

    // 2) DOM에 혹시 남아있을 수 있는 모든 선택기 관련 툴바, 배지, 오버레이, 캔버스 전수 제거
    try {
      document.querySelectorAll('.bm-picker-toolbar, .bm-picker-overlay, #bm-particle-canvas').forEach(el => el.remove());
    } catch (e) {}

    // 3) 화면에 남아있는 모든 토스트 메시지 잔여물 즉시 완전 제거
    try {
      document.querySelectorAll('.cb-toast-container').forEach(c => c.remove());
    } catch (e) {}

    document.removeEventListener('mouseover', onPickerMouseOver, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKeyDown, true);
  }

  function onPickerMouseOver(e) {
    if (!isPickerActive) return;
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.closest('.bm-picker-toolbar') || target.closest('.bm-picker-overlay') || target.id === 'bm-particle-canvas') {
      return;
    }

    const smart = getSmartContainer(target);
    pickerHoverTarget = smart || target;
    pickerSelectedElement = pickerHoverTarget;
    updatePickerOverlay(pickerSelectedElement);
  }

  function onPickerKeyDown(e) {
    if (!isPickerActive) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      stopElementPicker();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (pickerSelectedElement && pickerSelectedElement.parentElement && pickerSelectedElement.parentElement !== document.body && pickerSelectedElement.parentElement !== document.documentElement) {
        pickerSelectedElement = pickerSelectedElement.parentElement;
        updatePickerOverlay(pickerSelectedElement);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (pickerSelectedElement && pickerSelectedElement.firstElementChild) {
        pickerSelectedElement = pickerSelectedElement.firstElementChild;
        updatePickerOverlay(pickerSelectedElement);
      }
      return;
    }
  }

  function updatePickerOverlay(element) {
    if (!pickerOverlay || !element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    pickerOverlay.style.top = `${rect.top}px`;
    pickerOverlay.style.left = `${rect.left}px`;
    pickerOverlay.style.width = `${rect.width}px`;
    pickerOverlay.style.height = `${rect.height}px`;

    let tagDesc = element.tagName.toLowerCase();
    if (element.id && typeof element.id === 'string' && !/^[0-9a-f]{8,}$/i.test(element.id)) {
      tagDesc += `#${element.id.slice(0, 16)}`;
    } else if (element.classList && element.classList.length > 0) {
      const firstCls = Array.from(element.classList).find(c => !c.startsWith('bm-') && !c.startsWith('cb-'));
      if (firstCls) tagDesc += `.${firstCls.slice(0, 16)}`;
    }
    const dims = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

    if (pickerBadge) {
      pickerBadge.textContent = `${tagDesc} (${dims})`;
      if (rect.top < 36) {
        pickerBadge.classList.add('is-below');
      } else {
        pickerBadge.classList.remove('is-below');
      }
    }
  }

  async function onPickerClick(e) {
    if (!isPickerActive) return;
    if (e.target.closest('.bm-picker-toolbar')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = pickerSelectedElement || e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    const rect = target.getBoundingClientRect();

    // 1. 파티클 분해 소멸 애니메이션 발사
    triggerPoofAnimation(rect);

    // 2. 타겟 블러 축소 페이드아웃
    target.classList.add('bm-dissolving');

    if (pickerOverlay) {
      pickerOverlay.style.width = '0px';
      pickerOverlay.style.height = '0px';
    }

    // 3. 선택자 생성 및 규칙 저장
    const selector = generateStableSelector(target);
    const hostname = window.location.hostname.toLowerCase();

    const ruleId = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let tagSummary = target.tagName.toLowerCase();
    if (target.id) tagSummary += `#${target.id}`;
    else if (target.className && typeof target.className === 'string') {
      const cl = target.className.split(/\s+/).filter(c => !c.startsWith('bm-') && !c.startsWith('cb-'))[0];
      if (cl) tagSummary += `.${cl}`;
    }
    tagSummary += ` (${Math.round(rect.width)}×${Math.round(rect.height)})`;

    const newRule = {
      id: ruleId,
      selector: selector,
      summary: tagSummary,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    };

    try {
      const { element_hide_rules = {} } = await chrome.storage.local.get('element_hide_rules');
      if (!element_hide_rules[hostname]) {
        element_hide_rules[hostname] = [];
      }
      element_hide_rules[hostname].push(newRule);
      await chrome.storage.local.set({ element_hide_rules });

      pickerUndoStack.push({
        ruleId,
        selector,
        hostname,
        element: target
      });

      const undoBtn = pickerToolbar?.querySelector('#bmPickerUndoBtn');
      if (undoBtn) undoBtn.disabled = false;

      applyElementHideRules(element_hide_rules);
      showToast(tr('picker_toast_hidden'), 'success');
    } catch (err) {
      console.error('요소 숨김 규칙 저장 실패:', err);
    }

    setTimeout(() => {
      target.classList.remove('bm-dissolving');
      target.classList.add('bm-element-hidden');
      target.setAttribute('data-bm-hidden', 'true');
    }, 330);
  }

  async function undoLastHiddenElement() {
    const last = pickerUndoStack.pop();
    if (!last) {
      showToast(tr('picker_toast_no_undo'), 'info');
      return;
    }

    try {
      const { element_hide_rules = {} } = await chrome.storage.local.get('element_hide_rules');
      if (element_hide_rules[last.hostname]) {
        element_hide_rules[last.hostname] = element_hide_rules[last.hostname].filter(r => r.id !== last.ruleId);
        await chrome.storage.local.set({ element_hide_rules });
        applyElementHideRules(element_hide_rules);
      }

      if (last.element) {
        last.element.classList.remove('bm-element-hidden');
        last.element.removeAttribute('data-bm-hidden');
        last.element.style.display = '';
      }

      const undoBtn = pickerToolbar?.querySelector('#bmPickerUndoBtn');
      if (undoBtn) undoBtn.disabled = (pickerUndoStack.length === 0);

      showToast(tr('picker_toast_undone'), 'info');
    } catch (err) {
      console.error('되돌리기 실패:', err);
    }
  }

  function showToast(message, level = 'info') {
    if (window !== window.top) return;

    let container = document.querySelector('.cb-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'cb-toast-container';
      (document.body || document.documentElement).appendChild(container);
    }

    // 이전 토스트가 있으면 즉시 정리하여 화면에 메시지가 계속 쌓여 남아있지 않도록 처리
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'cb-toast';
    toast.style.cursor = 'pointer';
    toast.title = '클릭하면 즉시 닫힙니다';
    if (level === 'success') {
      toast.style.borderLeftColor = '#3b82f6';
    } else if (level === 'error') {
      toast.style.borderLeftColor = '#ef4444';
    } else {
      toast.style.borderLeftColor = '#64748b';
    }

    toast.innerHTML = `
      <div class="cb-toast-title" style="color: ${level === 'success' ? '#2563eb' : (level === 'error' ? '#dc2626' : '#334155')}">
        <span>${level === 'success' ? '🎯' : (level === 'error' ? '🚫' : 'ℹ️')}</span>
        <span>${escapeHtml(message)}</span>
      </div>
    `;

    // 클릭 시 즉시 닫기 지원
    toast.addEventListener('click', () => {
      toast.remove();
      if (container && container.children.length === 0) container.remove();
    });

    container.appendChild(toast);

    // 1.8초 후 부드럽게 자동 소멸 (화면에 오래 남지 않도록 조정)
    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        toast.remove();
        if (container && container.children.length === 0) container.remove();
      }, 250);
    }, 1800);
  }

  // 5. 런타임 메시지 수신 리스너
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_ELEMENT_PICKER') {
      if (window === window.top) {
        startElementPicker();
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'STOP_ELEMENT_PICKER') {
      stopElementPicker();
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'SHOW_TOAST') {
      if (window === window.top) {
        showToast(message.message || '', message.level || 'info');
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'APPLY_LINK_ACTION') {
      loadRules();
      sendResponse({ success: true });
      return true;
    }
  });

  // 초기 시작
  loadRules();
  loadElementHideRules();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
