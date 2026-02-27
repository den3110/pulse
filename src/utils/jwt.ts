import jwt from "jsonwebtoken";
import config from "../config";

export const generateTokens = (userId: string, role: string) => {
  const accessToken = jwt.sign({ id: userId, role }, config.jwtSecret, {
    expiresIn: "15m",
  });

  const refreshToken = jwt.sign({ id: userId, role }, config.jwtRefreshSecret, {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};
