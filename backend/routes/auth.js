const express = require("express");
const { body, header, validationResult } = require("express-validator");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("../services/supabase");

const router = express.Router();

function validationError(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }

  return res.status(400).json({ error: errors.array()[0].msg });
}

function authError(res, status, message) {
  return res.status(status).json({ error: message });
}

router.post(
  "/signup",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isString()
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("target_language")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("target_language is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const { email, password, target_language } = req.body;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return authError(res, 400, error.message);
    }

    if (!data.user) {
      return authError(res, 400, "Unable to create user");
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      target_language,
    });

    if (profileError) {
      return authError(res, 400, profileError.message);
    }

    return res.status(201).json({ user: data.user, session: data.session });
  }
);

router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isString()
      .notEmpty()
      .withMessage("Password is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return authError(res, 401, error.message);
    }

    return res.json({ user: data.user, session: data.session });
  }
);

router.post(
  "/logout",
  [
    header("authorization")
      .matches(/^Bearer\s+.+$/i)
      .withMessage("Authorization header with Bearer token is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const token = req.headers.authorization.split(" ")[1];

    const tokenClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const { error } = await tokenClient.auth.signOut();

    if (error) {
      return authError(res, 401, error.message);
    }

    return res.json({ message: "Logged out" });
  }
);

module.exports = router;
