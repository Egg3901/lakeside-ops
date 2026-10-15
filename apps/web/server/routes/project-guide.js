const fs = require('fs').promises;
const path = require('path');

const GUIDE_PATH = path.join(process.env.HOME || '/root', '.hermes', 'docs', 'PROJECT_GUIDE.md');

async function getProjectGuide(req, res) {
  try {
    const content = await fs.readFile(GUIDE_PATH, 'utf-8');
    const stats = await fs.stat(GUIDE_PATH);
    res.json({
      content,
      lastModified: stats.mtime.toISOString(),
      size: stats.size
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Project guide not found. Run the project-guide cron job first.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = { getProjectGuide };
