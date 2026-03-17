const http = require("http");

const options = {
  hostname: "76.13.218.20",
  port: 8317,
  path: "/v0/management/auth-files/models?name=gemini-datistpham@gmail.com-schedule-6d78e.json",
  method: "GET",
  headers: {
    Authorization: "Bearer localadmin123",
  },
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    console.log(JSON.parse(data));
  });
});

req.on("error", (error) => {
  console.error(error);
});

req.end();
