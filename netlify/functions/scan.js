import { runScan } from './lib/core.js';

export default async () => {
  try {
    const result = await runScan('scheduled');
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Scheduled scan failed:', err);
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  schedule: '*/15 * * * *',
};
