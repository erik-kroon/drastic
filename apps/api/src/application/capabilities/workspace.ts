import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  assignWork,
  coordination,
  deleteView,
  listAttention,
  listWork,
  saveView,
} from "../workspace";

export const workspaceCapabilities = {
  workspace_coordination: effectCapability(Capabilities.workspace_coordination, coordination),
  workspace_save_view: effectCapability(Capabilities.workspace_save_view, saveView),
  workspace_delete_view: effectCapability(Capabilities.workspace_delete_view, deleteView),
  workspace_assign_work: effectCapability(Capabilities.workspace_assign_work, assignWork),
  workspace_attention: effectCapability(Capabilities.workspace_attention, listAttention),
  workspace_list_work: effectCapability(Capabilities.workspace_list_work, listWork),
};
