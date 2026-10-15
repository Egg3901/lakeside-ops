"use strict";
// Canonical names for the repository transfer; stored legacy receipts stay valid.
const GITHUB_OWNER = "lakesidegamedev";
function canonicalRepository(repository) {
  return String(repository).replace(/^(?:Egg3901|lakesidegamedev)\/(AHDGame|AHDClient|lakeside-operator|lakeside-ops)$/, `${GITHUB_OWNER}/$1`);
}
function canonicalGithubUrl(url) {
  return String(url).replace(/^https:\/\/github\.com\/((?:Egg3901|lakesidegamedev)\/(?:AHDGame|AHDClient|lakeside-operator|lakeside-ops))\//, (_, repository) => `https://github.com/${canonicalRepository(repository)}/`);
}
function repositoryName(name) {
  // A logical Keir source name targets the monorepo for new work. Existing
  // receipt URLs retain their repository identity and original PR numbers.
  return `${GITHUB_OWNER}/${name === "lakeside-operator" ? "lakeside-ops" : name}`;
}
const GAME_REPO = `${GITHUB_OWNER}/AHDGame`;
const CI_REPOSITORIES = [GAME_REPO, repositoryName("AHDClient")];
module.exports = { GITHUB_OWNER, GAME_REPO, CI_REPOSITORIES, canonicalRepository, canonicalGithubUrl, repositoryName };
