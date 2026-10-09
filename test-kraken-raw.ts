import axios from 'axios';
import * as https from 'https';
import { customLookup } from './src/common/custom-dns';

async function run() {
  const http = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true, lookup: customLookup })
  });
  const res = await http.get('https://api.kraken.com/0/public/OHLC', {
    params: { pair: 'DOTUSD', interval: 1440, since: 1791504000 }
  });
  console.log(JSON.stringify(res.data, null, 2));
}
run();
