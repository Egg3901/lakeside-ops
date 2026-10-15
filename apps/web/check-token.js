require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('dotenv').config({ path: require('path').join(__dirname, 'mcp-discord.env') });
const store = require('./knowledge-store');
const tokens = require('./agent-tokens');

(async () => {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);
  const raw = 'ahdk_YYwci106VipKGIcWdP_e3k2uY9k_s5qh';
  const rec = await tokens.validate(db, 'Bearer ' + raw);
  console.log(JSON.stringify(rec, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
