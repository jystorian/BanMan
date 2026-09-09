// drive-sync.js - Google Drive (appDataFolder) Sync & Smart Merge Module
// Utilizes chrome.identity and Google Drive REST API v3

(function (global) {
  'use strict';

  const BACKUP_FILENAME = 'banman_sync.json';
  const DRIVE_API_FILES = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
  const USER_INFO_API = 'https://www.googleapis.com/oauth2/v2/userinfo';

  /**
   * Google OAuth2 액세스 토큰 획득
   * 1) chrome.storage.local의 custom_client_id가 있으면 launchWebAuthFlow(Web OAuth) 우선 사용
   * 2) 없으면 manifest.json의 oauth2.client_id 검사
   * 3) manifest의 client_id가 placeholder(YOUR_GOOGLE_CLIENT_ID)인 경우 CLIENT_ID_REQUIRED 에러 반환
   * 4) 정상 client_id이면 chrome.identity.getAuthToken 호출
   * @param {boolean} interactive 사용자 로그인 팝업 표시 여부
   * @returns {Promise<string>} Access Token
   */
  async function getAuthToken(interactive = true) {
    // 1. manifest.json의 oauth2.client_id 확인 (네이티브 원클릭 로그인 우선)
    const manifest = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) ? chrome.runtime.getManifest() : null;
    const manifestClientId = manifest?.oauth2?.client_id || '';

    if (manifestClientId && !manifestClientId.includes('YOUR_GOOGLE_CLIENT_ID')) {
      if (!chrome?.identity?.getAuthToken) {
        throw new Error('chrome.identity.getAuthToken API를 사용할 수 없습니다.');
      }

      return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            if (msg.includes('bad client id')) {
              const err = new Error('CLIENT_ID_INVALID');
              err.code = 'CLIENT_ID_INVALID';
              return reject(err);
            }
            return reject(new Error(msg));
          }
          if (!token) {
            return reject(new Error('토큰 획득에 실패했습니다.'));
          }
          resolve(token);
        });
      });
    }

    // 2. manifest에 없을 경우: 사용자가 옵션 페이지에서 직접 입력한 Custom Client ID (fallback)
    let customClientId = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get('custom_client_id');
        customClientId = (res && res.custom_client_id ? res.custom_client_id.trim() : '');
      }
    } catch (e) {}

    if (customClientId) {
      return await getAuthTokenViaWebFlow(customClientId, interactive);
    }

    const err = new Error('CLIENT_ID_REQUIRED');
    err.code = 'CLIENT_ID_REQUIRED';
    throw err;
  }

  /**
   * launchWebAuthFlow 기반 웹 OAuth2 토큰 획득
   * @param {string} clientId Google OAuth Web Client ID
   * @param {boolean} interactive 사용자 로그인 팝업 여부
   * @returns {Promise<string>} Access Token
   */
  async function getAuthTokenViaWebFlow(clientId, interactive = true) {
    if (!chrome?.identity?.launchWebAuthFlow) {
      throw new Error('chrome.identity.launchWebAuthFlow API를 사용할 수 없습니다.');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email');

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive }, (redirectResponse) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!redirectResponse) {
          return reject(new Error('인증이 취소되었거나 응답이 없습니다.'));
        }
        try {
          const responseUrl = new URL(redirectResponse);
          const hashParams = new URLSearchParams(responseUrl.hash.startsWith('#') ? responseUrl.hash.slice(1) : responseUrl.hash);
          const token = hashParams.get('access_token');
          if (!token) {
            const error = hashParams.get('error') || '토큰 획득에 실패했습니다.';
            return reject(new Error(error));
          }
          resolve(token);
        } catch (e) {
          reject(new Error('인증 응답 파싱 실패: ' + e.message));
        }
      });
    });
  }

  /**
   * 연동 해제 및 캐시된 토큰 삭제
   * @param {string} token 
   */
  async function revokeToken(token) {
    if (!token) return;

    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`, {
        method: 'GET',
        mode: 'no-cors'
      });
    } catch (e) {
      console.warn('Revoke endpoint failed, continuing local token removal:', e);
    }

    return new Promise((resolve) => {
      if (chrome?.identity?.removeCachedAuthToken) {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * 연동된 구글 계정 사용자 정보 조회
   * 1) Drive API의 about 엔드포인트(drive.appdata 권한으로 호출 가능) 우선 시도
   * 2) oauth2 userinfo API 시도
   * 3) 실패 시에도 연동을 방해하지 않고 기본 객체로 안전하게 반환
   * @param {string} token 
   * @returns {Promise<{ email: string, name: string, picture: string }>}
   */
  async function getUserInfo(token) {
    // 1. Google Drive API about 엔드포인트 (drive.appdata 스코프로 바로 조회 가능)
    try {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.user) {
          return {
            email: data.user.emailAddress || 'Google Account',
            name: data.user.displayName || '',
            picture: data.user.photoLink || ''
          };
        }
      }
    } catch (e) {
      console.warn('Drive about endpoint lookup failed:', e);
    }

    // 2. oauth2 userinfo API fallback
    try {
      const res2 = await fetch(USER_INFO_API, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res2.ok) {
        const info = await res2.json();
        return {
          email: info.email || 'Google Account',
          name: info.name || '',
          picture: info.picture || ''
        };
      }
    } catch (e) {}

    // 3. 사용자 프로필 조회가 실패하더라도 토큰 인증 자체는 성공했으므로 연동 정상 유지
    return { email: 'Google Account', name: '', picture: '' };
  }

  /**
   * appDataFolder 내에 기존 백업 파일이 있는지 검색
   * @param {string} token 
   * @returns {Promise<{ id: string, name: string, modifiedTime: string, size: string } | null>}
   */
  async function findBackupFile(token) {
    const q = encodeURIComponent(`name = '${BACKUP_FILENAME}' and 'appDataFolder' in parents and trashed = false`);
    const url = `${DRIVE_API_FILES}?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`드라이브 백업 파일 검색 실패 (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0];
    }
    return null;
  }

  /**
   * appDataFolder로 백업 파일 업로드 (생성 또는 기존 파일 갱신)
   * @param {string} token 
   * @param {Object|string} payload 
   * @returns {Promise<Object>} 업로드 결과 메타데이터
   */
  async function uploadBackup(token, payload) {
    const existingFile = await findBackupFile(token);
    const contentStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

    if (existingFile && existingFile.id) {
      // 기존 파일 내용 갱신 (PATCH)
      const patchUrl = `${DRIVE_UPLOAD_API}/${existingFile.id}?uploadType=media`;
      const res = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: contentStr
      });

      if (!res.ok) {
        throw new Error(`드라이브 백업 갱신 실패 (${res.status}): ${await res.text()}`);
      }
      return res.json();
    } else {
      // 신규 파일 생성 (Multipart POST)
      const metadata = {
        name: BACKUP_FILENAME,
        parents: ['appDataFolder']
      };

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        contentStr +
        closeDelim;

      const postUrl = `${DRIVE_UPLOAD_API}?uploadType=multipart`;
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!res.ok) {
        throw new Error(`드라이브 백업 생성 실패 (${res.status}): ${await res.text()}`);
      }
      return res.json();
    }
  }

  /**
   * appDataFolder에서 백업 파일 내용 다운로드
   * @param {string} token 
   * @param {string} fileId 
   * @returns {Promise<Object>} 다운로드된 JSON 객체 (암호화 패키지 또는 규칙 객체)
   */
  async function downloadBackup(token, fileId) {
    const url = `${DRIVE_API_FILES}/${fileId}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error(`드라이브 백업 다운로드 실패 (${res.status}): ${await res.text()}`);
    }

    return res.json();
  }

  /**
   * 로컬 규칙과 원격 규칙 스마트 병합 (Merge)
   * 타임스탬프(updatedAt 또는 createdAt)를 비교하여 최신 규칙 우선 반영
   * @param {Object} localRules 
   * @param {Object} remoteRules 
   * @returns {{ mergedRules: Object, addedCount: number, updatedCount: number, totalCount: number }}
   */
  function smartMergeRules(localRules = {}, remoteRules = {}) {
    const merged = { ...localRules };
    let addedCount = 0;
    let updatedCount = 0;

    for (const [key, remoteRule] of Object.entries(remoteRules)) {
      if (!merged[key]) {
        // 로컬에 없던 새로운 규칙 추가
        merged[key] = remoteRule;
        addedCount++;
      } else {
        // 양쪽 모두 존재하는 경우 타임스탬프 비교
        const localTime = merged[key].updatedAt || merged[key].createdAt || '';
        const remoteTime = remoteRule.updatedAt || remoteRule.createdAt || '';

        if (remoteTime > localTime) {
          merged[key] = remoteRule;
          updatedCount++;
        }
      }
    }

    return {
      mergedRules: merged,
      addedCount,
      updatedCount,
      totalCount: Object.keys(merged).length
    };
  }

  const DriveSync = {
    BACKUP_FILENAME,
    getAuthToken,
    getAuthTokenViaWebFlow,
    revokeToken,
    getUserInfo,
    findBackupFile,
    uploadBackup,
    downloadBackup,
    smartMergeRules
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DriveSync;
  } else {
    global.DriveSync = DriveSync;
  }
})(typeof self !== 'undefined' ? self : this);
