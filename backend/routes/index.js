const express = require("express");
const authRouter = require("./auth");
const vocabRouter = require("./vocab");
const sessionsRouter = require("./sessions");
const chatRouter = require("./chat");

const router = express.Router();

router.use("/auth", authRouter);
router.use("/vocab", vocabRouter);
router.use("/sessions", sessionsRouter);
router.use("/chat", chatRouter);

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

module.exports = router;
