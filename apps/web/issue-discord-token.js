require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('dotenv').config({ path: require('path').join(__dirname, 'mcp-discord.env') });
const store = require('./knowledge-store');
const tokens = require('./agent-tokens');

(async () => {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);
  const { raw } = await tokens.issue(db, { name: 'discord-mcp', write: true, actor: 'hermes' });
  console.log('TOKEN=' + raw);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
