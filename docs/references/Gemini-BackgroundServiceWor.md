# you asked

message time: 2026-09-08 10:46:24

Background Service Worker 기반의 전용 경량 확장 (API 차이 활용) 방식을 따라할수 있게 설명해줘

---

# gemini response

크롬 웹스토어(`chromewebstore.google.com`)는 보안 정책상 웹페이지 내부 DOM을 조작하는 Content Script가 원천 차단됩니다. 하지만 **Background Service Worker**는 페이지 내부가 아닌 **브라우저 자체의 프로세스**에서 실행되므로, `chrome.tabs` API를 통해 현재 열린 탭의 URL을 정상적으로 추적할 수 있습니다.

이를 활용해 **웹스토어 진입 감지 → 확장 ID 추출 → 로컬 DB 대조 → 툴바 아이콘에 'BAD' 배지 표시 및 알림**을 수행하는 순수 로컬 확장 프로그램(Manifest V3) 제작 절차입니다.

---

### 1. 프로젝트 폴더 구조

바탕화면이나 작업 폴더에 `extension-triage`라는 새 폴더를 만들고, 아래 4개 파일을 동일한 위치에 생성합니다.

```text
extension-triage/
├── manifest.json       # 확장 프로그램 메타데이터 및 권한 정의
├── background.js      # 탭 모니터링 및 백그라운드 로직 (Service Worker)
├── popup.html         # 메모 작성 및 등록을 위한 팝업 UI
└── popup.js           # 팝업 로직 (스토리지 저장/삭제)
```

---

### 2. 소스 코드 작성

#### ① `manifest.json`
Manifest V3 표준을 준수하며, URL 접근과 로컬 저장소, 배지 제어 권한을 명시합니다.

```json
{
  "manifest_version": 3,
  "name": "WebStore Extension Triage",
  "version": "1.0",
  "description": "이전에 비추천/실패로 평가한 크롬 확장을 식별하고 경고 배지를 띄웁니다.",
  "permissions": [
    "tabs",
    "storage",
    "notifications"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "확장 프로그램 평가 메모"
  }
}
```

#### ② `background.js`
탭이 변경되거나 새 URL이 로드될 때마다 실행되며, 크롬 웹스토어 상세 페이지의 고유 ID(32자리 알파벳)를 추출해 등록된 블랙리스트인지 판별합니다.

```javascript
// 웹스토어 URL에서 32자리 고유 ID 추출 정규표현식
const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

// 탭 URL 변경 감지
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // URL이 확정되고 페이지 로딩이 완료된 시점에만 실행
  if (changeInfo.status === 'complete' && tab.url) {
    checkUrl(tabId, tab.url);
  }
});

// 탭 전환(포커스 이동) 감지
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab && tab.url) {
    checkUrl(activeInfo.tabId, tab.url);
  }
});

async function checkUrl(tabId, url) {
  const match = url.match(WEBSTORE_REGEX);
  
  if (!match) {
    // 웹스토어 상세 페이지가 아니면 배지 제거
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  const extId = match[1];
  const { bad_list = {} } = await chrome.storage.local.get('bad_list');

  if (bad_list[extId]) {
    const item = bad_list[extId];

    // 1. 툴바 아이콘에 빨간색 'BAD' 배지 표시
    chrome.action.setBadgeText({ tabId, text: 'BAD' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#D32F2F' });

    // 2. 시스템 데스크톱 알림 띄우기 (페이지 진입 즉시 인지 가능)
    chrome.notifications.create(`warn_${extId}_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23D32F2F"/><text x="50%" y="55%" fill="white" font-size="28" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">⚠️</text></svg>',
      title: '⛔ 비추천 확장 프로그램 감지',
      message: `[등록 사유: ${item.memo}]\n이전에 실망하거나 오류로 기록한 확장입니다.`,
      priority: 2
    });
  } else {
    // 등록되지 않은 확장이면 배지 초기화
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}
```

#### ③ `popup.html`
웹스토어 화면에서 툴바의 확장 프로그램 아이콘을 눌렀을 때 나타나는 인터페이스입니다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 14px;
      margin: 0;
      color: #333;
      background-color: #fafafa;
    }
    h3 { margin: 0 0 10px 0; font-size: 14px; color: #111; }
    .status-box {
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.4;
    }
    .status-clean { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
    .status-bad { background: #ffebee; color: #c62828; border: 1px solid #ffcdd2; font-weight: bold; }
    textarea {
      width: 100%;
      height: 65px;
      box-sizing: border-box;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: #1976d2; }
    .btn-group { display: flex; gap: 6px; margin-top: 10px; }
    button {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-save { background: #d32f2f; color: white; }
    .btn-save:hover { background: #b71c1c; }
    .btn-del { background: #757575; color: white; }
    .btn-del:hover { background: #616161; }
    .info { font-size: 11px; color: #777; margin-top: 8px; }
  </style>
</head>
<body>
  <div id="app">
    <h3>확장 프로그램 평가 상태</h3>
    <div id="statusBox" class="status-box">확인 중...</div>
    
    <label for="memoInput" style="font-size: 12px; font-weight: bold;">비추천 사유 / 주의 메모:</label>
    <textarea id="memoInput" placeholder="예: CPU 점유율 비정상, 특정 웹사이트 충돌, 개인정보 과다 수집 등"></textarea>
    
    <div class="btn-group">
      <button id="saveBtn" class="btn-save">지뢰 목록 등록</button>
      <button id="delBtn" class="btn-del" style="display: none;">해제(삭제)</button>
    </div>
    <div class="info" id="idDisplay"></div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

#### ④ `popup.js`
현재 탭의 URL을 분석하고, 로컬 스토리지에 데이터를 입출력합니다.

```javascript
const WEBSTORE_REGEX = /chromewebstore\.google\.com\/detail\/(?:[^\/]+\/)?([a-p]{32})/i;

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const statusBox = document.getElementById('statusBox');
  const memoInput = document.getElementById('memoInput');
  const saveBtn = document.getElementById('saveBtn');
  const delBtn = document.getElementById('delBtn');
  const idDisplay = document.getElementById('idDisplay');

  if (!tab || !tab.url) return;

  const match = tab.url.match(WEBSTORE_REGEX);
  if (!match) {
    statusBox.className = 'status-box';
    statusBox.style.background = '#eee';
    statusBox.textContent = '크롬 웹스토어 확장 페이지가 아닙니다.';
    memoInput.disabled = true;
    saveBtn.disabled = true;
    return;
  }

  const extId = match[1];
  idDisplay.textContent = `ID: ${extId}`;

  // 저장된 데이터 확인
  const { bad_list = {} } = await chrome.storage.local.get('bad_list');
  const current = bad_list[extId];

  if (current) {
    statusBox.className = 'status-box status-bad';
    statusBox.innerHTML = `⚠️ 비추천 등록됨<br>사유: ${current.memo}<br><small>(${current.date})</small>`;
    memoInput.value = current.memo;
    saveBtn.textContent = '메모 수정';
    delBtn.style.display = 'block';
  } else {
    statusBox.className = 'status-box status-clean';
    statusBox.textContent = '미등록 상태 (정상 검토 대상)';
  }

  // 저장 버튼 이벤트
  saveBtn.addEventListener('click', async () => {
    const memo = memoInput.value.trim() || '사유 미기재';
    bad_list[extId] = {
      memo,
      date: new Date().toLocaleDateString(),
      url: tab.url
    };
    await chrome.storage.local.set({ bad_list });
    
    // 배지 즉각 반영
    chrome.action.setBadgeText({ tabId: tab.id, text: 'BAD' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#D32F2F' });

    window.close();
  });

  // 삭제 버튼 이벤트
  delBtn.addEventListener('click', async () => {
    delete bad_list[extId];
    await chrome.storage.local.set({ bad_list });
    
    // 배지 즉각 해제
    chrome.action.setBadgeText({ tabId: tab.id, text: '' });

    window.close();
  });
});
```

---

### 3. 브라우저에 설치하는 법 (개발자 모드)

크롬 웹스토어 심사나 외부 배포 없이, 본인의 브라우저에 단 10초 만에 직접 로드할 수 있습니다.

1. 크롬 주소창에 `chrome://extensions/`를 입력해 이동합니다.
2. 우측 상단의 **[개발자 모드]** 토글 스위치를 켭니다.
3. 좌측 상단에 나타난 **[압축해제된 확장 프로그램을 로드합니다]** 버튼을 클릭합니다.
4. 방금 파일 4개를 생성해 둔 `extension-triage` 폴더를 선택합니다.
5. 주소창 우측 확장 프로그램(퍼즐 조각) 아이콘을 눌러 방금 추가된 **WebStore Extension Triage**를 툴바에 고정(Pin)합니다.

---

### 4. 실제 동작 검증

1. 임의의 크롬 웹스토어 확장 페이지(예: `[https://chromewebstore.google.com/detail/](https://chromewebstore.google.com/detail/)...`)에 접속합니다.
2. 사용해 보고 품질이 나쁘거나 버그가 심하다고 판단되면, 툴바의 **확장 프로그램 아이콘**을 클릭합니다.
3. 사유(예: *"메모리 누수 심함, 특정 사이트 충돌"*)를 적고 **[지뢰 목록 등록]**을 누릅니다.
4. **검증:**
   * 이후 언제든 해당 확장의 웹스토어 페이지를 다시 열면, 브라우저 우측 상단 아이콘에 즉시 붉은색 **`BAD`** 라벨이 붙습니다.
   * 동시에 윈도우 우측 하단에 **시스템 경고 알림(Notification)**이 팝업되어, 페이지 내용을 다시 훑어보며 시간을 낭비하기 전에 이전에 비추천한 이유를 즉시 확인할 수 있습니다.