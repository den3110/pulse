import axios from "axios";
import { IProject } from "../models/Project";

interface AlertConfig {
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
}

export const sendDeploymentAlert = async (
  project: IProject,
  status: "success" | "failed",
  config?: AlertConfig,
) => {
  if (!config) return;

  const { slackWebhookUrl, discordWebhookUrl } = config;
  const isSuccess = status === "success";
  const color = isSuccess ? "#4ade80" : "#ef4444"; // Green for success, Red for failure
  const emoji = isSuccess ? "✅" : "❌";
  const statusText = isSuccess ? "Successful" : "Failed";

  const messageTitle = `${emoji} Deployment ${statusText}: ${project.name}`;
  const repoInfo = `${project.githubRepoOwner ? `${project.githubRepoOwner}/` : ""}${project.githubRepoName || project.name}`;
  const branchInfo = project.branch || "main";

  // --- Send to Discord ---
  if (discordWebhookUrl) {
    try {
      const discordPayload = {
        embeds: [
          {
            title: messageTitle,
            color: isSuccess ? 4906512 : 15668260, // Decimal color codes
            fields: [
              { name: "Project", value: project.name, inline: true },
              { name: "Environment", value: "Production", inline: true },
              { name: "Repository", value: repoInfo, inline: true },
              { name: "Branch", value: branchInfo, inline: true },
              { name: "Time", value: new Date().toUTCString(), inline: false },
            ],
            footer: {
              text: "Pulse Deployment Platform",
            },
          },
        ],
      };
      await axios.post(discordWebhookUrl, discordPayload);
    } catch (error) {
      console.error("Failed to send Discord alert:", error);
    }
  }

  // --- Send to Slack ---
  if (slackWebhookUrl) {
    try {
      const slackPayload = {
        attachments: [
          {
            color: color,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: messageTitle,
                  emoji: true,
                },
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Project:*\n${project.name}` },
                  { type: "mrkdwn", text: `*Environment:*\nProduction` },
                  { type: "mrkdwn", text: `*Repository:*\n${repoInfo}` },
                  { type: "mrkdwn", text: `*Branch:*\n${branchInfo}` },
                ],
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `*Time:* ${new Date().toUTCString()} | Pulse Deployment Platform`,
                  },
                ],
              },
            ],
          },
        ],
      };
      await axios.post(slackWebhookUrl, slackPayload);
    } catch (error) {
      console.error("Failed to send Slack alert:", error);
    }
  }
};

export const sendHealthAlert = async (
  project: IProject,
  status: "up" | "down",
  errorMsg: string,
  config?: AlertConfig,
) => {
  if (!config) return;

  const { slackWebhookUrl, discordWebhookUrl } = config;
  const isUp = status === "up";
  const colorHex = isUp ? "#3b82f6" : "#ef4444"; // Blue for online, Red for offline
  const discordColor = isUp ? 3900150 : 15668260; // Decimal representation
  const emoji = isUp ? "🟢" : "🔴";
  const statusText = isUp ? "is back ONLINE" : "is WENT OFFLINE";

  const messageTitle = `${emoji} Uptime Alert: ${project.name} ${statusText}`;
  const repoInfo = `${project.githubRepoOwner ? `${project.githubRepoOwner}/` : ""}${project.githubRepoName || project.name}`;

  // --- Send to Discord ---
  if (discordWebhookUrl) {
    try {
      const discordPayload = {
        embeds: [
          {
            title: messageTitle,
            color: discordColor,
            fields: [
              { name: "Project", value: project.name, inline: true },
              { name: "Environment", value: "Production", inline: true },
              { name: "Repository", value: repoInfo, inline: true },
              {
                name: "URL",
                value: project.healthCheck?.url || "Unknown",
                inline: false,
              },
              ...(isUp
                ? []
                : [
                    {
                      name: "Error",
                      value: errorMsg || "Connection timed out",
                      inline: false,
                    },
                  ]),
              { name: "Time", value: new Date().toUTCString(), inline: false },
            ],
            footer: {
              text: "Pulse Deployment Platform",
            },
          },
        ],
      };
      await axios.post(discordWebhookUrl, discordPayload);
    } catch (error) {
      console.error("Failed to send Discord health alert:", error);
    }
  }

  // --- Send to Slack ---
  if (slackWebhookUrl) {
    try {
      const slackFields = [
        { type: "mrkdwn", text: `*Project:*\n${project.name}` },
        { type: "mrkdwn", text: `*Environment:*\nProduction` },
        {
          type: "mrkdwn",
          text: `*URL:*\n${project.healthCheck?.url || "Unknown"}`,
        },
      ];

      if (!isUp) {
        slackFields.push({
          type: "mrkdwn",
          text: `*Error:*\n${errorMsg || "Connection timed out"}`,
        });
      }

      const slackPayload = {
        attachments: [
          {
            color: colorHex,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: messageTitle,
                  emoji: true,
                },
              },
              {
                type: "section",
                fields: slackFields,
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `*Time:* ${new Date().toUTCString()} | Pulse Deployment Platform`,
                  },
                ],
              },
            ],
          },
        ],
      };
      await axios.post(slackWebhookUrl, slackPayload);
    } catch (error) {
      console.error("Failed to send Slack health alert:", error);
    }
  }
};
