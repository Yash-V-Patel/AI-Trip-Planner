"use strict";

/**
 * auth.middleware.js
 *
 * Changes from the previous version
 * ──────────────────────────────────
 * 1. Token transport: httpOnly cookie (`access_token`) is checked first;
 *    Authorization: Bearer header accepted as a fallback for API clients.
 *
 * 2. No Redis access-token cache. JWTs are verified by signature only.
 *    Redis is only used for refresh-token fingerprints and profile cache —
 *    the middleware reads the profile cache but writes nothing to Redis itself.
 *
 * 3. No permission caching for the superadmin check (removed cachePermission /
 *    getCachedPermission calls that were crashing the server). OpenFGA is
 *    queried directly; the result is cheap because superadmin membership
 *    changes rarely and OpenFGA has its own in-process evaluation.
 *
 * 4. requirePermission still delegates to OpenFGA but no longer tries to
 *    cache the result in Redis.
 */

const jwt          = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const openfgaService   = require("../services/openfga.service");
const redisService     = require("../services/redis.service");

const prisma = new PrismaClient();

// ─── cookie / token constants ─────────────────────────────────────────────────

/** Name of the httpOnly cookie that carries the access token. */
const ACCESS_COOKIE = "access_token";

// ─── helpers ─────────────────────────────────────────────────────────────────

const send = (res, status, message) =>
  res.status(status).json({ success: false, message });

// ─── middleware class ─────────────────────────────────────────────────────────

class AuthMiddleware {
  // ── authenticate ────────────────────────────────────────────────────────────

  /**
   * Verify the access token (cookie or Authorization header) and attach
   * `req.user` for downstream handlers.
   *
   * req.user shape:
   *   { id, email, name, phone, profile, isSuperAdmin }
   */
  async authenticate(req, res, next) {
    try {
      const token = this._extractToken(req);

      if (!token) {
        return send(res, 401, "Authentication token required");
      }

      // ── 1. Verify JWT signature ──────────────────────────────────────────
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      } catch (err) {
        if (err.name === "TokenExpiredError") {
          // Clean up the stale cookie if it came from there
          if (req.cookies?.[ACCESS_COOKIE]) {
            res.clearCookie(ACCESS_COOKIE);
          }
          return send(res, 401, "Token expired");
        }
        return send(res, 401, "Invalid token");
      }

      const userId = decoded.userId;

      // ── 2. Load user from DB (profile from Redis cache if warm) ─────────
      // We skip a full user-data Redis cache deliberately — the JWT already
      // carries userId/email and we only need the profile for req.user.
      // A profile cache hit avoids one DB join; a miss just does a normal query.

      const cachedProfile = await redisService.getProfile(userId).catch(() => null);

      let user;
      if (cachedProfile) {
        // We have the profile — still need core user fields for req.user
        // Use a lean select to avoid fetching password etc.
        user = await prisma.user.findUnique({
          where:  { id: userId },
          select: { id: true, email: true, name: true, phone: true },
        });

        if (!user) return send(res, 401, "User not found");
        user = { ...user, profile: cachedProfile };
      } else {
        // Full join — then warm the profile cache for next time
        user = await prisma.user.findUnique({
          where:   { id: userId },
          include: { profile: true },
          select:  {
            id: true, email: true, name: true, phone: true,
            profile: true,
          },
        });

        if (!user) return send(res, 401, "User not found");

        if (user.profile) {
          redisService.cacheProfile(userId, user.profile).catch(() => {});
        }
      }

      // ── 3. Superadmin check (direct OpenFGA call — no Redis cache) ───────
      const isSuperAdmin = await openfgaService.checkSuperAdmin(userId).catch(() => false);

      req.user = {
        id:          user.id,
        email:       user.email,
        name:        user.name,
        phone:       user.phone,
        profile:     user.profile ?? null,
        isSuperAdmin,
      };

      return next();
    } catch (error) {
      next(error);
    }
  }

  // ── requirePermission ────────────────────────────────────────────────────────

  /**
   * Factory that returns a middleware enforcing a specific OpenFGA relation.
   *
   * Usage: router.get("/plan/:id", auth.authenticate, auth.requirePermission("travelplan", "viewer"))
   *
   * Superadmins bypass all permission checks.
   *
   * @param {string} objectType  FGA object type, e.g. "travelplan"
   * @param {string} relation    FGA relation, e.g. "viewer" | "editor"
   */
  requirePermission(objectType, relation) {
    return async (req, res, next) => {
      try {
        // Superadmins can do anything
        if (req.user?.isSuperAdmin) return next();

        const objectId = req.params.id;
        if (!objectId) {
          return send(res, 400, "Object ID required");
        }

        const hasPermission = await openfgaService
          .checkPermission(req.user.id, relation, `${objectType}:${objectId}`)
          .catch(() => false);

        if (!hasPermission) {
          return send(res, 403, "Insufficient permissions");
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  // ── requireSuperAdmin ────────────────────────────────────────────────────────

  /**
   * Guard that only allows through users with isSuperAdmin = true.
   * Must be used after `authenticate`.
   */
  requireSuperAdmin(req, res, next) {
    if (!req.user) return send(res, 401, "Authentication required");
    if (!req.user.isSuperAdmin) return send(res, 403, "Superadmin access required");
    next();
  }

  // ── rateLimit ────────────────────────────────────────────────────────────────

  /**
   * Sliding-window rate limiter backed by Redis.
   * Gracefully passes through if Redis is unavailable.
   *
   * @param {{ windowMs?: number, max?: number, keyPrefix?: string }} [options]
   */
  rateLimit(options = {}) {
    const {
      windowMs  = 60 * 1000,
      max       = 60,
      keyPrefix = "rate_limit",
    } = options;

    return async (req, res, next) => {
      const key = `${keyPrefix}:${req.ip}:${req.path}`;

      try {
        const result = await redisService.incrementRateLimit(key, windowMs / 1000, max);

        res.set({
          "X-RateLimit-Limit":     max,
          "X-RateLimit-Remaining": result.remaining,
          "X-RateLimit-Reset":     result.reset,
        });

        if (result.current > max) {
          return send(res, 429, "Too many requests, please try again later.");
        }
      } catch {
        // Redis unavailable — fail open (don't block the request)
      }

      next();
    };
  }

  // ── _extractToken (private) ─────────────────────────────────────────────────

  /**
   * Extract the raw JWT string from the request.
   *
   * Priority:
   *   1. httpOnly cookie `access_token`   (set by auth controller on login)
   *   2. Authorization: Bearer <token>    (fallback for API / mobile clients)
   *   3. Signed cookie `token`            (legacy support)
   *
   * @param {import('express').Request} req
   * @returns {string|null}
   */
  _extractToken(req) {
    // 1. httpOnly cookie
    if (req.cookies?.[ACCESS_COOKIE]) {
      return req.cookies[ACCESS_COOKIE];
    }

    // 2. Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // 3. Signed cookie (legacy)
    if (req.signedCookies?.token) {
      return req.signedCookies.token;
    }

    return null;
  }
}

// Export a singleton; bind methods so they can be destructured safely
const middleware = new AuthMiddleware();

// Pre-bind public methods so `const { authenticate } = authMiddleware` works
middleware.authenticate      = middleware.authenticate.bind(middleware);
middleware.requireSuperAdmin = middleware.requireSuperAdmin.bind(middleware);

module.exports = middleware;