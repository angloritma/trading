import axios from 'axios';
async function run() {
  const res = await axios.get('https://api.kraken.com/0/public/Ticker?pair=DOTUSD');
  console.log(res.data);
}
run();
