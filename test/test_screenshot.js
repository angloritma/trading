const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto('http://localhost:3002/');
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chart_btc.png' });
  
  console.log('Switching to ETHUSD...');
  await page.evaluate(() => {
    selectToken('ETHUSD');
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chart_eth.png' });
  console.log('Done.');
  
  await browser.close();
})();
