// options.js - Dashboard management, search, edit, export/import

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

  let currentRules = {};
  let currentFilter = 'all';
  let searchQuery = '';

  // 1. 규칙 로드 및 통계 갱신
  async function loadData() {
    const { blacklist_rules = {} } = await chrome.storage.local.get('blacklist_rules');
    currentRules = blacklist_rules;
    render();
  }

  // 실시간 스토리지 변경 동기화
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blacklist_rules) {
      currentRules = changes.blacklist_rules.newValue || {};
      render();
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
        let typeLabel = '도메인';
        let typeClass = 'domain';
        if (rule.type === 'url') {
          typeLabel = 'URL';
          typeClass = 'url';
        } else if (rule.type === 'webstore') {
          typeLabel = '크롬 웹스토어';
          typeClass = 'webstore';
        }

        // 액션 라벨
        let actionLabel = '차단';
        let actionClass = 'block';
        if (rule.action === 'warn') {
          actionLabel = '경고 & 메모';
          actionClass = 'warn';
        } else if (rule.action === 'hide') {
          actionLabel = '링크 숨김';
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
            <span class="action-badge ${actionClass}">${actionLabel}</span>
          </td>
          <td class="memo-cell">${escapeHtml(rule.memo || '(사유 미기재)')}</td>
          <td class="date-cell">${rule.createdAt || '-'}</td>
          <td style="text-align: center;">
            <div class="action-btns">
              <button class="sm-btn edit-btn" data-key="${escapeHtml(key)}">수정</button>
              <button class="sm-btn delete delete-btn" data-key="${escapeHtml(key)}">삭제</button>
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

    // 도메인 타입인 경우 http:// 및 https://, 후행 슬래시 정규화
    if (type === 'domain') {
      try {
        if (target.includes('://')) {
          target = new URL(target).hostname.toLowerCase();
        } else {
          target = target.replace(/\/.*$/, '').toLowerCase();
        }
      } catch (err) {}
    } else if (type === 'webstore') {
      // 32자리 ID만 추출
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

  // 6. 테이블 내 수정 및 삭제 이벤트 위임
  rulesTableBody.addEventListener('click', async (e) => {
    const target = e.target;
    const key = target.getAttribute('data-key');
    if (!key) return;

    // 삭제
    if (target.classList.contains('delete-btn')) {
      if (confirm(`'${key}' 규칙을 삭제하시겠습니까?`)) {
        delete currentRules[key];
        await chrome.storage.local.set({ blacklist_rules: currentRules });
        render();
      }
      return;
    }

    // 수정 (메모 및 액션)
    if (target.classList.contains('edit-btn')) {
      const item = currentRules[key];
      if (!item) return;

      const newActionVal = prompt(`처리 액션을 선택하세요 (block / warn / hide):\n현재: ${item.action}`, item.action);
      if (newActionVal === null) return;
      if (['block', 'warn', 'hide'].includes(newActionVal.trim().toLowerCase())) {
        item.action = newActionVal.trim().toLowerCase();
      }

      const newMemoVal = prompt(`사유 메모를 수정하세요:`, item.memo || '');
      if (newMemoVal === null) return;
      item.memo = newMemoVal.trim();

      currentRules[key] = item;
      await chrome.storage.local.set({ blacklist_rules: currentRules });
      render();
    }
  });

  // 7. JSON 내보내기 (Export)
  exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentRules, null, 2));
    const downloadAnchor = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `chrome-blacklist-backup-${today}.json`);
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
          alert('올바르지 않은 JSON 파일 형식입니다.');
          return;
        }

        const isOverwrite = confirm('기존 규칙에 덮어쓰시겠습니까?\n[확인]: 기존 목록 삭제 후 덮어쓰기\n[취소]: 기존 목록 유지하며 병합(Merge)');

        if (isOverwrite) {
          currentRules = importedData;
        } else {
          currentRules = { ...currentRules, ...importedData };
        }

        await chrome.storage.local.set({ blacklist_rules: currentRules });
        alert(`총 ${Object.keys(currentRules).length}개의 규칙이 성공적으로 반영되었습니다.`);
        render();
      } catch (err) {
        alert('JSON 파일을 읽는 도중 오류가 발생했습니다: ' + err.message);
      } finally {
        importFileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // 초기 로드
  loadData();
});
