const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure().errorText));
  page.on('response', res => {
    if (res.status() === 404) console.log('404:', res.url());
  });
  
  await page.goto('http://localhost:3002/');
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Switching to ETHUSD...');
  await page.evaluate(() => {
    selectToken('ETHUSD');
  });
  
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done.');
  
  await browser.close();
})();
