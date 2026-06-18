const { runScan } = require('./lib/core');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const result = await runScan('manual');
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Manual scan failed:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: String((err && err.message) || err) }) };
  }
};
