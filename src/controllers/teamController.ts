import mongoose from "mongoose";
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Team from "../models/Team";
import User from "../models/User";
import Invitation from "../models/Invitation";
import crypto from "crypto";
// import emailService from "../services/emailService"; // Assuming you have an email service to send invites

export const getMyTeams = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    // Find teams where user is owner or member
    const teams = await Team.find({
      $or: [{ owner: userId }, { "members.user": userId }],
    })
      .populate("owner", "username email")
      .populate("members.user", "username email");

    res.json({ teams });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createTeam = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { name } = req.body;
    const userId = req.user?._id;

    const team = await Team.create({
      name,
      owner: userId,
      members: [],
    });

    // Optionally set this as their current team if they don't have one
    if (!req.user?.currentTeam) {
      await User.findByIdAndUpdate(userId, { currentTeam: team._id });
    }

    res.status(201).json(team);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const switchTeam = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { teamId } = req.body;
    const userId = req.user?._id;

    if (!teamId) {
      // Switch back to personal workspace
      await User.findByIdAndUpdate(userId, { $unset: { currentTeam: 1 } });
      res.json({ message: "Switched to personal workspace" });
      return;
    }

    // Verify they belong to this team
    const team = await Team.findOne({
      _id: teamId,
      $or: [{ owner: userId }, { "members.user": userId }],
    });

    if (!team) {
      res.status(403).json({ message: "Not a member of this team" });
      return;
    }

    await User.findByIdAndUpdate(userId, { currentTeam: teamId });
    res.json({ message: "Switched team", team });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const inviteMember = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { email, role } = req.body;
    const teamId = req.params.id;

    const team = await Team.findById(teamId);
    if (!team) {
      res.status(404).json({ message: "Team not found" });
      return;
    }

    // Must be owner or admin
    const isOwner = team.owner.toString() === req.user?.id.toString();
    const isMemberAdmin = team.members.some(
      (m) =>
        m.user.toString() === req.user?.id.toString() && m.role === "admin",
    );

    if (!isOwner && !isMemberAdmin) {
      res.status(403).json({ message: "Only admins can invite members" });
      return;
    }

    // Check if user is already in team
    const checkUser = await User.findOne({ email });
    if (checkUser) {
      if (
        team.owner.toString() === checkUser._id.toString() ||
        team.members.some((m) => m.user.toString() === checkUser._id.toString())
      ) {
        res.status(400).json({ message: "User is already in the team" });
        return;
      }
    }

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await Invitation.create({
      email,
      team: teamId,
      role: role || "viewer",
      token,
      expiresAt,
    });

    // TODO: Send email
    // const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite?token=${token}`;
    // await emailService.sendInviteEmail(email, team.name, inviteUrl);

    res.status(201).json({ message: "Invitation created", invite });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getInvitations = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const teamId = req.params.id;
    const invites = await Invitation.find({ team: teamId });
    res.json({ invites });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const removeInvitation = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const inviteId = req.params.inviteId;
    await Invitation.findByIdAndDelete(inviteId);
    res.json({ message: "Invitation removed" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const acceptInvite = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { token } = req.body;
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ message: "Not authorized" });
      return;
    }

    const invite = await Invitation.findOne({ token });
    if (!invite) {
      res.status(400).json({ message: "Invalid or expired invitation token" });
      return;
    }

    // Verify email matches logged in user or allow any logged in user?
    // Usually strict mapping:
    const authUser = await User.findById(userId);
    if (authUser?.email.toLowerCase() !== invite.email.toLowerCase()) {
      res
        .status(403)
        .json({ message: "This invite was sent to a different email address" });
      return;
    }

    const team = await Team.findById(invite.team);
    if (!team) {
      res.status(404).json({ message: "Team no longer exists" });
      return;
    }

    // Add to members
    team.members.push({
      user: userId as mongoose.Types.ObjectId,
      role: invite.role as "admin" | "editor" | "viewer",
    });
    await team.save();

    // Delete invite
    await Invitation.findByIdAndDelete(invite._id);

    // Auto set current team
    await User.findByIdAndUpdate(userId, { currentTeam: team._id });

    res.json({ message: "Joined team successfully", team });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const removeMember = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id: teamId, memberId } = req.params;
    const userId = req.user?._id;

    const team = await Team.findById(teamId);
    if (!team) {
      res.status(404).json({ message: "Team not found" });
      return;
    }

    const isOwner = team.owner.toString() === userId?.toString();
    const isMemberAdmin = team.members.some(
      (m) => m.user.toString() === userId?.toString() && m.role === "admin",
    );
    const isSelf = memberId === userId?.toString();

    if (!isOwner && !isMemberAdmin && !isSelf) {
      res.status(403).json({ message: "Not authorized to remove members" });
      return;
    }

    team.members = team.members.filter((m) => m.user.toString() !== memberId);
    await team.save();

    // If removed member was currently using this team, switch them out
    await User.updateOne(
      { _id: memberId, currentTeam: teamId },
      { $unset: { currentTeam: 1 } },
    );

    res.json({ message: "Member removed", team });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateRole = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id: teamId, memberId } = req.params;
    const { role } = req.body;
    const userId = req.user?._id;

    const team = await Team.findById(teamId);
    if (!team) {
      res.status(404).json({ message: "Team not found" });
      return;
    }

    const isOwner = team.owner.toString() === userId?.toString();
    const isMemberAdmin = team.members.some(
      (m) => m.user.toString() === userId?.toString() && m.role === "admin",
    );

    if (!isOwner && !isMemberAdmin) {
      res.status(403).json({ message: "Only admins can update roles" });
      return;
    }

    const memberIndex = team.members.findIndex(
      (m) => m.user.toString() === memberId,
    );
    if (memberIndex === -1) {
      res.status(404).json({ message: "Member not found" });
      return;
    }

    team.members[memberIndex].role = role;
    await team.save();

    res.json({ message: "Role updated", team });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
