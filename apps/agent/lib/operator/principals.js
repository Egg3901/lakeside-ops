"use strict";
// Keir 3.0 principal resolver. Authority comes from who Discord says acted,
// never from text a model or player wrote. A principal is minted only here,
// from an id an authenticated surface vouched for: a message author, a
// button click stamped onto a bot-authored DM (decisions.js check()), or a
// slash-command user. EffectGate accepts only minted principals, so an
// object literal claiming { role: "owner" } is refused.
// Roles mirror the 2.x configuration: the owner; the delegate (first staff
// id), who may answer escalated decisions on the owner's behalf; other staff
// as developers; everyone else a player.

const minted = new WeakSet();
const VIA = ["message", "decision-button", "slash-command", "system"];

function createPrincipals(config) {
  const delegates = () => (config.staffIds || []).slice(0, 1);
  function rolesOf(id) {
    if (!id) return [];
    if (id === config.ownerId) return ["owner"];
    if (delegates().includes(id)) return ["delegate", "developer"];
    if ((config.staffIds || []).includes(id)) return ["developer"];
    if ((config.moderatorIds || []).includes(id)) return ["moderator"];
    if (id === config.botId) return ["system"];
    return ["player"];
  }
  function fromAuthenticated({ authorId, messageId = null, via }) {
    if (!authorId || !VIA.includes(via)) throw new Error("a principal needs an authenticated author and surface");
    const p = Object.freeze({ actor: authorId, roles: Object.freeze(rolesOf(authorId)), messageId, via });
    minted.add(p);
    return p;
  }
  return { rolesOf, fromAuthenticated };
}

const isAuthentic = (p) => Boolean(p) && minted.has(p);

module.exports = { createPrincipals, isAuthentic };
