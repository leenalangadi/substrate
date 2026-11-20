// Renders public/og-image.png from scripts/og.html. Needs the dev server
// running (npm run dev) and Playwright with Chromium available.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const base = process.argv[2] || 'http://localhost:5173';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto(base + '/scripts/og.html');
  await p.waitForSelector('body[data-ready="1"]');
  await p.waitForTimeout(300);
  await (await p.$('#frame')).screenshot({ path: path.join(__dirname, '..', 'public', 'og-image.jpg'), type: 'jpeg', quality: 86 });
  await b.close();
})();
