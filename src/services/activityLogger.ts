import ActivityLog from "../models/ActivityLog";

interface LogParams {
  action: string;
  userId?: string;
  username?: string;
  details: string;
  ip?: string;
}

export const logActivity = async (params: LogParams): Promise<void> => {
  try {
    await ActivityLog.create(params);
  } catch (err) {
    console.error("[ActivityLogger] Failed to log activity:", err);
  }
};

export default { logActivity };
