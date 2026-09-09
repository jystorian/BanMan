# Chrome Web Store Listing & Review Documentation for BanMan

이 문서는 크롬 웹스토어 개발자 대시보드([Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole))에 항목을 등록할 때 그대로 복사해서 붙여넣을 수 있는 공식 스토어 등록 정보 및 심사 통과 가이드입니다.

---

## 1. 기본 등록 정보 (Store Listing Metadata)

### 확장 프로그램 이름 (Name)
```text
BanMan: Ban & Flag Bad URLs
```

### 요약 설명 (Summary Description - 132자 이내)
```text
원치 않는 사이트 사전 차단(Ban)과 검색 결과 링크 경고 깃발(Flag)로 안전한 웹 서핑을 돕는 크롬 다크나이트
```

### 상세 설명 (Detailed Description)
```text
🛡️ BanMan: Ban & Flag Bad URLs — Chrome City Protector

BanMan은 악성 사이트, 피싱, 영리 목적의 어그로 낚시성 사이트의 직접 접속을 사전에 차단(Ban)하고, 구글·네이버 등의 검색 결과 및 웹서핑 중 발견되는 불량 링크 옆에 시각적인 경고 깃발(Flag)을 꽂아 사전에 클릭을 방지해 주는 스마트 보안 크롬 확장 프로그램입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ 주요 기능 (Key Features)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 🚫 완벽한 사전 차단 (Ban)
- 사용자가 등록한 불량 도메인이나 특정 URL 경로로 접속 시 즉각 접속을 차단하고 BanMan 전용 차단 화면을 표시합니다.

2. 🚩 스마트 링크 경고 (Flag)
- 구글, 네이버 등 주요 검색 엔진의 검색 결과 페이지나 일반 웹페이지 내의 링크를 실시간 검사하여, 등록된 불량 링크 옆에 눈에 띄는 경고 깃발을 표시합니다.

3. ⚡ 초고속 매칭 엔진 (O(1) 역색인)
- 도메인 계층 역색인(Inverted Index) 알고리즘을 적용하여, 차단 규칙이 10,000개 이상 등록되어 있어도 웹 브라우징 속도 저하(0.002ms 이내)가 전혀 없습니다.

4. ☁️ 구글 드라이브 클라우드 동기화 (선택 사항)
- 새 PC나 노트북, 여러 대의 컴퓨터 간에 클릭 한 번으로 차단 목록을 스마트 병합 동기화합니다. (Google Drive 전용 격리 공간인 appDataFolder 사용)

5. 🔐 강력한 클라이언트 종단간 암호화 (E2EE)
- Web Crypto API(AES-256-GCM + PBKDF2 100,000회 스트레칭)를 탑재하여, 구글 서버에도 차단 목록 내용이 노출되지 않도록 완벽히 암호화하여 저장할 수 있습니다.

6. 🌐 3개국어 완벽 지원
- 한국어, 영어, 일본어 UI를 완벽하게 지원합니다.
```

### 카테고리 (Category)
* **생산성 (Productivity)** 또는 **접근성 (Accessibility / Tools)**

### 언어 (Language)
* 기본 언어: 한국어 (Korean)

---

## 2. 권한 사유서 (Permissions Justification)
> ⚠️ **중요**: 구글 심사관이 가장 까다롭게 확인하는 항목입니다. 아래 사유를 그대로 붙여넣으시면 됩니다.

* **`tabs`**:
  * 사유: `현재 활성화된 탭의 URL을 확인하여 등록된 차단 도메인/경로와 일치할 경우 사전 차단 화면으로 즉시 전환하기 위해 필요합니다.`
* **`storage` / `unlimitedStorage`**:
  * 사유: `사용자가 등록한 차단 및 주의 규칙 목록(최대 10,000개 이상)과 사용자 환경설정을 브라우저 로컬 저장소에 영구 보관하기 위해 필요합니다.`
* **`identity`**:
  * 사유: `사용자의 선택에 따라 구글 드라이브(appDataFolder)에 차단 규칙 백업 데이터를 암호화 동기화하기 위한 Google OAuth2 인증에 사용됩니다.`
* **`notifications`**:
  * 사유: `구글 드라이브 동기화 완료 또는 실패 시 사용자에게 시스템 알림을 표시하기 위해 사용됩니다.`
* **호스트 권한 (`<all_urls>`)**:
  * 사유: `사용자가 방문하는 웹페이지 내의 하이퍼링크를 실시간 검사하여 등록된 배드 링크 옆에 경고 깃발(Flag)을 삽입하고 차단하기 위해 모든 웹사이트에 대한 content_scripts 실행 권한이 필요합니다.`

---

## 3. 개인정보 보호 및 데이터 사용 (Privacy & Data Usage)

* **개인정보처리방침 URL (Privacy Policy URL)**:
  ```text
  https://github.com/jystorian/BanMan/blob/main/PRIVACY.md
  ```
* **단일 목적 명세서 (Single Purpose)**:
  ```text
  원치 않는 사이트와 특정 웹페이지의 사전 차단 및 블랙리스트 등록된 링크에 경고 깃발을 표시하여 안전하고 편안한 웹 브라우징을 지원합니다.
  ```
* **데이터 수집 체크 항목**:
  * 사용자 데이터 수집 여부: **"데이터를 일체 수집하지 않음 (No data collection)"** 체크
  * 데이터 판매/제3자 제공 여부: **"아니오 (No)"** 체크
