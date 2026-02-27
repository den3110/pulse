import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Secret, { decrypt } from "../models/Secret";

// POST /api/secrets — create a secret
export const createSecret = async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      value,
      type,
      description,
      projectId,
      serverId,
      tags,
      expiresAt,
    } = req.body;

    if (!name || !value) {
      res.status(400).json({ message: "Name and value are required" });
      return;
    }

    // Check duplicate name for this owner
    const exists = await Secret.findOne({
      owner: req.user?._id,
      name,
    });
    if (exists) {
      res.status(409).json({ message: `Secret "${name}" already exists` });
      return;
    }

    const secret = await Secret.create({
      name,
      value, // auto-encrypted by pre-save hook
      type: type || "env",
      description,
      project: projectId || undefined,
      server: serverId || undefined,
      owner: req.user?._id,
      tags: tags || [],
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    res.status(201).json({
      _id: secret._id,
      name: secret.name,
      type: secret.type,
      description: secret.description,
      tags: secret.tags,
      createdAt: secret.createdAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/secrets — list (metadata only, no values)
export const listSecrets = async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { owner: req.user?._id };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.projectId) filter.project = req.query.projectId;

    const secrets = await Secret.find(filter)
      .select("-value")
      .sort({ createdAt: -1 })
      .populate("project", "name")
      .populate("server", "name")
      .lean();

    res.json({ secrets });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/secrets/:id/reveal — reveal the decrypted value
export const revealSecret = async (req: AuthRequest, res: Response) => {
  try {
    const secret = await Secret.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });

    if (!secret) {
      res.status(404).json({ message: "Secret not found" });
      return;
    }

    // Update last accessed
    secret.lastAccessedAt = new Date();
    await secret.save();

    const decryptedValue = decrypt(secret.value);

    res.json({ value: decryptedValue });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/secrets/:id — update a secret
export const updateSecret = async (req: AuthRequest, res: Response) => {
  try {
    const secret = await Secret.findOne({
      _id: req.params.id,
      owner: req.user?._id,
    });

    if (!secret) {
      res.status(404).json({ message: "Secret not found" });
      return;
    }

    const {
      name,
      value,
      type,
      description,
      tags,
      projectId,
      serverId,
      expiresAt,
    } = req.body;

    if (name) secret.name = name;
    if (value) {
      secret.value = value; // will be encrypted by pre-save
      secret.lastRotatedAt = new Date();
    }
    if (type) secret.type = type;
    if (description !== undefined) secret.description = description;
    if (tags) secret.tags = tags;
    if (projectId !== undefined) secret.project = projectId || undefined;
    if (serverId !== undefined) secret.server = serverId || undefined;
    if (expiresAt !== undefined)
      secret.expiresAt = expiresAt ? new Date(expiresAt) : undefined;

    await secret.save();

    res.json({
      _id: secret._id,
      name: secret.name,
      type: secret.type,
      description: secret.description,
      tags: secret.tags,
      updatedAt: secret.updatedAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/secrets/:id
export const deleteSecret = async (req: AuthRequest, res: Response) => {
  try {
    const result = await Secret.findOneAndDelete({
      _id: req.params.id,
      owner: req.user?._id,
    });

    if (!result) {
      res.status(404).json({ message: "Secret not found" });
      return;
    }

    res.json({ message: "Secret deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
