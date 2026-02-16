import mongoose, { Document, Schema } from "mongoose";

export interface ISystemSetting extends Document {
  key: string;
  value: string;
  updatedAt: Date;
}

const systemSettingSchema = new Schema<ISystemSetting>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// Helper to get a setting value with default
systemSettingSchema.statics.getValue = async function (
  key: string,
  defaultValue: string = "",
): Promise<string> {
  const setting = await this.findOne({ key });
  return setting ? setting.value : defaultValue;
};

// Helper to set a setting value
systemSettingSchema.statics.setValue = async function (
  key: string,
  value: string,
): Promise<void> {
  await this.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
};

export default mongoose.model<ISystemSetting>(
  "SystemSetting",
  systemSettingSchema,
);
