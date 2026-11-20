'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const sourceDir = path.resolve(__dirname, '..');
const parentDir = path.dirname(sourceDir);
const releaseOutputDir = path.join(parentDir, 'American-Pancakes-POS-Portable-Release');
const stagingDir = path.join(releaseOutputDir, 'American-Pancakes-POS-Portable');
const zipFilePath = path.join(releaseOutputDir, 'American-Pancakes-POS-v4-Portable.zip');

console.log('================================================================');
console.log('  Packaging Portable American Pancakes POS Distribution');
console.log('================================================================');
console.log('Source Directory: ', sourceDir);
console.log('Release Output:   ', releaseOutputDir);
console.log('Staging Folder:   ', stagingDir);
console.log('Final ZIP File:   ', zipFilePath);
console.log('----------------------------------------------------------------');

// 1. Checkpoint SQLite database so flo.db contains all transactions
console.log('[1/6] Checkpointing flo.db WAL journal...');
const dbPath = path.join(sourceDir, 'flo.db');
if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  db.pragma('wal_checkpoint(TRUNCATE)');
  const integrity = db.pragma('integrity_check');
  console.log('      flo.db integrity check:', integrity[0]?.integrity_check || 'ok');
  db.close();
} else {
  console.warn('      [WARNING] flo.db not found at', dbPath);
}

// 2. Prepare staging directory
console.log('[2/6] Preparing clean staging directory...');
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// 3. Define directory and file filter
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.husky',
  '.next',
  'dist',
  'backups',
  'scratch',
  '.turbo',
  '.cache',
  'test-results',
  'coverage',
]);

const EXCLUDE_FILES = new Set([
  'flo.db-wal',
  'flo.db-shm',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log',
  '.DS_Store',
  'Thumbs.db',
]);

let copiedFilesCount = 0;
let copiedBytesTotal = 0;

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const base = path.basename(src);
    if (EXCLUDE_DIRS.has(base)) {
      return;
    }
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(dst, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else if (stat.isFile()) {
    const base = path.basename(src);
    if (EXCLUDE_FILES.has(base) || base.endsWith('.tsbuildinfo') || base.endsWith('.log')) {
      return;
    }
    fs.copyFileSync(src, dst);
    copiedFilesCount++;
    copiedBytesTotal += stat.size;
  }
}

console.log('[3/6] Copying clean project source files...');
copyRecursive(sourceDir, stagingDir);

// Create database backup file in staging folder
if (fs.existsSync(path.join(stagingDir, 'flo.db'))) {
  fs.copyFileSync(path.join(stagingDir, 'flo.db'), path.join(stagingDir, 'flo.db.backup'));
  console.log('      Created flo.db.backup in staging folder');
}

// Ensure README.md in staging is the portable setup guide
if (fs.existsSync(path.join(stagingDir, 'README-PORTABLE.md'))) {
  fs.copyFileSync(path.join(stagingDir, 'README-PORTABLE.md'), path.join(stagingDir, 'README.md'));
  fs.copyFileSync(path.join(stagingDir, 'README-PORTABLE.md'), path.join(stagingDir, 'SETUP-GUIDE.md'));
}

console.log(`      Copied ${copiedFilesCount} files (${(copiedBytesTotal / (1024 * 1024)).toFixed(2)} MB)`);

// 4. Verify no secrets or excluded directories leaked into staging
console.log('[4/6] Auditing staging directory for unwanted files...');
let auditPass = true;
function auditDirectory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) {
        console.error('      [AUDIT FAIL] Forbidden directory leaked:', entry.name);
        auditPass = false;
      }
      auditDirectory(path.join(dir, entry.name));
    } else {
      if (entry.name.startsWith('.env') && entry.name !== '.env.example') {
        console.error('      [AUDIT FAIL] Potential secret leaked:', entry.name);
        auditPass = false;
      }
    }
  }
}
auditDirectory(stagingDir);
if (!auditPass) {
  throw new Error('Audit failed! Sensitive or unwanted files were found in staging directory.');
}
console.log('      Audit PASSED: No node_modules, build caches, git history, or .env files found.');

// 5. Create ZIP archive
console.log('[5/6] Creating ZIP archive...');
if (fs.existsSync(zipFilePath)) {
  fs.rmSync(zipFilePath, { force: true });
}

// Use PowerShell Compress-Archive for native, dependable Windows ZIP creation
const psScript = `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipFilePath}' -CompressionLevel Optimal`;
execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'inherit' });

const zipStats = fs.statSync(zipFilePath);
console.log(`      ZIP Archive created successfully: ${(zipStats.size / (1024 * 1024)).toFixed(2)} MB`);

// 6. Copy README to release folder as well for instant viewing
fs.copyFileSync(
  path.join(sourceDir, 'README-PORTABLE.md'),
  path.join(releaseOutputDir, 'README.md'),
);

console.log('----------------------------------------------------------------');
console.log('  PORTABLE PACKAGE CREATION COMPLETE!');
console.log('  Location: ', zipFilePath);
console.log('  Size:     ', (zipStats.size / (1024 * 1024)).toFixed(2), 'MB');
console.log('================================================================');
