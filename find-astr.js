const https = require('https');
https.get('https://api.kraken.com/0/public/AssetPairs', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const json = JSON.parse(data);
    const keys = Object.keys(json.result);
    console.log(keys.filter(k => k.includes('ASTR') || json.result[k].altname.includes('ASTR')));
  });
}).on('error', e => console.error(e));
