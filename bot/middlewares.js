const express = require("express");

function setupMiddlewares(app) {
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(
    express.urlencoded({
      extended: true,
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
}

module.exports = setupMiddlewares;
