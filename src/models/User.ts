import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  role: "admin" | "viewer";
  refreshTokens?: string[];
  activeServer?: string;
  currentTeam?: mongoose.Types.ObjectId;
  githubId?: string;
  githubUsername?: string;
  githubAccessToken?: string;
  githubAvatarUrl?: string;
  googleId?: string;
  googleAvatarUrl?: string;
  planType: "free" | "pro" | "enterprise";
  stripeCustomerId?: string;
  subscriptionStatus: "active" | "past_due" | "canceled" | "trialing";
  twoFactorSecret?: string;
  isTwoFactorEnabled: boolean;
  alertPreferences?: {
    slackWebhookUrl?: string;
    discordWebhookUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "viewer"],
      default: "admin",
    },
    refreshTokens: {
      type: [String],
      select: false,
    },
    activeServer: {
      type: Schema.Types.ObjectId,
      ref: "Server",
    },
    currentTeam: {
      type: Schema.Types.ObjectId,
      ref: "Team",
    },
    githubId: {
      type: String,
      unique: true,
      sparse: true,
    },
    githubUsername: String,
    githubAccessToken: String,
    githubAvatarUrl: String,
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    googleAvatarUrl: String,
    planType: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
    stripeCustomerId: {
      type: String,
      sparse: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "past_due", "canceled", "trialing"],
      default: "active",
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },
    isTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    alertPreferences: {
      slackWebhookUrl: { type: String, trim: true },
      discordWebhookUrl: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
  },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>("User", userSchema);
