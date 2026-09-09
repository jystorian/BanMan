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
   * @param {boolean} interactive 사용자 로그인 팝업 표시 여부
   * @returns {Promise<string>} Access Token
   */
  async function getAuthToken(interactive = true) {
    if (!chrome?.identity?.getAuthToken) {
      throw new Error('chrome.identity.getAuthToken API를 사용할 수 없습니다.');
    }

    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!token) {
          return reject(new Error('토큰 획득에 실패했습니다.'));
        }
        resolve(token);
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
   * @param {string} token 
   * @returns {Promise<{ email: string, name: string, picture: string }>}
   */
  async function getUserInfo(token) {
    const res = await fetch(USER_INFO_API, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`사용자 정보 조회 실패 (${res.status}): ${await res.text()}`);
    }
    return res.json();
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
