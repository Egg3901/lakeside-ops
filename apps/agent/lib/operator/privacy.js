"use strict";
// Owner DMs may contain operational paths needed to review an exact action.
// Credentials are still stripped. Public support uses the stricter redactor.
function ownerText(value) {
  return String(value || "")
    .replace(/\bahdk_[A-Za-z0-9_-]{8,}|\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]")
    .replace(/\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g, "[redacted]")
    .replace(/(mongodb(?:\+srv)?:\/\/)[^\s:@/]+:[^\s@/]+@/g, "$1[redacted]@")
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|_URI)=\S+/g, "[redacted]");
}
module.exports = { ownerText };
