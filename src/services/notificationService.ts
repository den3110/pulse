import axios from "axios";
import Settings from "../models/Settings";

export type NotificationType =
  | "deployment_started"
  | "deployment_success"
  | "deployment_failed"
  | "server_offline"
  | "server_online"
  | "test_notification";

export interface NotificationPayload {
  title: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
  fields?: { name: string; value: string; inline?: boolean }[];
  url?: string;
  commit?: {
    hash: string;
    message: string;
    author: string;
    url?: string;
  };
  buildTime?: string;
  project?: string;
}

class NotificationService {
  private async getSettings() {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    return settings;
  }

  async send(eventType: NotificationType, payload: NotificationPayload) {
    try {
      const settings = await this.getSettings();
      const { notifications } = settings;

      // Check if event is enabled
      const eventKey = eventType.replace(/_([a-z])/g, (g) =>
        g[1].toUpperCase(),
      ) as keyof typeof notifications.events;

      // Allow test notifications even if disabled in events (or add a specific event key if we want)
      if (
        eventType !== "test_notification" &&
        !notifications.events[eventKey]
      ) {
        return;
      }

      const promises = [];

      if (notifications.discord.enabled && notifications.discord.webhookUrl) {
        promises.push(
          this.sendDiscord(notifications.discord.webhookUrl, payload),
        );
      }

      if (notifications.slack.enabled && notifications.slack.webhookUrl) {
        promises.push(this.sendSlack(notifications.slack.webhookUrl, payload));
      }

      // Debug settings
      console.log(
        "[Notification] Settings loaded:",
        JSON.stringify({
          telegram: {
            enabled: notifications.telegram.enabled,
            hasToken: !!notifications.telegram.botToken,
            hasChatId: !!notifications.telegram.chatId,
          },
          event: eventType,
          eventEnabled: notifications.events[eventKey],
        }),
      );

      if (
        notifications.telegram.enabled &&
        notifications.telegram.botToken &&
        notifications.telegram.chatId
      ) {
        promises.push(
          this.sendTelegram(
            notifications.telegram.botToken,
            notifications.telegram.chatId,
            payload,
          ),
        );
      }

      await Promise.allSettled(promises);
    } catch (error) {
      console.error("[Notification] Failed to send notifications:", error);
    }
  }

  private async sendDiscord(webhookUrl: string, payload: NotificationPayload) {
    const colorMap = {
      info: 3447003, // Blue
      success: 5763719, // Green
      error: 15548997, // Red
      warning: 16776960, // Yellow
    };

    const fields = [...(payload.fields || [])];

    if (payload.commit) {
      fields.push({
        name: "Run By",
        value: payload.commit.author,
        inline: true,
      });
      fields.push({
        name: "Commit",
        value: `[${payload.commit.hash.substring(0, 7)}](${payload.commit.url || "#"}) - ${payload.commit.message}`,
        inline: false,
      });
    }

    if (payload.buildTime) {
      fields.push({ name: "Duration", value: payload.buildTime, inline: true });
    }

    const embed = {
      title: `${payload.type === "success" ? "✅" : payload.type === "error" ? "❌" : "ℹ️"} ${payload.title}`,
      description: payload.message,
      color: colorMap[payload.type],
      fields: fields,
      url: payload.url,
      footer: {
        text: `Pulse • ${new Date().toLocaleString()}`,
      },
    };

    await axios.post(webhookUrl, {
      embeds: [embed],
    });
  }

  private async sendSlack(webhookUrl: string, payload: NotificationPayload) {
    // ... existing Slack logic, but can be improved similarly if needed ...
    // For now keeping it simple as user asked specifically about "simple message" which implies Telegram context mainly but affects all.
    // Let's improve it slightly.
    const colorMap = {
      info: "#36a64f",
      success: "#2eb886",
      error: "#a30200",
      warning: "#daa038",
    };

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${payload.type === "success" ? "✅" : payload.type === "error" ? "❌" : "ℹ️"} ${payload.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: payload.message,
        },
      },
    ];

    if (payload.commit) {
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Author:*\n${payload.commit.author}` },
          {
            type: "mrkdwn",
            text: `*Commit:*\n<${payload.commit.url}|${payload.commit.hash.substring(0, 7)}> - ${payload.commit.message}`,
          },
        ],
      });
    }

    const attachment = {
      color: colorMap[payload.type],
      blocks: blocks,
    };

    await axios.post(webhookUrl, { attachments: [attachment] });
  }

  private async sendTelegram(
    token: string,
    chatId: string,
    payload: NotificationPayload,
  ) {
    const icon =
      payload.type === "success"
        ? "✅"
        : payload.type === "error"
          ? "❌"
          : "ℹ️";

    let text = `<b>${icon} ${payload.title}</b>\n\n`;
    text += `<i>${payload.message}</i>\n\n`;

    if (payload.project) {
      text += `📦 <b>Project:</b> ${payload.project}\n`;
    }

    if (payload.commit) {
      text += `👤 <b>Author:</b> ${payload.commit.author}\n`;
      text += `🔗 <b>Commit:</b> <a href="${payload.commit.url || "#"}">${payload.commit.hash.substring(0, 7)}</a>\n`;
      text += `📝 <b>Message:</b> ${payload.commit.message}\n`;
    }

    if (payload.buildTime) {
      text += `⏱ <b>Duration:</b> ${payload.buildTime}\n`;
    }

    // Add custom fields
    if (payload.fields && payload.fields.length > 0) {
      text += `\n`;
      payload.fields.forEach((f) => {
        text += `🔹 <b>${f.name}:</b> ${f.value}\n`;
      });
    }

    text += `\n🚀 <i>Powered by Pulse</i>`;

    const body: any = {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    // Inline keyboard for "View Details"
    if (payload.url) {
      body.reply_markup = {
        inline_keyboard: [[{ text: "🔍 View Deployment", url: payload.url }]],
      };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, body);
  }
}

export default new NotificationService();
