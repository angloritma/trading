const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  await page.goto('http://localhost:3002/');
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Switching to LAPTOPUSD...');
  await page.evaluate(() => {
    selectToken('LAPTOPUSD');
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chart_laptop.png' });
  console.log('Done.');
  
  await browser.close();
})();
