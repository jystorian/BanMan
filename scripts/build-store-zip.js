// scripts/build-store-zip.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const filesToInclude = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'crypto-helper.js',
  'drive-sync.js',
  'i18n.js',
  'icons',
  'resources',
  'pages',
  'popup'
];

const tempDir = path.join(distDir, 'temp_package');
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const f of filesToInclude) {
  const srcPath = path.join(rootDir, f);
  if (fs.existsSync(srcPath)) {
    if (f === 'manifest.json') {
      const manifestData = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
      delete manifestData.key; // 웹스토어 업로드 시에는 구글이 키를 자동 서명하므로 key 필드 제외 필수
      fs.writeFileSync(path.join(tempDir, f), JSON.stringify(manifestData, null, 2), 'utf8');
    } else {
      copyRecursive(srcPath, path.join(tempDir, f));
    }
  }
}

const zipPath = path.join(distDir, 'BanMan-v1.0.0-store.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Run PowerShell Compress-Archive
const pwshCmd = `Compress-Archive -Path "${tempDir}/*" -DestinationPath "${zipPath}" -Force`;
execSync(`powershell -NoProfile -Command "${pwshCmd}"`);

fs.rmSync(tempDir, { recursive: true, force: true });
const stats = fs.statSync(zipPath);
console.log(`✅ STORE ZIP CREATED SUCCESSFULLY: ${zipPath} (${(stats.size / 1024).toFixed(1)} KB)`);
