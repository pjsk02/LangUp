const express = require("express");
const authRouter = require("./auth");
const vocabRouter = require("./vocab");
const sessionsRouter = require("./sessions");

const router = express.Router();

router.use("/auth", authRouter);
router.use("/vocab", vocabRouter);
router.use("/sessions", sessionsRouter);

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

module.exports = router;
