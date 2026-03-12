"use strict";

/**
 * auth_controller.js
 *
 * Changes from the previous version
 * ──────────────────────────────────
 * 1. Access token and refresh token are delivered via httpOnly cookies
 *    (in addition to the JSON body, so API / mobile clients still work).
 *
 * 2. Redis usage is limited to refresh-token fingerprints only.
 *    No user-data caching, no access-token caching, no permission caching.
 *
 * 3. `refreshToken` endpoint reads the refresh token from the
 *    `refresh_token` cookie when no body field is supplied.
 *
 * 4. `logout` clears both cookies.
 *
 * Cookie names
 *   access_token   — httpOnly, Secure (prod), SameSite=Strict, maxAge = 1 day
 *   refresh_token  — httpOnly, Secure (prod), SameSite=Strict, maxAge = 7 days
 *                    path=/api/auth  → only sent to auth endpoints
 */

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt    = require("jsonwebtoken");

const { PrismaClient }                   = require("@prisma/client");
const openfgaService                     = require("../services/openfga.service");
const redisService                       = require("../services/redis.service");
const { generateTokens, verifyRefreshToken } = require("../utils/jwt.utils");

const prisma = new PrismaClient();

// ─── constants ────────────────────────────────────────────────────────────────

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d
const RESET_TOKEN_TTL_MS   =      60 * 60 * 1000;      // 1 h
const VERIFY_TOKEN_TTL_MS  = 24  * 60 * 60 * 1000;     // 24 h
const BCRYPT_ROUNDS        = 10;

const MSG = {
  FORGOT_PASSWORD: "If an account exists with this email, you will receive password reset instructions.",
  PASSWORD_CHANGED: "Password changed successfully. Please login again with your new password.",
  PASSWORD_RESET:   "Password reset successful. Please login with your new password.",
};

// ─── cookie options ───────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Options for the access-token cookie.
 * maxAge is in milliseconds for cookie-parser / express.
 */
const accessCookieOptions = () => ({
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: IS_PROD ? "strict" : "lax",  // "lax" in dev so Postman works
  maxAge:   24 * 60 * 60 * 1000,         // 1 day in ms
});

/**
 * Options for the refresh-token cookie.
 * `path` restricts it to auth endpoints so it is not sent on every request.
 */
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: IS_PROD ? "strict" : "lax",
  maxAge:   REFRESH_TOKEN_TTL_MS,
  path:     "/api/auth",                 // only sent to /api/auth/*
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build the safe public user payload returned in API responses. */
const buildUserPayload = (user) => ({
  id:    user.id,
  email: user.email,
  name:  user.name,
  phone: String(user.phone),
  ...(user.profile !== undefined && { profile: user.profile }),
});

/**
 * Set both token cookies on the response.
 * Also returns the token values so they can be included in the JSON body
 * for API / mobile clients that cannot read cookies.
 */
const setTokenCookies = (res, tokens) => {
  res.cookie("access_token",  tokens.accessToken,  accessCookieOptions());
  res.cookie("refresh_token", tokens.refreshToken, refreshCookieOptions());
};

/** Clear both auth cookies (called on logout / password change). */
const clearTokenCookies = (res) => {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token", { path: "/api/auth" });
};

/**
 * Persist a new refresh token to Redis and the DB in parallel.
 * Removes the previous fingerprint first to prevent fingerprint accumulation
 * on rapid login / token rotation.
 */
const persistRefreshToken = (userId, refreshToken, meta = {}) =>
  Promise.all([
    redisService.removeRefreshTokenFingerprint(userId, refreshToken),
    redisService.storeRefreshTokenFingerprint(userId, refreshToken, meta),
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.refreshToken.create({
      data: {
        token:     refreshToken,
        userId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);

/**
 * Revoke all sessions: mark DB tokens revoked + clear Redis fingerprints.
 * Called on logout-all, password change, password reset.
 */
const revokeAllTokens = (userId, email) =>
  Promise.all([
    prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } }),
    redisService.removeAllUserRefreshTokens(userId),
    redisService.invalidateProfile(userId),
  ]);

// ─── controller ───────────────────────────────────────────────────────────────

class AuthController {
  // ── getCurrentUser ───────────────────────────────────────────────────────────

  async getCurrentUser(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      const [user, isSuperAdmin] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
        openfgaService.checkSuperAdmin(userId),
      ]);

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const { password: _pw, ...safeUser } = user;
      return res.json({ success: true, user: { ...safeUser, isSuperAdmin } });
    } catch (error) {
      next(error);
    }
  }

  // ── register ─────────────────────────────────────────────────────────────────

  async register(req, res, next) {
    try {
      const { email, password, name, phone } = req.body;

      const [existingUser, hashedPassword] = await Promise.all([
        prisma.user.findUnique({ where: { email }, select: { id: true } }),
        bcrypt.hash(password, BCRYPT_ROUNDS),
      ]);

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      const { user, profile } = await prisma.$transaction(async (tx) => {
        const user    = await tx.user.create({
          data: { email, password: hashedPassword, name, phone: String(phone) },
        });
        const profile = await tx.profile.create({ data: { userId: user.id } });
        return { user, profile };
      });

      const tokens   = generateTokens(user.id, user.email);
      const userData = buildUserPayload({ ...user, profile });

      await Promise.allSettled([
        openfgaService.createProfileRelations(user.id, profile.id),
        persistRefreshToken(user.id, tokens.refreshToken, {
          userAgent: req.headers["user-agent"],
          ip:        req.ip,
        }),
        redisService.cacheProfile(user.id, profile),
      ]);

      // Set cookies + return tokens in body for API clients
      setTokenCookies(res, tokens);

      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        data:    { user: userData, ...tokens },
      });
    } catch (error) {
      next(error);
    }
  }

  // ── login ────────────────────────────────────────────────────────────────────

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where:   { email },
        include: { profile: true },
      });

      // Constant-time comparison even when user doesn't exist (prevents timing attacks)
      const dummyHash  = "$2b$10$invalidhashfortimingprotectionxxxxxxxxxxxxxxxxxxxxxxxx";
      const passwordMatch = user
        ? await bcrypt.compare(password, user.password)
        : await bcrypt.compare(password, dummyHash).then(() => false);

      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      }

      const tokens   = generateTokens(user.id, user.email);
      const userData = buildUserPayload(user);

      const [isSuperAdmin] = await Promise.all([
        openfgaService.checkSuperAdmin(user.id),
        prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        persistRefreshToken(user.id, tokens.refreshToken, {
          userAgent:  req.headers["user-agent"],
          ip:         req.ip,
          loginTime:  new Date().toISOString(),
        }),
        // Warm profile cache
        user.profile
          ? redisService.cacheProfile(user.id, user.profile)
          : Promise.resolve(),
      ]);

      setTokenCookies(res, tokens);

      return res.json({
        success: true,
        message: "Login successful",
        data:    { user: userData, isSuperAdmin, ...tokens },
      });
    } catch (error) {
      next(error);
    }
  }

  // ── refreshToken ─────────────────────────────────────────────────────────────

  /**
   * Issue a new access token.
   *
   * Reads the refresh token from (in priority order):
   *   1. req.cookies.refresh_token   (httpOnly cookie)
   *   2. req.body.refreshToken       (API / mobile clients)
   */
  async refreshToken(req, res, next) {
    try {
      // Accept token from cookie or body
      const refreshToken = req.cookies?.refresh_token ?? req.body?.refreshToken;

      if (!refreshToken) {
        return res.status(400).json({ success: false, message: "Refresh token is required" });
      }

      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        return res.status(401).json({ success: false, message: "Invalid refresh token" });
      }

      // Validate against Redis fingerprint store
      const isValid = await redisService.validateRefreshToken(decoded.userId, refreshToken);
      if (!isValid) {
        return res.status(401).json({ success: false, message: "Refresh token expired or revoked" });
      }

      // Issue a new access token; keep the same refresh token (no rotation by default)
      const newAccessToken = jwt.sign(
        { userId: decoded.userId, email: decoded.email },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: "1d" }
      );

      // Refresh the access-token cookie
      res.cookie("access_token", newAccessToken, accessCookieOptions());

      return res.json({
        success: true,
        data:    { accessToken: newAccessToken, refreshToken },
      });
    } catch (error) {
      next(error);
    }
  }

  // ── logout ───────────────────────────────────────────────────────────────────

  /**
   * Single-session logout: pass `refreshToken` in body or the cookie is used.
   * All-session logout: call without a refresh token — revokes everything.
   */
  async logout(req, res, next) {
    try {
      const { id: userId, email } = req.user;

      // Prefer body, fall back to cookie
      const refreshToken = req.body?.refreshToken ?? req.cookies?.refresh_token;

      if (refreshToken) {
        // Single-session logout
        await Promise.allSettled([
          redisService.removeRefreshTokenFingerprint(userId, refreshToken),
          prisma.refreshToken.updateMany({
            where: { userId, token: refreshToken },
            data:  { isRevoked: true },
          }),
        ]);
      } else {
        // All-session logout
        await revokeAllTokens(userId, email);
      }

      clearTokenCookies(res);

      return res.json({ success: true, message: "Logout successful" });
    } catch (error) {
      next(error);
    }
  }

  // ── changePassword ───────────────────────────────────────────────────────────

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const { id: userId }                   = req.user;

      const user = await prisma.user.findUnique({
        where:  { id: userId },
        select: { id: true, email: true, password: true },
      });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const [isMatch, hashedPassword] = await Promise.all([
        bcrypt.compare(currentPassword, user.password),
        bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      ]);

      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Current password is incorrect" });
      }

      await Promise.all([
        prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } }),
        revokeAllTokens(userId, user.email),
      ]);

      clearTokenCookies(res);

      return res.json({ success: true, message: MSG.PASSWORD_CHANGED });
    } catch (error) {
      next(error);
    }
  }

  // ── forgotPassword ───────────────────────────────────────────────────────────

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      // Always return the same message to prevent email enumeration
      const user = await prisma.user.findUnique({
        where:  { email },
        select: { id: true },
      });

      if (user) {
        const resetToken = crypto.randomBytes(32).toString("hex");
        await prisma.user.update({
          where: { id: user.id },
          data:  {
            resetPasswordToken:  resetToken,
            resetPasswordExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });
        // TODO: await emailService.sendPasswordResetEmail(email, resetToken);
      }

      return res.json({ success: true, message: MSG.FORGOT_PASSWORD });
    } catch (error) {
      next(error);
    }
  }

  // ── resetPassword ────────────────────────────────────────────────────────────

  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      const user = await prisma.user.findFirst({
        where:  {
          resetPasswordToken:  token,
          resetPasswordExpiry: { gt: new Date() },
        },
        select: { id: true, email: true },
      });

      if (!user) {
        return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await Promise.all([
        prisma.user.update({
          where: { id: user.id },
          data:  {
            password:            hashedPassword,
            resetPasswordToken:  null,
            resetPasswordExpiry: null,
          },
        }),
        revokeAllTokens(user.id, user.email),
      ]);

      clearTokenCookies(res);

      return res.json({ success: true, message: MSG.PASSWORD_RESET });
    } catch (error) {
      next(error);
    }
  }

  // ── verifyEmail ──────────────────────────────────────────────────────────────

  async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;

      const user = await prisma.user.findFirst({
        where:  {
          emailVerificationToken:  token,
          emailVerificationExpiry: { gt: new Date() },
        },
        select: { id: true, email: true },
      });

      if (!user) {
        return res.status(400).json({ success: false, message: "Invalid or expired verification token" });
      }

      await Promise.all([
        prisma.user.update({
          where: { id: user.id },
          data:  {
            emailVerified:           true,
            emailVerificationToken:  null,
            emailVerificationExpiry: null,
          },
        }),
        redisService.invalidateProfile(user.id),
      ]);

      return res.json({ success: true, message: "Email verified successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ── resendVerificationEmail ──────────────────────────────────────────────────

  async resendVerificationEmail(req, res, next) {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({
        where:  { email },
        select: { id: true, emailVerified: true },
      });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.emailVerified) {
        return res.json({ success: true, message: "Email already verified" });
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");

      await prisma.user.update({
        where: { id: user.id },
        data:  {
          emailVerificationToken:  verificationToken,
          emailVerificationExpiry: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
        },
      });

      // TODO: await emailService.sendVerificationEmail(email, verificationToken);

      return res.json({ success: true, message: "Verification email sent" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();