"use strict";

async function collectPersistedSessions(manager) {
  if (!manager) {
    return {
      sessions: [],
      warning: "Persisted chats are still connecting. Live agents are available.",
    };
  }
  try {
    return { sessions: await manager.listSessions(), warning: null };
  } catch (error) {
    return {
      sessions: [],
      warning: `Persisted chats are temporarily unavailable: ${error.message}`,
    };
  }
}

module.exports = { collectPersistedSessions };
