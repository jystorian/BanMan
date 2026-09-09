# 🛡️ BanMan: Ban & Flag Bad URLs

> **Chrome City Protector** — 원치 않는 사이트 사전 차단(Ban)과 링크 경고 깃발(Flag)로 크롬 시티를 지키는 다크나이트

BanMan은 악성 사이트, 피싱, 광고성 찌라시 사이트의 직접 접속을 사전에 차단(Ban)하고, 구글·네이버 등의 검색 결과 및 웹페이지 내 의심 링크에 시각적인 경고 깃발(Flag)을 표시해 주는 크롬 확장 프로그램입니다.

---

## ✨ 주요 기능 (Key Features)

- **🚫 완벽한 사전 차단 (Ban)**: 등록된 불량 도메인 및 특정 URL 경로로의 접속을 사전에 차단하고 전용 다크나이트 안내 화면을 띄웁니다.
- **🚩 스마트 링크 경고 (Flag)**: 구글, 네이버, 다음 등 주요 검색 엔진 및 웹 서핑 중 발견되는 불량 링크 옆에 즉각 경고 깃발을 꽂아 클릭을 방지합니다.
- **⚡ 초고속 매칭 엔진**: 도메인 계층 역색인 기반의 $O(1)$ 알고리즘으로 10,000개 이상의 규칙이 등록되어 있어도 웹 브라우징 속도 저하(0.002ms)가 전혀 없습니다.
- **☁️ Google Drive 클라우드 동기화**: `appDataFolder` 전용 공간을 활용하여 새 PC나 여러 대의 컴퓨터 간에 클릭 한 번으로 차단 규칙을 스마트 병합 동기화합니다.
- **🔐 클라이언트 종단간 암호화 (E2EE)**: Web Crypto API 기반 AES-256-GCM 및 PBKDF2(100,000회 스트레칭)를 적용하여, 구글 서버에도 규칙 내용이 일체 노출되지 않도록 암호화하여 저장할 수 있습니다.
- **🌐 3개국어 완벽 지원**: 한국어(KO), 영어(EN), 일본어(JA) UI 완벽 지원.

---

## 📦 설치 방법 (Installation)

1. 저장소를 클론하거나 ZIP 파일로 다운로드합니다:
   ```bash
   git clone https://github.com/jystorm/BanMan.git
   ```
2. 크롬 브라우저를 열고 주소창에 `chrome://extensions` 를 입력합니다.
3. 우측 상단의 **개발자 모드(Developer mode)** 스위치를 켭니다.
4. 좌측 상단의 **[압축해제된 확장 프로그램을 로드합니다]** 버튼을 클릭하고 `BanMan` 폴더를 선택합니다.

---

## 🔒 개인정보 보호 (Privacy)

BanMan은 사용자의 개인정보를 소중히 여깁니다. 별도의 외부 수집 서버를 일체 두지 않으며, 구글 드라이브 동기화 시에도 격리된 전용 공간(`appDataFolder`)만을 사용합니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md)를 참조하세요.

---

## 📄 라이선스 (License)

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
