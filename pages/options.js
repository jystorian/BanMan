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

  // 1. 규칙 로드 및 통계 갱신
  async function loadData() {
    const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
    currentRules = blacklist_rules;
    render();
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

        tr.innerHTML = `
          <td>
            <div class="target-cell">
              <span class="target-name">${escapeHtml(rule.target || key)}</span>
              <span class="type-tag ${typeClass}">${typeLabel}</span>
            </div>
          </td>
          <td>
            <select class="inline-action-select ${actionClass}" data-key="${escapeHtml(key)}" title="${t('modal_action_label', currentLang)}">
              <option value="block" ${rule.action === 'block' ? 'selected' : ''}>🚫 ${t('action_block', currentLang)}</option>
              <option value="warn" ${rule.action === 'warn' ? 'selected' : ''}>⚠️ ${t('action_warn', currentLang)}</option>
              <option value="hide" ${rule.action === 'hide' ? 'selected' : ''}>👁️ ${t('action_hide', currentLang)}</option>
            </select>
          </td>
          <td class="memo-cell">${escapeHtml(rule.memo || '-')}</td>
          <td class="date-cell">${rule.createdAt || '-'}</td>
          <td style="text-align: center;">
            <div class="action-btns">
              <button class="sm-btn edit-btn" data-key="${escapeHtml(key)}">${t('btn_edit', currentLang)}</button>
              <button class="sm-btn delete delete-btn" data-key="${escapeHtml(key)}">${t('btn_delete', currentLang)}</button>
            </div>
          </td>
        `;

        rulesTableBody.appendChild(tr);
      });
    }
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
    }

    const now = new Date();
    const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    currentRules[target] = {
      target,
      type,
      action,
      memo,
      createdAt
    };

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
    modalTargetDisplay.textContent = item.target || key;
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
    const target = e.target;
    const key = target.getAttribute('data-key');
    if (!key) return;

    // 삭제
    if (target.classList.contains('delete-btn')) {
      if (confirm(t('confirm_delete', currentLang, { key }))) {
        delete currentRules[key];
        await chrome.storage.local.set({ blacklist_rules: currentRules });
        render();
      }
      return;
    }

    // 수정 (모달 열기 - 마우스 클릭으로 선택)
    if (target.classList.contains('edit-btn')) {
      openEditModal(key);
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
