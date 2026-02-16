import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

// Load env from backend/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import User from "../models/User";

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/deploy-manager";

const ADMIN_USERNAME = process.argv[2] || "admin";
const ADMIN_EMAIL = process.argv[3] || "admin@deploy-manager.local";
const ADMIN_PASSWORD = process.argv[4] || "admin123";

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("[MongoDB] Connected");

    // Check if admin exists
    const existing = await User.findOne({
      $or: [{ username: ADMIN_USERNAME }, { email: ADMIN_EMAIL }],
    });

    if (existing) {
      console.log(`⚠️  User "${existing.username}" already exists. Skipping.`);
      process.exit(0);
    }

    const admin = await User.create({
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: "admin",
    });

    console.log("✅ Admin account created successfully!");
    console.log(`   Username: ${admin.username}`);
    console.log(`   Email:    ${admin.email}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   Role:     ${admin.role}`);

    process.exit(0);
  } catch (error: any) {
    console.error("❌ Failed to create admin:", error.message);
    process.exit(1);
  }
}

seed();
