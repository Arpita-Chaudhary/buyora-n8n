const { execSync } = require('child_process');
const fs = require('fs');

console.log('--- Cleaning Next.js and freeing ports ---');

// 1. Remove .next folder
if (fs.existsSync('./frontend/.next')) {
  console.log('Removing ./frontend/.next cache...');
  fs.rmSync('./frontend/.next', { recursive: true, force: true });
  console.log('✓ Successfully removed ./frontend/.next');
} else {
  console.log('No .next folder found.');
}

// 2. Kill processes on 3000, 3001, 5000
const ports = [3000, 3001, 5000];
ports.forEach((port) => {
  try {
    const output = execSync('netstat -ano | findstr LISTENING', { encoding: 'utf8' });
    output.split('\n').forEach((line) => {
      if (line.includes(':' + port + ' ')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && pid !== '0') {
          console.log('Killing PID ' + pid + ' on port ' + port);
          try {
            execSync('taskkill /F /PID ' + pid);
          } catch (_) {}
        }
      }
    });
  } catch (e) {
    // ignore
  }
});

console.log('--- Cleanup complete. Ready for clean npm run dev:all ---');
