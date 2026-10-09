const http = require('http');
http.get('http://localhost:3002/api/chart/angloritma/ETHUSD?timeframe=1d', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Status code:', res.statusCode);
      console.log('Keys:', Object.keys(json));
      if (json.candles) console.log('Candles length:', json.candles.length);
      if (json.markers) console.log('Markers length:', json.markers.length);
    } catch(e) {
      console.log('Error parsing JSON:', e.message);
      console.log('Raw data:', data.substring(0, 500));
    }
  });
}).on('error', (e) => {
  console.log('HTTP error:', e.message);
});
