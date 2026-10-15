"use strict";

/**
 * An admin authorizes a guarded heal; the operator session executes it.
 * Automated ticket-repair sessions never receive that authorization and must
 * request a human decision through the support workflow instead.
 */
function requireAdminAuthorization(confirmAdminApply, { tool, auth }) {
  if (confirmAdminApply === true) return null;
  return {
    ok: false,
    error:
      `${tool} requires confirmAdminApply:true from an explicit admin request. ` +
      "A direct operator session may execute after that request. Unattended ticket-repair " +
      "sessions must use support_notify_ops_heal instead.",
    operator: auth && auth.name
  };
}

module.exports = { requireAdminAuthorization };
