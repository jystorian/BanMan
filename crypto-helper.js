// crypto-helper.js - Client-side Web Crypto API (AES-256-GCM + PBKDF2)
// Zero external dependencies. Works in Service Worker and DOM window contexts.

(function (global) {
  'use strict';

  function getCrypto() {
    if (typeof crypto !== 'undefined') return crypto;
    if (typeof self !== 'undefined' && self.crypto) return self.crypto;
    if (typeof window !== 'undefined' && window.crypto) return window.crypto;
    if (global.crypto) return global.crypto;
    return null;
  }

  function getSubtle() {
    const c = getCrypto();
    return c ? c.subtle : null;
  }

  // Base64 인코딩 / 디코딩 헬퍼
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') return btoa(binary);
    return Buffer.from(binary, 'binary').toString('base64');
  }

  function base64ToBuffer(base64) {
    let binary;
    if (typeof atob !== 'undefined') {
      binary = atob(base64);
    } else {
      binary = Buffer.from(base64, 'base64').toString('binary');
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // PBKDF2 키 유도 (Password + Salt -> AES-256 Key)
  async function deriveKey(passphrase, saltBuffer, iterations = 100000) {
    const subtle = getSubtle();
    if (!subtle) throw new Error('Web Crypto API not available');

    const enc = new TextEncoder();
    const passphraseKey = await subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: iterations,
        hash: 'SHA-256'
      },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 객체 또는 문자열 데이터를 마스터 비밀번호로 AES-256-GCM 암호화
   * @param {Object|string} data 
   * @param {string} passphrase 
   * @returns {Promise<Object>} 암호화 패키지 메타데이터 및 Base64 암호문
   */
  async function encryptData(data, passphrase) {
    const c = getCrypto();
    const subtle = getSubtle();
    if (!c || !subtle) throw new Error('Web Crypto API not available');
    if (!passphrase || typeof passphrase !== 'string') {
      throw new Error('Passphrase must be a non-empty string');
    }

    const plainStr = typeof data === 'string' ? data : JSON.stringify(data);
    const enc = new TextEncoder();
    const plainBytes = enc.encode(plainStr);

    // 16바이트 무작위 Salt & 12바이트 무작위 IV 생성
    const salt = c.getRandomValues(new Uint8Array(16));
    const iv = c.getRandomValues(new Uint8Array(12));

    const iterations = 100000;
    const key = await deriveKey(passphrase, salt, iterations);

    const ciphertextBuffer = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      plainBytes
    );

    return {
      version: 1,
      encrypted: true,
      algorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA256',
      iterations: iterations,
      salt: bufferToBase64(salt.buffer),
      iv: bufferToBase64(iv.buffer),
      ciphertext: bufferToBase64(ciphertextBuffer),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * 암호화 패키지를 마스터 비밀번호로 복호화
   * @param {Object} encryptedPackage 
   * @param {string} passphrase 
   * @returns {Promise<Object|string>} 복호화된 원본 객체 또는 문자열
   */
  async function decryptData(encryptedPackage, passphrase) {
    const subtle = getSubtle();
    if (!subtle) throw new Error('Web Crypto API not available');
    if (!encryptedPackage) throw new Error('No package to decrypt');

    // 암호화되지 않은 일반 데이터인 경우 그대로 반환
    if (!encryptedPackage.encrypted) {
      return encryptedPackage.rules || encryptedPackage;
    }

    if (!passphrase) {
      throw new Error('PASSPHRASE_REQUIRED');
    }

    const saltBuffer = base64ToBuffer(encryptedPackage.salt);
    const ivBuffer = base64ToBuffer(encryptedPackage.iv);
    const cipherBuffer = base64ToBuffer(encryptedPackage.ciphertext);
    const iterations = encryptedPackage.iterations || 100000;

    const key = await deriveKey(passphrase, saltBuffer, iterations);

    try {
      const decryptedBuffer = await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(ivBuffer)
        },
        key,
        cipherBuffer
      );

      const dec = new TextDecoder();
      const decryptedStr = dec.decode(decryptedBuffer);

      try {
        return JSON.parse(decryptedStr);
      } catch (e) {
        return decryptedStr;
      }
    } catch (err) {
      // AES-GCM 인증 태그 검증 실패 시 OperationError 발생 (비밀번호 불일치 또는 데이터 위변조)
      console.warn('Decryption failed. Invalid passphrase or corrupted data.', err);
      throw new Error('INVALID_PASSPHRASE');
    }
  }

  const CryptoHelper = {
    encryptData,
    decryptData,
    bufferToBase64,
    base64ToBuffer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CryptoHelper;
  } else {
    global.CryptoHelper = CryptoHelper;
  }
})(typeof self !== 'undefined' ? self : this);
