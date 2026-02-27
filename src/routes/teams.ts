import express from "express";
import { protect } from "../middleware/auth";
import {
  getMyTeams,
  createTeam,
  switchTeam,
  inviteMember,
  getInvitations,
  removeInvitation,
  acceptInvite,
  removeMember,
  updateRole,
} from "../controllers/teamController";

const router = express.Router();

router.use(protect);

router.route("/").get(getMyTeams).post(createTeam);
router.route("/switch").post(switchTeam);
router.route("/accept-invite").post(acceptInvite);

router.route("/:id/invite").post(inviteMember).get(getInvitations);
router.route("/:id/invite/:inviteId").delete(removeInvitation);
router.route("/:id/members/:memberId").delete(removeMember).put(updateRole);

export default router;
