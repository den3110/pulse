const http = require("http");

http.get("http://localhost:5012/api/servers", {
  headers: {
    Authorization: "Bearer " + process.env.TOKEN, // We need a token, this is too complex.
  },
});
