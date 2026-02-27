import { Router } from "express";
import { protect, requireTeamRole } from "../middleware/auth";
import * as secretController from "../controllers/secretController";

const router = Router();

router.use(protect);

// List secrets (metadata only)
router.get("/", secretController.listSecrets);

// Create secret
router.post(
  "/",
  requireTeamRole(["admin", "editor"]),
  secretController.createSecret,
);

// Reveal secret value
router.get("/:id/reveal", secretController.revealSecret);

// Update secret
router.put(
  "/:id",
  requireTeamRole(["admin", "editor"]),
  secretController.updateSecret,
);

// Delete secret
router.delete(
  "/:id",
  requireTeamRole(["admin"]),
  secretController.deleteSecret,
);

export default router;
