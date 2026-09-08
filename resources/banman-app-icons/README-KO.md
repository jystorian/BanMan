# 밴맨 앱 아이콘 패키지

사용자가 기획한 밴맨 캐릭터를 기반으로 만든 4개 스타일 × 4개 모티프, 총 16종 아이콘입니다.

## 스타일

- `01-pixel`: 8/16비트 픽셀 게임풍
- `02-glass`: 현대적인 반투명 글래스풍
- `03-skeuomorphic`: 가죽·금속 재질의 스큐어모피즘
- `04-neo-noir`: 선명한 네오누아르 마스코트 로고풍

## 모티프

- `face`: 얼굴
- `flag`: B 금지표식 깃발
- `b-mark`: 사선이 가로지르는 B 엠블럼
- `face-b-badge`: 얼굴과 B 배지 조합

## 폴더 구성

각 모티프 폴더에는 16px부터 1024px까지 22종 PNG가 들어 있습니다. `platform-ready`에는 바로 적용하기 쉬운 용도별 파일이 있습니다.

- `web`: favicon ICO, 16/32px PNG, Apple Touch 180px, PWA 192/512px, 예시 manifest
- `windows`: 16~256px를 포함하는 다중 해상도 `app.ico`와 대표 PNG
- `ios/AppIcon.appiconset`: Xcode용 PNG와 `Contents.json`
- `android`: mdpi~xxxhdpi 런처 PNG와 512px 스토어 이미지
- `desktop`: Windows/Linux/일반 데스크톱용 16~512px PNG
- `macos/app.iconset`: macOS 아이콘 제작용 표준 PNG 묶음

## 참고

- 픽셀 스타일은 도트의 경계를 보존하기 위해 최근접 보간으로 리사이즈했습니다.
- 다른 세 스타일은 축소 시 계단 현상을 줄이기 위해 Lanczos 보간을 사용했습니다.
- 원본 콘셉트 보드는 각 스타일의 `contact-sheet` 폴더와 최상위 `contact-sheets` 폴더에 보관했습니다.
- 운영체제가 자체 마스크를 적용하는 경우를 고려해 각 후보의 기존 여백과 배경을 유지했습니다.

