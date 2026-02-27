import mongoose, { Document, Schema } from "mongoose";
import crypto from "crypto";

export interface ISecret extends Document {
  name: string;
  value: string; // encrypted
  type: "env" | "key" | "token" | "password" | "certificate" | "other";
  description?: string;
  project?: mongoose.Types.ObjectId;
  server?: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  lastAccessedAt?: Date;
  lastRotatedAt?: Date;
  expiresAt?: Date;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ENCRYPTION_KEY =
  process.env.SECRET_ENCRYPTION_KEY || "pulse-default-32-byte-key-change!";
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) return text;
  const iv = Buffer.from(ivHex, "hex");
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const SecretSchema = new Schema<ISecret>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    type: {
      type: String,
      enum: ["env", "key", "token", "password", "certificate", "other"],
      default: "env",
    },
    description: String,
    project: { type: Schema.Types.ObjectId, ref: "Project" },
    server: { type: Schema.Types.ObjectId, ref: "Server" },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastAccessedAt: Date,
    lastRotatedAt: Date,
    expiresAt: Date,
    tags: [{ type: String }],
  },
  { timestamps: true },
);

// Encrypt before save
SecretSchema.pre("save", function (next) {
  if (this.isModified("value")) {
    this.value = encrypt(this.value);
  }
  next();
});

// Static methods for encryption
SecretSchema.statics.decrypt = decrypt;
SecretSchema.statics.encrypt = encrypt;

SecretSchema.index({ owner: 1, name: 1 });
SecretSchema.index({ project: 1 });
SecretSchema.index({ tags: 1 });

const Secret = mongoose.model<ISecret>("Secret", SecretSchema);

export { encrypt, decrypt };
export default Secret;
