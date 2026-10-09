const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('http://localhost:3002/');
  
  // Wait for initial load
  await page.waitForNetworkIdle(2000);
  
  console.log('Switching to ETHUSD...');
  await page.evaluate(() => {
    selectToken('ETHUSD');
  });
  
  await page.waitForNetworkIdle(2000);
  console.log('Done.');
  
  await browser.close();
})();
