const axios = require("axios");
const mongoose = require("mongoose");
const { Server } = require("./dist/models/Server");

async function test() {
  await mongoose.connect("mongodb://localhost:27017/manage-remote-deploy");
  const server = await Server.findOne({ status: "online" });

  if (!server) {
    console.log("No server found");
    process.exit(1);
  }

  console.log("Server ID:", server._id.toString());

  try {
    // We need an auth token for our local backend.
    // Let's just create a mock JWT or bypass it by hitting the proxy API via the backend if we can,
    // but the backend requires Auth. We can bypass auth for script by creating an admin token.
  } catch (e) {
    console.error(e);
  }
}

test();
