const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  
  await page.setContent(`
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <div id="chart" style="width: 400px; height: 300px;"></div>
    <script>
      try {
        const chart = LightweightCharts.createChart(document.getElementById('chart'));
        const series = chart.addCandlestickSeries();
        series.setData([
          { time: 100, open: 1, high: 2, low: 1, close: 2 },
          { time: 200, open: 2, high: 3, low: 1, close: 2 }
        ]);
        const pl = series.createPriceLine({ price: 2, color: 'red' });
        
        series.setData([
          { time: 300, open: 1, high: 2, low: 1, close: 2 }
        ]);
        
        console.log('Trying to remove price line...');
        series.removePriceLine(pl);
        console.log('Successfully removed price line after setData.');
      } catch (e) {
        console.log('Error:', e.message);
      }
    </script>
  `);
  
  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
