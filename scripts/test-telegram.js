const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Import models
const SettingsSchema = new mongoose.Schema({
  notifications: {
    discord: { enabled: Boolean, webhookUrl: String },
    slack: { enabled: Boolean, webhookUrl: String },
    telegram: { enabled: Boolean, botToken: String, chatId: String },
    events: {
      deploymentStarted: { type: Boolean, default: true },
      deploymentSuccess: { type: Boolean, default: true },
      deploymentFailed: { type: Boolean, default: true },
    },
  },
});
const Settings = mongoose.model("Settings", SettingsSchema);

async function testTelegram() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected.");

    const settings = await Settings.findOne();
    if (!settings) {
      console.log("No settings found in DB!");
      return;
    }

    console.log("Settings loaded from DB:");
    console.log(JSON.stringify(settings.notifications.telegram, null, 2));
    console.log("Events enabled:", settings.notifications.events);

    const { botToken, chatId, enabled } = settings.notifications.telegram;

    if (!enabled) {
      console.log("❌ Telegram is disabled in settings.");
    }

    if (!botToken || !chatId) {
      console.log("❌ Missing botToken or chatId.");
    }

    if (enabled && botToken && chatId) {
      console.log("Attempting to send test message...");
      const axios = require("axios");
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      try {
        const res = await axios.post(url, {
          chat_id: chatId,
          text: "🔔 Test notification from Deploy Manager debug script.",
        });
        console.log("✅ Message sent successfully!", res.data);
      } catch (err) {
        console.error(
          "❌ Failed to send message:",
          err.response ? err.response.data : err.message,
        );
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

testTelegram();
