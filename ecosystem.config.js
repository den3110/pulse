module.exports = {
  apps: [
    {
      name: "pulse-backend",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork", // Use "cluster" for load balancing if stateless
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
      },
    },
    {
      name: "pulse-backend-dev",
      script: "./src/index.ts",
      interpreter: "node",
      interpreter_args: "-r ts-node/register", // Use ts-node/register to run TS files
      instances: 1,
      autorestart: true,
      watch: ["src"],
      ignore_watch: ["node_modules", "logs", "dist"],
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
