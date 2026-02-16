import mongoose, { Document, Schema } from "mongoose";

export interface IServer extends Document {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  passphrase?: string;
  status: "online" | "offline" | "unknown";
  lastCheckedAt?: Date;
  systemInfo?: {
    os?: string;
    cpu?: string;
    totalMemory?: string;
    diskTotal?: string;
  };
  owner: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const serverSchema = new Schema<IServer>(
  {
    name: {
      type: String,
      required: [true, "Server name is required"],
      trim: true,
    },
    host: {
      type: String,
      required: [true, "Host is required"],
      trim: true,
    },
    port: {
      type: Number,
      default: 22,
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
    },
    authType: {
      type: String,
      enum: ["password", "key"],
      default: "password",
    },
    password: {
      type: String,
      select: false,
    },
    privateKey: {
      type: String,
      select: false,
    },
    passphrase: {
      type: String,
      select: false,
    },
    status: {
      type: String,
      enum: ["online", "offline", "unknown"],
      default: "unknown",
    },
    lastCheckedAt: Date,
    systemInfo: {
      os: String,
      cpu: String,
      totalMemory: String,
      diskTotal: String,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IServer>("Server", serverSchema);
