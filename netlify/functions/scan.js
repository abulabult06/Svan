const { runScan } = require('./lib/core');

exports.handler = async () => {
  try {
    const result = await runScan('scheduled');
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Scheduled scan failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String((err && err.message) || err) }) };
  }
};
