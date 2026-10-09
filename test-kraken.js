const https = require('https');
https.get('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const json = JSON.parse(data);
    const keys = Object.keys(json.result);
    const key = keys.find(k => k !== 'last');
    console.log(key, json.result[key].length);
  });
}).on('error', e => console.error(e));
