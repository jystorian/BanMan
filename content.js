// content.js - DOM link inspection, annotation, and blocking

(() => {
  let cachedRules = {};
  const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

  // 1. 규칙 로드 및 스토리지 변경 실시간 감지
  async function loadRules() {
    try {
      const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
      cachedRules = blacklist_rules;
      processAllLinks();
    } catch (e) {
      console.error('규칙 로드 실패:', e);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blacklist_rules) {
      cachedRules = changes.blacklist_rules.newValue || {};
      // 기존 적용 표식을 초기화하고 다시 적용
      document.querySelectorAll('[data-cb-annotated]').forEach(el => {
        el.removeAttribute('data-cb-annotated');
        el.classList.remove('cb-link-hidden', 'cb-link-warn', 'cb-link-block');
      });
      document.querySelectorAll('.cb-badge').forEach(b => b.remove());
      processAllLinks();
    }
  });

  // 2. URL 매칭 로직
  function matchLink(href) {
    if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) {
      return null;
    }

    // 웹스토어 링크 감지
    const webMatch = href.match(WEBSTORE_REGEX);
    if (webMatch) {
      const extId = webMatch[1].toLowerCase();
      if (cachedRules[extId]) return cachedRules[extId];
    }

    let parsed;
    try {
      parsed = new URL(href, window.location.origin);
    } catch (e) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const hrefLower = href.toLowerCase();

    for (const [key, rule] of Object.entries(cachedRules)) {
      const target = (rule.target || key).toLowerCase().trim();
      if (!target) continue;

      if (rule.type === 'webstore') continue;

      if (rule.type === 'domain') {
        if (hostname === target || hostname.endsWith('.' + target)) {
          return rule;
        }
      } else {
        if (hrefLower.includes(target)) {
          return rule;
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
    const cowlUrl = chrome.runtime.getURL('resources/cowl_front.png');
    toast.innerHTML = `
      <div class="cb-toast-title">
        <img src="${cowlUrl}" style="width:18px;height:18px;image-rendering:pixelated;vertical-align:middle;margin-right:6px;">
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

        if (rule.action === 'hide') {
          link.classList.add('cb-link-hidden');
          link.style.display = 'none';
        } else if (rule.action === 'warn') {
          link.classList.add('cb-link-warn');
          const memoText = rule.memo ? ` [${rule.memo}]` : ' [주의 대상]';
          link.title = `[BanMan 경고] ${rule.memo || ''}`;

          const badge = document.createElement('span');
          badge.className = 'cb-badge cb-badge-warn';
          badge.title = `[BanMan 등록 사유] ${rule.memo || '미기재'}`;

          const flagImg = document.createElement('img');
          flagImg.src = chrome.runtime.getURL('resources/warning_flag.png');
          flagImg.className = 'cb-flag-icon';
          flagImg.alt = 'FLAG';

          badge.appendChild(flagImg);
          badge.appendChild(document.createTextNode(memoText));

          // 링크 바로 뒤에 배지 삽입
          if (link.nextSibling) {
            link.parentNode.insertBefore(badge, link.nextSibling);
          } else {
            link.parentNode.appendChild(badge);
          }
        } else if (rule.action === 'block') {
          link.classList.add('cb-link-block');
          link.title = `[BanMan 차단] ${rule.memo || ''}`;

          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showBlockedToast(rule, href);
          }, true);

          const badge = document.createElement('span');
          badge.className = 'cb-badge cb-badge-block';
          badge.title = `[BanMan 차단 사유] ${rule.memo || '미기재'}`;

          const cowlImg = document.createElement('img');
          cowlImg.src = chrome.runtime.getURL('resources/cowl_front.png');
          cowlImg.className = 'cb-cowl-icon';
          cowlImg.alt = 'BAN';

          badge.appendChild(cowlImg);
          badge.appendChild(document.createTextNode(rule.memo ? ` [차단: ${rule.memo}]` : ' [차단]'));

          if (link.nextSibling) {
            link.parentNode.insertBefore(badge, link.nextSibling);
          } else {
            link.parentNode.appendChild(badge);
          }
        }
      }

      index = end;
      if (index < links.length) {
        requestAnimationFrame(processBatch);
      }
    }

    processBatch();
  }

  // 5. 동적 렌더링(무한 스크롤, SPA 등) 대응 디바운스 옵저버
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processAllLinks();
    }, 150);
  });

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
