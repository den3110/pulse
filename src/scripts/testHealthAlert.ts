import mongoose from "mongoose";
import * as dotenv from "dotenv";
import { sendHealthAlert } from "../services/alertService";
import Project, { IProject } from "../models/Project";

dotenv.config();

const testHealthAlert = async () => {
  try {
    // Create a mock project
    const mockProject = {
      name: "Test Uptime Project",
      repoUrl: "https://github.com/test/repo",
      branch: "main",
      server: new mongoose.Types.ObjectId(),
      deployPath: "/var/www/test",
      owner: new mongoose.Types.ObjectId(),
      healthCheck: {
        enabled: true,
        url: "https://example.com",
        interval: 60,
        lastStatus: "up",
      },
    };

    const isSuccess = await sendHealthAlert(
      mockProject as unknown as IProject,
      "down",
      "Manual test trigger down",
      {
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
      },
    );

    console.log("Health alert (down) sent:", isSuccess);

    const isSuccessUp = await sendHealthAlert(
      mockProject as unknown as IProject,
      "up",
      "Manual test trigger up (resolved)",
      {
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
      },
    );

    console.log("Health alert (up) sent:", isSuccessUp);
  } catch (err) {
    console.error("Test failed:", err);
  }
};

testHealthAlert();
