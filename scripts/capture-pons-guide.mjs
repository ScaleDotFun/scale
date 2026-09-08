// Capture real PONS launchpad screenshots for the /list guide.
//
// The listing guide has to show creators the actual screen they will be
// looking at, so these are captured from the live launchpad rather than
// drawn. Re-run when PONS changes its UI:
//   node scripts/capture-pons-guide.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'apps/web/public/guide';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 1500 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});

await page.goto('https://ponsfamily.com/launchpad/create', { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(4000);

// Dismiss the status banner if present so it does not dominate the shot.
for (const sel of ['button[aria-label="Close"]', 'button:has-text("×")']) {
  try { await page.locator(sel).first().click({ timeout: 1500 }); } catch { /* not present */ }
}
await page.waitForTimeout(500);

// 1) The launch form as a creator first sees it.
const form = page.locator('text=Launch token').first();
const card = form.locator('xpath=ancestor::*[self::div][3]');
try {
  await card.screenshot({ path: `${OUT}/pons-launch-form.png` });
  console.log('saved pons-launch-form.png');
} catch {
  await page.screenshot({ path: `${OUT}/pons-launch-form.png`, clip: { x: 60, y: 90, width: 620, height: 700 } });
  console.log('saved pons-launch-form.png (clipped fallback)');
}

// 2) Advanced expanded — the creator-fee routing that the listing gate checks.
try {
  await page.locator('text=Advanced').first().click();
  await page.waitForTimeout(1500);
} catch { console.log('could not expand Advanced'); }

try {
  const adv = page.locator('text=Creator wallet').first();
  await adv.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await adv.boundingBox();
  if (box) {
    // Clip from the form column's left edge, not the label's — the field
    // labels sit left of the input and were being cut off.
    await page.screenshot({
      path: `${OUT}/pons-creator-wallet.png`,
      clip: {
        x: 100,
        y: Math.max(0, box.y - 150),
        width: 640,
        height: 400,
      },
    });
    console.log('saved pons-creator-wallet.png');
  }
} catch (e) {
  console.log('creator-wallet capture failed:', e.message.slice(0, 80));
}

await browser.close();
