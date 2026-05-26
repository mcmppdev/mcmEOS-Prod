const app = require("./src/app");
const { port } = require("./src/config/env");

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`MCM web app listening on http://localhost:${port}`);
  });
}

module.exports = app;
