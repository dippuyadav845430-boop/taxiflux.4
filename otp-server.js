/**
 * Minimal OTP backend for Taxiflux, wrapping apitxt.com's sendOTP API.
 *
 * Why this has to be a server, not client-side code in the app:
 * - Your APITXT_AUTH_KEY must never reach the browser. Anyone viewing the
 *   page's source could read it and send SMS on your account's bill.
 * - The OTP itself must be verified server-side too, otherwise anyone could
 *   open devtools and skip straight to "verified".
 *
 * Setup:
 *   npm install express axios dotenv
 *   Create a .env file next to this with:
 *     APITXT_AUTH_KEY=your_real_authkey
 *     APITXT_CHANNEL=your_channel
 *     APITXT_TEMPLATE_ID=your_template_id
 *     APITXT_COUNTRY=your_country
 *     APITXT_TEMPLATE_NAME=your_template_name
 *     APITXT_PROJECT_REF_ID=your_project_ref_id
 *   node otp-server.js
 *
 * The Taxiflux app's PhoneOtp component would then call:
 *   POST /api/send-otp   { mobile }        -> { ok: true }
 *   POST /api/verify-otp { mobile, otp }   -> { verified: true | false }
 * instead of generating and displaying the OTP on-screen.
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// In-memory store for the demo. Swap this for a real database table
// (with an expiry column) before using this for real — an in-memory map
// resets whenever the server restarts and doesn't scale past one process.
const otpStore = new Map(); // mobile -> { otp, expiresAt }

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

app.post("/api/send-otp", async (req, res) => {
  const { mobile } = req.body || {};
  if (!/^\d{10}$/.test(mobile || "")) {
    return res.status(400).json({ ok: false, error: "Enter a valid 10-digit mobile number." });
  }

  const otp = generateOtp();
  otpStore.set(mobile, { otp, expiresAt: Date.now() + OTP_TTL_MS });

  try {
    await axios.get("https://apitxt.com/api/sendOTP", {
      params: {
        authkey: process.env.APITXT_AUTH_KEY,
        mobile,
        otp,
        channel: process.env.APITXT_CHANNEL,
        template_id: process.env.APITXT_TEMPLATE_ID,
        country: process.env.APITXT_COUNTRY,
        template_name: process.env.APITXT_TEMPLATE_NAME,
        project_ref_id: process.env.APITXT_PROJECT_REF_ID,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("apitxt sendOTP failed:", err.response?.data || err.message);
    res.status(502).json({ ok: false, error: "Couldn't send the SMS. Try again shortly." });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { mobile, otp } = req.body || {};
  const entry = otpStore.get(mobile);

  if (!entry || Date.now() > entry.expiresAt) {
    otpStore.delete(mobile);
    return res.json({ verified: false, reason: "expired_or_not_sent" });
  }
  if (entry.otp !== otp) {
    return res.json({ verified: false, reason: "incorrect_code" });
  }

  otpStore.delete(mobile); // one-time use
  res.json({ verified: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OTP server running on port ${PORT}`));
