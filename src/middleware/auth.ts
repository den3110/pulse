import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../config";
import User, { IUser } from "../models/User";
import fs from "fs";
import path from "path";

const logAuth = (msg: string) => {
  const logPath = path.join(process.cwd(), "debug_auth.log");
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
};

export interface AuthRequest extends Request {
  user?: IUser;
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // Fallback: accept token from query param (for SSE EventSource which can't set headers)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      res.status(401).json({ message: "Not authorized, no token" });
      return;
    }

    const decoded = jwt.verify(token, config.jwtSecret) as {
      id: string;
      role: string;
    };

    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401).json({ message: "Not authorized, user not found" });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Not authorized, token failed" });
  }
};

export const adminOnly = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Not authorized, admin only" });
  }
};

import Team from "../models/Team";

export const requireTeamRole = (roles: ("admin" | "editor" | "viewer")[]) => {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Not authorized" });
        return;
      }

      if (!req.user.currentTeam) {
        // If not acting within a team, assume personal workspace/admin
        next();
        return;
      }

      const team = await Team.findById(req.user.currentTeam);
      if (!team) {
        res.status(403).json({ message: "Team not found" });
        return;
      }

      // Check if user is owner
      if (team.owner.toString() === req.user.id.toString()) {
        next();
        return;
      }

      // Check if user is member with specific role
      const member = team.members.find(
        (m) => m.user.toString() === req.user?.id.toString(),
      );
      if (!member) {
        res.status(403).json({ message: "Not a member of this team" });
        return;
      }

      if (!roles.includes(member.role as "admin" | "editor" | "viewer")) {
        res
          .status(403)
          .json({ message: `Requires one of roles: ${roles.join(", ")}` });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ message: "Server error checking team role" });
    }
  };
};
