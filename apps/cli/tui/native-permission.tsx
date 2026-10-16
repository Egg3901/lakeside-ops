/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Permission } from "../native/contracts";
import { nativeRequest, nativeBridge } from "./native-client";

export function showNativePermission(api: TuiPluginApi, permission: Permission) {
  let settled = false;
  const finish = (option: string | null) => {
    if (settled) return;
    settled = true;
    void nativeRequest(nativeBridge(), "/permission", { id: permission.id, option }).catch(error => api.ui.toast({ variant: "error", message: error.message }));
    api.ui.dialog.clear();
  };
  api.ui.dialog.replace(() => <api.ui.DialogSelect title={permission.request.toolCall.title || "Backend permission"} options={permission.request.options.map(option => ({ title: option.name, value: option.optionId, description: option.kind }))} onSelect={option => finish(option.value)} />, () => finish(null));
}
