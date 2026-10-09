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
        const series = chart.addLineSeries();
        series.setData([
          { time: 100, value: 1 },
          { time: 200, value: 2 },
          { time: 300, value: 3 }
        ]);
        series.setMarkers([
          { time: 200, position: 'aboveBar', color: 'red', shape: 'circle', text: '1' },
          { time: 200, position: 'belowBar', color: 'blue', shape: 'arrowUp', text: '2' }
        ]);
        console.log('Markers set successfully.');
      } catch (e) {
        console.log('Error:', e.message);
      }
    </script>
  `);
  
  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
