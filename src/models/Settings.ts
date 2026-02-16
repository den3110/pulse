import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
  notifications: {
    discord: {
      enabled: boolean;
      webhookUrl: string;
    };
    slack: {
      enabled: boolean;
      webhookUrl: string;
    };
    telegram: {
      enabled: boolean;
      botToken: string;
      chatId: string;
    };
    events: {
      deploymentStarted: boolean;
      deploymentSuccess: boolean;
      deploymentFailed: boolean;
      serverOffline: boolean;
      serverOnline: boolean;
    };
  };
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    notifications: {
      discord: {
        enabled: { type: Boolean, default: false },
        webhookUrl: { type: String, default: "" },
      },
      slack: {
        enabled: { type: Boolean, default: false },
        webhookUrl: { type: String, default: "" },
      },
      telegram: {
        enabled: { type: Boolean, default: false },
        botToken: { type: String, default: "" },
        chatId: { type: String, default: "" },
      },
      events: {
        deploymentStarted: { type: Boolean, default: true },
        deploymentSuccess: { type: Boolean, default: true },
        deploymentFailed: { type: Boolean, default: true },
        serverOffline: { type: Boolean, default: true },
        serverOnline: { type: Boolean, default: true },
      },
    },
  },
  {
    timestamps: true,
  },
);

// Singleton settings (always use the first document)
export default mongoose.model<ISettings>("Settings", settingsSchema);
