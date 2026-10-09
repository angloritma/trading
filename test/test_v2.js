const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto('http://localhost:3002/');
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Switching to V2...');
  await page.evaluate(() => {
    document.getElementById('algorithmSelect').value = 'v2';
    toggleAlgoInputs();
    loadChartData();
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chart_v2.png' });
  
  console.log('Switching to ETHUSD...');
  await page.evaluate(() => {
    selectToken('ETHUSD');
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chart_v2_eth.png' });

  console.log('Done.');
  await browser.close();
})();
