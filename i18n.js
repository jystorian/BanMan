// i18n.js - Multi-language dictionary and helper functions (KO, EN, JA)

const I18N_DICTIONARY = {
  ko: {
    app_name: 'BanMan',
    app_slogan: 'Ban & Flag bad URLs for Chrome city',
    options_btn: '설정 및 목록 관리 ⚙️',
    detecting: '감지 중...',
    checking_url: 'URL 확인 중...',
    target_header: '감지된 대상 URL / 사이트:',
    badge_webstore: '크롬 웹스토어 확장',
    badge_web: '일반 웹사이트',
    badge_system: '특수 페이지',
    target_scope: '적용 대상 범위:',
    scope_url: '현재 URL만',
    scope_domain: '도메인 전체',
    action_type: '처리 방식 (액션):',
    action_block_title: '사전 차단',
    action_block_desc: '진입 시 차단 화면',
    action_warn_title: '경고 & 메모',
    action_warn_desc: '배지 / 취소선',
    action_hide_title: '링크 숨김',
    action_hide_desc: '타 사이트서 은닉',
    memo_label: '차단 / 비추천 사유 메모:',
    memo_placeholder: '예: 낚시성 뉴스, 메모리 누수 버그, 광고 과다 등',
    save_btn_add: '블랙리스트 등록',
    save_btn_edit: '메모 및 설정 수정',
    delete_btn: '해제',
    status_unregistered: '미등록 상태',
    status_registered: '[등록됨: {date}]',
    status_saved: '성공적으로 저장되었습니다!',
    status_deleted: '블랙리스트에서 삭제되었습니다.',
    status_system_page: '시스템/내부 페이지는 등록할 수 없습니다.',
    tab_info_error: '활성화된 탭 정보를 가져올 수 없습니다.',
    url_parse_error: 'URL 파싱 실패',

    blocked_title: '접근이 차단된 웹페이지입니다',
    blocked_subtitle: 'BanMan의 크롬 시티 방어 규칙에 따라 접속이 사전에 차단되었습니다.',
    blocked_target_label: '차단 대상',
    blocked_memo_label: '기록된 사유',
    blocked_url_label: '요청 URL',
    blocked_no_memo: '사유가 기록되지 않았습니다.',
    blocked_go_back: '◀ 안전하게 이전 페이지로 돌아가기',
    blocked_bypass: '이 탭에서 1회 임시 허용',
    blocked_bypassing: '임시 허용 처리 중...',
    blocked_manage_link: '설정 및 전체 목록 관리 ⚙️',

    dashboard_title: 'BanMan 대시보드',
    dashboard_desc: 'Ban & Flag bad URLs for Chrome city',
    export_json: '📥 JSON 내보내기',
    import_json: '📤 JSON 가져오기',
    stat_total: '전체 등록 규칙',
    stat_block: '🚫 사전 차단',
    stat_warn: '⚠️ 경고 & 메모',
    stat_hide: '👁️ 링크 숨김',
    add_card_title: '새 규칙 직접 추가',
    add_target_label: '대상 (도메인, URL, 또는 웹스토어 32자리 ID)',
    add_target_placeholder: '예: bad-domain.com 또는 [32자리 확장ID]',
    add_type_label: '유형',
    add_action_label: '처리 액션',
    add_memo_label: '사유 메모',
    add_memo_placeholder: '차단/주의를 권고하는 구체적인 사유를 적어주세요',
    add_submit_btn: '규칙 추가',
    list_card_title: '등록된 규칙 목록',
    search_placeholder: '대상 또는 메모 검색...',
    filter_all: '전체',
    filter_block: '차단',
    filter_warn: '경고',
    filter_hide: '숨김',
    th_target: '대상 및 유형',
    th_action: '액션',
    th_memo: '기록된 사유 메모',
    th_date: '등록일',
    th_manage: '관리',
    type_domain: '도메인',
    type_url: 'URL',
    type_webstore: '크롬 웹스토어',
    action_block: '사전 차단',
    action_warn: '경고 & 메모',
    action_hide: '링크 숨김',
    btn_edit: '수정',
    btn_delete: '삭제',
    btn_save: '저장',
    btn_cancel: '취소',
    modal_edit_title: '규칙 수정',
    modal_target_label: '대상',
    modal_action_label: '처리 액션 선택 (클릭)',
    modal_memo_label: '사유 메모',
    empty_rules: '크롬 시티가 평화롭습니다. 등록된 지뢰 사이트 규칙이 없습니다.',
    confirm_delete: "'{key}' 규칙을 삭제하시겠습니까?",
    prompt_action: "처리 액션을 선택하세요 (block / warn / hide):\n현재: {action}",
    prompt_memo: "사유 메모를 수정하세요:",
    import_invalid_json: '올바르지 않은 JSON 파일 형식입니다.',
    import_confirm: "기존 규칙에 덮어쓰시겠습니까?\n[확인]: 기존 목록 삭제 후 덮어쓰기\n[취소]: 기존 목록 유지하며 병합(Merge)",
    import_success: '총 {count}개의 규칙이 성공적으로 반영되었습니다.',
    import_error: 'JSON 파일을 읽는 도중 오류가 발생했습니다: {error}'
  },

  en: {
    app_name: 'BanMan',
    app_slogan: 'Ban & Flag bad URLs for Chrome city',
    options_btn: 'Settings & Rules ⚙️',
    detecting: 'Detecting...',
    checking_url: 'Checking URL...',
    target_header: 'Detected Target URL / Site:',
    badge_webstore: 'Chrome Web Store Ext',
    badge_web: 'Standard Website',
    badge_system: 'Special Page',
    target_scope: 'Target Scope:',
    scope_url: 'Current URL only',
    scope_domain: 'Entire Domain',
    action_type: 'Action Type:',
    action_block_title: 'Block',
    action_block_desc: 'Show block screen',
    action_warn_title: 'Warn & Memo',
    action_warn_desc: 'Badge & strikethrough',
    action_hide_title: 'Hide Links',
    action_hide_desc: 'Conceal on pages',
    memo_label: 'Block / Warning Reason Memo:',
    memo_placeholder: 'e.g., Clickbait news, memory leak, excessive ads',
    save_btn_add: 'Add to Blacklist',
    save_btn_edit: 'Update Memo & Settings',
    delete_btn: 'Remove',
    status_unregistered: 'Not registered',
    status_registered: '[Registered: {date}]',
    status_saved: 'Saved successfully!',
    status_deleted: 'Removed from blacklist.',
    status_system_page: 'Cannot register system or internal pages.',
    tab_info_error: 'Unable to retrieve active tab information.',
    url_parse_error: 'Failed to parse URL.',

    blocked_title: 'Access Blocked by BanMan',
    blocked_subtitle: 'Access was preemptively blocked according to your Chrome City defense rules.',
    blocked_target_label: 'Target',
    blocked_memo_label: 'Recorded Reason',
    blocked_url_label: 'Requested URL',
    blocked_no_memo: 'No reason recorded.',
    blocked_go_back: '◀ Go back safely to previous page',
    blocked_bypass: 'Allow once in this tab',
    blocked_bypassing: 'Bypassing...',
    blocked_manage_link: 'Settings & open dashboard ⚙️',

    dashboard_title: 'BanMan Dashboard',
    dashboard_desc: 'Ban & Flag bad URLs for Chrome city',
    export_json: '📥 Export JSON',
    import_json: '📤 Import JSON',
    stat_total: 'Total Rules',
    stat_block: '🚫 Preemptive Block',
    stat_warn: '⚠️ Warn & Memo',
    stat_hide: '👁️ Link Hidden',
    add_card_title: 'Add New Rule Manually',
    add_target_label: 'Target (Domain, URL, or 32-char Web Store ID)',
    add_target_placeholder: 'e.g., bad-domain.com or [32-char extension ID]',
    add_type_label: 'Type',
    add_action_label: 'Action',
    add_memo_label: 'Reason Memo',
    add_memo_placeholder: 'Describe why this site or extension should be blocked/flagged',
    add_submit_btn: 'Add Rule',
    list_card_title: 'Registered Rules List',
    search_placeholder: 'Search target or memo...',
    filter_all: 'All',
    filter_block: 'Block',
    filter_warn: 'Warn',
    filter_hide: 'Hide',
    th_target: 'Target & Type',
    th_action: 'Action',
    th_memo: 'Recorded Reason Memo',
    th_date: 'Date Added',
    th_manage: 'Manage',
    type_domain: 'Domain',
    type_url: 'URL',
    type_webstore: 'Chrome Web Store',
    action_block: 'Block',
    action_warn: 'Warn & Memo',
    action_hide: 'Hide Link',
    btn_edit: 'Edit',
    btn_delete: 'Delete',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    modal_edit_title: 'Edit Rule',
    modal_target_label: 'Target',
    modal_action_label: 'Select Action (Click)',
    modal_memo_label: 'Reason Memo',
    empty_rules: 'Chrome City is peaceful. No harmful site rules registered yet.',
    confirm_delete: "Are you sure you want to delete rule for '{key}'?",
    prompt_action: "Choose action (block / warn / hide):\nCurrently: {action}",
    prompt_memo: "Edit reason memo:",
    import_invalid_json: 'Invalid JSON file format.',
    import_confirm: "Overwrite existing rules?\n[OK]: Clear and overwrite\n[Cancel]: Merge with existing rules",
    import_success: 'Successfully imported {count} rules.',
    import_error: 'Error reading JSON file: {error}'
  },

  ja: {
    app_name: 'BanMan',
    app_slogan: 'Ban & Flag bad URLs for Chrome city',
    options_btn: '設定・管理 ⚙️',
    detecting: '検出中...',
    checking_url: 'URL確認中...',
    target_header: '検出された対象 URL / サイト:',
    badge_webstore: 'ウェブストア拡張機能',
    badge_web: '一般ウェブサイト',
    badge_system: '特殊ページ',
    target_scope: '適用対象の範囲:',
    scope_url: '現在のURLのみ',
    scope_domain: 'ドメイン全体',
    action_type: '処理方式 (アクション):',
    action_block_title: '事前ブロック',
    action_block_desc: 'アクセス時に遮断画面を表示',
    action_warn_title: '警告 & メモ',
    action_warn_desc: 'バッジおよび取り消し線表示',
    action_hide_title: 'リンク非表示',
    action_hide_desc: '他サイト上でリンクを隠蔽',
    memo_label: 'ブロック / 警告理由のメモ:',
    memo_placeholder: '例: 釣り記事、メモリリーク、過剰な広告など',
    save_btn_add: 'ブラックリスト登録',
    save_btn_edit: 'メモ・設定の更新',
    delete_btn: '登録解除',
    status_unregistered: '未登録状態',
    status_registered: '[登録済: {date}]',
    status_saved: '正常に保存されました！',
    status_deleted: 'ブラックリストから削除されました。',
    status_system_page: 'システム/内部ページは登録できません。',
    tab_info_error: 'アクティブなタブ情報を取得できません。',
    url_parse_error: 'URLの解析に失敗しました。',

    blocked_title: 'アクセスが遮断されたページです',
    blocked_subtitle: 'BanManのChrome City防衛ルールにより、事前ブロックされました。',
    blocked_target_label: '遮断対象',
    blocked_memo_label: '記録された理由',
    blocked_url_label: '要求URL',
    blocked_no_memo: '理由が記録されていません。',
    blocked_go_back: '◀ 安全に前のページへ戻る',
    blocked_bypass: 'このタブで1回だけ一時許可',
    blocked_bypassing: '一時許可処理中...',
    blocked_manage_link: '設定・ダッシュボード管理 ⚙️',

    dashboard_title: 'BanMan ダッシュボード',
    dashboard_desc: 'Ban & Flag bad URLs for Chrome city',
    export_json: '📥 JSON エクスポート',
    import_json: '📤 JSON インポート',
    stat_total: '全登録ルール',
    stat_block: '🚫 事前ブロック',
    stat_warn: '⚠️ 警告 & メモ',
    stat_hide: '👁️ リンク非表示',
    add_card_title: '新規ルール直接追加',
    add_target_label: '対象 (ドメイン、URL、またはウェブストア32文字ID)',
    add_target_placeholder: '例: bad-domain.com または [32文字拡張機能ID]',
    add_type_label: 'タイプ',
    add_action_label: '処理アクション',
    add_memo_label: '理由メモ',
    add_memo_placeholder: 'ブロック・注意を推奨する具体的な理由を入力してください',
    add_submit_btn: 'ルール追加',
    list_card_title: '登録ルール一覧',
    search_placeholder: '対象またはメモを検索...',
    filter_all: 'すべて',
    filter_block: 'ブロック',
    filter_warn: '警告',
    filter_hide: '非表示',
    th_target: '対象およびタイプ',
    th_action: 'アクション',
    th_memo: '記録された理由メモ',
    th_date: '登録日',
    th_manage: '管理',
    type_domain: 'ドメイン',
    type_url: 'URL',
    type_webstore: 'ウェブストア',
    action_block: '事前ブロック',
    action_warn: '警告 & メモ',
    action_hide: 'リンク非表示',
    btn_edit: '編集',
    btn_delete: '削除',
    btn_save: '保存',
    btn_cancel: 'キャンセル',
    modal_edit_title: 'ルールの編集',
    modal_target_label: '対象',
    modal_action_label: '処理アクションの選択 (クリック)',
    modal_memo_label: '理由メモ',
    empty_rules: 'Chrome Cityは平和です。登録された要注意サイトルールはありません。',
    confirm_delete: "ルール '{key}' を削除してもよろしいですか？",
    prompt_action: "アクションを選択してください (block / warn / hide):\n現在: {action}",
    prompt_memo: "理由メモを編集してください:",
    import_invalid_json: '無効なJSONファイル形式です。',
    import_confirm: "既存ルールを上書きしますか？\n[OK]: 既存ルールを削除して上書き\n[キャンセル]: 既存ルールを維持してマージ",
    import_success: '合計 {count} 件のルールが正常に反映されました。',
    import_error: 'JSONファイルの読み込み中にエラーが発生しました: {error}'
  }
};

async function getAppLanguage() {
  try {
    const res = await chrome.storage.local.get('app_lang');
    if (res && res.app_lang && ['ko', 'en', 'ja'].includes(res.app_lang)) {
      return res.app_lang;
    }
  } catch (e) {}

  const uiLang = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : (navigator.language || 'ko')).toLowerCase();
  if (uiLang.startsWith('ja')) return 'ja';
  if (uiLang.startsWith('en')) return 'en';
  return 'ko';
}

async function setAppLanguage(lang) {
  if (['ko', 'en', 'ja'].includes(lang)) {
    await chrome.storage.local.set({ app_lang: lang });
  }
}

function t(key, lang = 'ko', params = {}) {
  const dict = I18N_DICTIONARY[lang] || I18N_DICTIONARY.ko;
  let text = dict[key] || (I18N_DICTIONARY.ko && I18N_DICTIONARY.ko[key]) || key;
  for (const [pKey, pVal] of Object.entries(params)) {
    text = text.replace(new RegExp('\\{' + pKey + '\\}', 'g'), pVal);
  }
  return text;
}

function applyTranslations(lang) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key, lang);
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = t(key, lang);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.title = t(key, lang);
    }
  });
}
