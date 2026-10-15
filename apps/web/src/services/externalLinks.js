"use strict";

/**
 * External / observability link registry — driven by config.externalLinks.
 */

const { getConfig } = require("../core/config");

function listExternalLinks(group) {
  const links = getConfig().externalLinks || [];
  return links.filter((l) => !group || l.group === group);
}

function linkById(id) {
  return (getConfig().externalLinks || []).find((l) => l.id === id) || null;
}

module.exports = { listExternalLinks, linkById };
