import dotenv from "dotenv";
dotenv.config();

export default {
  port: parseInt(process.env.PORT || "5000", 10),
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/deploy-manager",
  jwtSecret: process.env.JWT_SECRET || "default-secret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "default-refresh-secret",
  jwtExpire: process.env.JWT_EXPIRE || "15m",
  jwtRefreshExpire: process.env.JWT_REFRESH_EXPIRE || "7d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
};
