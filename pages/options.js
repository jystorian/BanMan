// options.js - Dashboard management with i18n support

document.addEventListener('DOMContentLoaded', async () => {
  const totalCountEl = document.getElementById('totalCount');
  const blockCountEl = document.getElementById('blockCount');
  const warnCountEl = document.getElementById('warnCount');
  const hideCountEl = document.getElementById('hideCount');

  const addRuleForm = document.getElementById('addRuleForm');
  const newTarget = document.getElementById('newTarget');
  const newType = document.getElementById('newType');
  const newAction = document.getElementById('newAction');
  const newMemo = document.getElementById('newMemo');

  const searchInput = document.getElementById('searchInput');
  const filterTabs = document.querySelectorAll('.tab-btn');
  const rulesTableBody = document.getElementById('rulesTableBody');
  const emptyMsg = document.getElementById('emptyMsg');

  const exportBtn = document.getElementById('exportBtn');
  const importFileInput = document.getElementById('importFileInput');
  const langSelect = document.getElementById('langSelect');

  let currentRules = {};
  let currentFilter = 'all';
  let searchQuery = '';

  // 다국어 초기화
  let currentLang = await getAppLanguage();
  langSelect.value = currentLang;
  applyTranslations(currentLang);

  langSelect.addEventListener('change', async (e) => {
    currentLang = e.target.value;
    await setAppLanguage(currentLang);
    applyTranslations(currentLang);
    render();
  });

  // 웹스토어 확장 프로그램 제목 캐시 및 서비스 워커 경유 비동기 조회 (CORS 제약 없음)
  const webstoreTitleCache = {};

  async function fetchWebstoreTitle(extId) {
    if (!extId) return null;
    extId = extId.toLowerCase().trim();
    if (webstoreTitleCache[extId]) return webstoreTitleCache[extId];

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_WEBSTORE_TITLE', extId }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('FETCH_WEBSTORE_TITLE sendMessage error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        if (res && res.title) {
          webstoreTitleCache[extId] = res.title;
          resolve(res.title);
        } else {
          resolve(null);
        }
      });
    });
  }

  // 기존 등록된 웹스토어 규칙 중 제목이 없는 항목 자동 보정 (Self-healing)
  async function enrichWebstoreTitles() {
    let hasUpdates = false;
    const webstoreEntries = Object.entries(currentRules).filter(([_, r]) => {
      return r.type === 'webstore' && (!r.title || r.title === r.target);
    });

    for (const [key, rule] of webstoreEntries) {
      const extId = (rule.target || key).toLowerCase();
      const fetchedTitle = await fetchWebstoreTitle(extId);
      if (fetchedTitle && fetchedTitle !== extId) {
        currentRules[key].title = fetchedTitle;
        hasUpdates = true;

        // 테이블에 렌더링된 요소 즉시 갱신
        const nameEl = document.querySelector(`.target-name[data-ext-id="${extId}"]`);
        if (nameEl) {
          nameEl.textContent = fetchedTitle;
          const parentCell = nameEl.closest('.target-cell');
          if (parentCell && !parentCell.querySelector('.target-sub-id')) {
            const subSpan = document.createElement('span');
            subSpan.className = 'target-sub-id';
            subSpan.textContent = `ID: ${extId}`;
            const typeTag = parentCell.querySelector('.type-tag');
            if (typeTag) {
              parentCell.insertBefore(subSpan, typeTag);
            } else {
              parentCell.appendChild(subSpan);
            }
          }
        }
      }
    }

    if (hasUpdates) {
      await chrome.storage.local.set({ blacklist_rules: currentRules });
    }
  }

  // 1. 규칙 로드 및 통계 갱신
  async function loadData() {
    const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
    currentRules = blacklist_rules;
    render();
    enrichWebstoreTitles();
  }

  // 실시간 스토리지 변경 동기화
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.blacklist_rules) {
        currentRules = changes.blacklist_rules.newValue || {};
        render();
      }
      if (changes.app_lang) {
        currentLang = changes.app_lang.newValue || 'ko';
        langSelect.value = currentLang;
        applyTranslations(currentLang);
        render();
      }
    }
  });

  // 2. 화면 렌더링 함수
  function render() {
    const entries = Object.entries(currentRules);

    // 통계 계산
    let total = entries.length;
    let block = 0;
    let warn = 0;
    let hide = 0;

    entries.forEach(([_, rule]) => {
      if (rule.action === 'block') block++;
      else if (rule.action === 'warn') warn++;
      else if (rule.action === 'hide') hide++;
    });

    totalCountEl.textContent = total;
    blockCountEl.textContent = block;
    warnCountEl.textContent = warn;
    hideCountEl.textContent = hide;

    // 필터링 및 검색 적용
    const filtered = entries.filter(([key, rule]) => {
      const matchAction = currentFilter === 'all' || rule.action === currentFilter;
      const targetText = (rule.target || key).toLowerCase();
      const memoText = (rule.memo || '').toLowerCase();
      const q = searchQuery.toLowerCase();
      const matchSearch = !q || targetText.includes(q) || memoText.includes(q);
      return matchAction && matchSearch;
    });

    // 최신 등록순 정렬
    filtered.sort((a, b) => {
      const dateA = a[1].createdAt || '';
      const dateB = b[1].createdAt || '';
      return dateB.localeCompare(dateA);
    });

    // 테이블 렌더링
    rulesTableBody.innerHTML = '';

    if (filtered.length === 0) {
      emptyMsg.style.display = 'block';
    } else {
      emptyMsg.style.display = 'none';

      filtered.forEach(([key, rule]) => {
        const tr = document.createElement('tr');

        // 타입 라벨 및 스타일
        let typeLabel = t('type_domain', currentLang);
        let typeClass = 'domain';
        if (rule.type === 'url') {
          typeLabel = t('type_url', currentLang);
          typeClass = 'url';
        } else if (rule.type === 'webstore') {
          typeLabel = t('type_webstore', currentLang);
          typeClass = 'webstore';
        }

        // 액션 라벨
        let actionLabel = t('action_block', currentLang);
        let actionClass = 'block';
        if (rule.action === 'warn') {
          actionLabel = t('action_warn', currentLang);
          actionClass = 'warn';
        } else if (rule.action === 'hide') {
          actionLabel = t('action_hide', currentLang);
          actionClass = 'hide';
        }

        // 대상 명칭 및 링크 처리 (웹스토어 및 일반 웹페이지/도메인)
        let targetHtml = '';
        if (rule.type === 'webstore') {
          const extId = (rule.target || key).toLowerCase();
          const hasTitle = rule.title && rule.title !== extId;
          const displayName = hasTitle ? rule.title : extId;
          const webstoreUrl = `https://chromewebstore.google.com/detail/${encodeURIComponent(extId)}`;
          // 제목이 있는 경우에만 하단에 ID를 보조로 표시하여, 제목 부재 시 위아래 ID 중복 방지
          const subIdHtml = hasTitle
            ? `<span class="target-sub-id">ID: ${escapeHtml(extId)}</span>`
            : '';
          const webstoreTitle = currentLang === 'ko' ? '크롬 웹스토어 열기' : (currentLang === 'ja' ? 'Chrome ウェブストアを開く' : 'Open Chrome Web Store');

          targetHtml = `
            <div class="target-cell">
              <div class="target-title-row">
                <span class="target-name" data-ext-id="${escapeHtml(extId)}">${escapeHtml(displayName)}</span>
                <a href="${webstoreUrl}" target="_blank" rel="noopener noreferrer" class="target-ext-link webstore-ext-link" title="${webstoreTitle}">🔗</a>
              </div>
              ${subIdHtml}
              <span class="type-tag ${typeClass}">${typeLabel}</span>
            </div>
          `;
        } else {
          const targetStr = (rule.target || key).trim();
          let linkUrl = targetStr;
          if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) {
            linkUrl = 'https://' + linkUrl;
          }
          const linkTitle = currentLang === 'ko' ? '새 탭에서 사이트 열기' : (currentLang === 'ja' ? '新しいタブで開く' : 'Open in new tab');

          targetHtml = `
            <div class="target-cell">
              <div class="target-title-row">
                <span class="target-name">${escapeHtml(targetStr)}</span>
                <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="target-ext-link" title="${linkTitle}">🔗</a>
              </div>
              <span class="type-tag ${typeClass}">${typeLabel}</span>
            </div>
          `;
        }

        tr.innerHTML = `
          <td>
            ${targetHtml}
          </td>
          <td>
            <select class="inline-action-select ${actionClass}" data-key="${escapeHtml(key)}" title="${t('modal_action_label', currentLang)}">
              <option value="block" ${rule.action === 'block' ? 'selected' : ''}>🚫 ${t('action_block', currentLang)}</option>
              <option value="warn" ${rule.action === 'warn' ? 'selected' : ''}>⚠️ ${t('action_warn', currentLang)}</option>
              <option value="hide" ${rule.action === 'hide' ? 'selected' : ''}>🙈 ${t('action_hide', currentLang)}</option>
            </select>
          </td>
          <td class="memo-cell">${escapeHtml(rule.memo || '-')}</td>
          <td class="date-cell">${formatDateStacked(rule.createdAt)}</td>
          <td class="col-manage">
            <div class="action-btns">
              <button class="sm-btn edit-btn" data-key="${escapeHtml(key)}" title="${t('btn_edit', currentLang)}">${t('btn_edit', currentLang)}</button>
              <button class="sm-btn icon-delete-btn delete-btn" data-key="${escapeHtml(key)}" title="${t('btn_delete', currentLang)}" aria-label="${t('btn_delete', currentLang)}">✕</button>
            </div>
          </td>
        `;

        rulesTableBody.appendChild(tr);
      });
    }
  }

  // 날짜/시간 2줄 분리 포맷 함수 (테이블 가로폭 절약)
  function formatDateStacked(dateStr) {
    if (!dateStr || dateStr === '-') return '-';
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `<div class="date-stacked"><span class="date-d">${escapeHtml(parts[0])}</span><span class="date-t">${escapeHtml(parts[1])}</span></div>`;
    }
    return escapeHtml(dateStr);
  }

  function escapeHtml(text) {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 3. 탭 필터 클릭 이벤트
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.getAttribute('data-filter');
      render();
    });
  });

  // 4. 검색창 이벤트
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    render();
  });

  // 5. 새 규칙 수동 추가
  addRuleForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let target = newTarget.value.trim();
    const type = newType.value;
    const action = newAction.value;
    const memo = newMemo.value.trim();

    if (!target) return;

    let webstoreTitle = '';
    if (type === 'domain') {
      try {
        if (target.includes('://')) {
          target = new URL(target).hostname.toLowerCase();
        } else {
          target = target.replace(/\/.*$/, '').toLowerCase();
        }
      } catch (err) {}
    } else if (type === 'webstore') {
      const match = target.match(/([a-p]{32})/i);
      if (match) target = match[1].toLowerCase();
      // 등록 시 즉시 웹스토어 제목 fetch 시도
      webstoreTitle = await fetchWebstoreTitle(target) || '';
    }

    const now = new Date();
    const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const ruleObj = {
      target,
      type,
      action,
      memo,
      createdAt
    };

    if (type === 'webstore' && webstoreTitle) {
      ruleObj.title = webstoreTitle;
    }

    currentRules[target] = ruleObj;

    await chrome.storage.local.set({ blacklist_rules: currentRules });

    newTarget.value = '';
    newMemo.value = '';
    render();
  });

  // 6. 테이블 내 인라인 액션 변경 (원클릭 마우스 선택)
  rulesTableBody.addEventListener('change', async (e) => {
    if (e.target.classList.contains('inline-action-select')) {
      const select = e.target;
      const key = select.getAttribute('data-key');
      const newAction = select.value;
      if (key && currentRules[key]) {
        currentRules[key].action = newAction;
        await chrome.storage.local.set({ blacklist_rules: currentRules });
        render();
      }
    }
  });

  // 7. 모달 대화상자 요소 및 함수
  let editingKey = null;
  const editModal = document.getElementById('editModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  const modalTargetDisplay = document.getElementById('modalTargetDisplay');
  const modalMemoInput = document.getElementById('modalMemoInput');

  function openEditModal(key) {
    const item = currentRules[key];
    if (!item) return;

    editingKey = key;
    if (item.type === 'webstore' && item.title) {
      modalTargetDisplay.textContent = `${item.title} (${item.target || key})`;
    } else {
      modalTargetDisplay.textContent = item.target || key;
    }
    modalMemoInput.value = item.memo || '';

    const actionRadio = document.querySelector(`input[name="modalAction"][value="${item.action}"]`);
    if (actionRadio) actionRadio.checked = true;

    editModal.style.display = 'flex';
    modalMemoInput.focus();
  }

  function closeEditModal() {
    editModal.style.display = 'none';
    editingKey = null;
  }

  modalCloseBtn.addEventListener('click', closeEditModal);
  modalCancelBtn.addEventListener('click', closeEditModal);

  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editModal.style.display === 'flex') {
      closeEditModal();
    }
  });

  modalSaveBtn.addEventListener('click', async () => {
    if (!editingKey || !currentRules[editingKey]) return;

    const selectedAction = document.querySelector('input[name="modalAction"]:checked')?.value || 'block';
    const newMemo = modalMemoInput.value.trim();

    currentRules[editingKey].action = selectedAction;
    currentRules[editingKey].memo = newMemo;

    await chrome.storage.local.set({ blacklist_rules: currentRules });
    closeEditModal();
    render();
  });

  // 8. 테이블 내 수정(모달 열기) 및 삭제 이벤트 위임
  rulesTableBody.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.delete-btn');
    if (delBtn) {
      const key = delBtn.getAttribute('data-key');
      if (key && confirm(t('confirm_delete', currentLang, { key }))) {
        delete currentRules[key];
        await chrome.storage.local.set({ blacklist_rules: currentRules });
        render();
      }
      return;
    }

    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
      const key = editBtn.getAttribute('data-key');
      if (key) {
        openEditModal(key);
      }
    }
  });

  // 7. JSON 내보내기 (Export)
  exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentRules, null, 2));
    const downloadAnchor = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `banman-rules-backup-${today}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // 8. JSON 가져오기 (Import)
  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (typeof importedData !== 'object' || importedData === null) {
          alert(t('import_invalid_json', currentLang));
          return;
        }

        const isOverwrite = confirm(t('import_confirm', currentLang));

        if (isOverwrite) {
          currentRules = importedData;
        } else {
          currentRules = { ...currentRules, ...importedData };
        }

        await chrome.storage.local.set({ blacklist_rules: currentRules });
        alert(t('import_success', currentLang, { count: Object.keys(currentRules).length }));
        render();
      } catch (err) {
        alert(t('import_error', currentLang, { error: err.message }));
      } finally {
        importFileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // 초기 로드
  loadData();
});
