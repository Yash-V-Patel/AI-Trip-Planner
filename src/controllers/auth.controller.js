const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");
const { generateTokens, verifyRefreshToken } = require("../utils/jwt.utils");

const prisma = new PrismaClient();

class AuthController {
  async register(req, res, next) {
    try {
      const { email, password, name, phone } = req.body;
      const phoneString = String(phone);

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone: phoneString,
        },
      });

      // Create empty profile
      const profile = await prisma.profile.create({
        data: {
          userId: user.id,
        },
      });

      // Set up OpenFGA relations
      await openfgaService.createProfileRelations(user.id, profile.id);

      // Generate tokens
      const tokens = generateTokens(user.id, user.email);

      // Store refresh token fingerprint in Redis (not the full token)
      await redisService.storeRefreshTokenFingerprint(
        user.id,
        tokens.refreshToken,
        { userAgent: req.headers["user-agent"], ip: req.ip },
      );

      // Store refresh token in DB (for backup/revocation)
      await prisma.refreshToken.create({
        data: {
          token: tokens.refreshToken, // Still store in DB for backup
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      // Cache user data
      const userData = {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        profile,
      };
      await redisService.cacheUser(user.id, userData);
      await redisService.cacheUserByEmail(user.email, userData);

      // Remove password from response
      delete user.password;

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          user: userData,
          ...tokens,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true },
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // Check superadmin status
      const isSuperAdmin = await openfgaService.checkSuperAdmin(user.id);

      // Generate tokens
      const tokens = generateTokens(user.id, user.email);

      // Store refresh token fingerprint in Redis
      await redisService.storeRefreshTokenFingerprint(
        user.id,
        tokens.refreshToken,
        {
          userAgent: req.headers["user-agent"],
          ip: req.ip,
          loginTime: new Date().toISOString(),
        },
      );

      // Store refresh token in DB
      await prisma.refreshToken.create({
        data: {
          token: tokens.refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Update last login (Correct Upsert Syntax)
      await prisma.profile.upsert({
        where: {
          userId: user.id, // Ensure this matches the unique field in your schema
        },
        update: {
          lastLogin: new Date(),
        },
        create: {
          userId: user.id,
          lastLogin: new Date(),
          // Add any other required profile fields here
        },
      });
      // Cache user data
      const userData = {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: String(user.phone),
        profile: user.profile,
      };
      await redisService.cacheUser(user.id, userData);
      await redisService.cacheUserByEmail(user.email, userData);

      // Remove password from response
      delete user.password;

      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: userData,
          isSuperAdmin,
          ...tokens,
        },
      });
    } catch (error) {
      next(error);
    }
  }
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token",
        });
      }

      // Check Redis for fingerprint (fast path)
      const redisFingerprint = await redisService.validateRefreshToken(
        decoded.userId,
        refreshToken,
      );

      // If not in Redis, check database (slow path)
      if (!redisFingerprint) {
        const storedToken = await prisma.refreshToken.findFirst({
          where: {
            token: refreshToken,
            userId: decoded.userId,
            isRevoked: false,
            expiresAt: { gt: new Date() },
          },
        });

        if (!storedToken) {
          return res.status(401).json({
            success: false,
            message: "Refresh token expired or revoked",
          });
        }

        // Restore fingerprint in Redis for future requests
        await redisService.storeRefreshTokenFingerprint(
          decoded.userId,
          refreshToken,
          { restored: true },
        );
      }

      // Generate new access token only (keep same refresh token)
      const newAccessToken = jwt.sign(
        { userId: decoded.userId, email: decoded.email },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: "1d" },
      );

      // Return new access token with existing refresh token
      res.json({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: refreshToken, // Return the same refresh token
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const userId = req.user.id;

      // Remove refresh token fingerprint from Redis
      if (refreshToken) {
        await redisService.removeRefreshTokenFingerprint(userId, refreshToken);

        // Revoke in database
        await prisma.refreshToken.updateMany({
          where: {
            token: refreshToken,
            userId,
          },
          data: { isRevoked: true },
        });

        // Blacklist the access token
        const authHeader = req.headers.authorization;
        if (authHeader) {
          const accessToken = authHeader.split(" ")[1];
          // Blacklist for 1 day (access token expiry)
          await redisService.blacklistAccessToken(accessToken, 24 * 60 * 60);
        }
      } else {
        // Revoke all user's refresh tokens
        await redisService.removeAllUserRefreshTokens(userId);

        await prisma.refreshToken.updateMany({
          where: { userId },
          data: { isRevoked: true },
        });
      }

      // Invalidate user cache
      await redisService.invalidateUserCache(userId, req.user.email);
      await redisService.invalidateProfile(userId);

      res.json({
        success: true,
        message: "Logout successful",
      });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id; // Fixed: req.user.id not req.user.userId

      // Get user with password
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          password: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(
        currentPassword,
        user.password,
      );
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      // Remove all refresh tokens (force re-login)
      await redisService.removeAllUserRefreshTokens(userId);

      await prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true },
      });

      // Invalidate user cache
      await redisService.invalidateUserCache(userId, user.email);
      await redisService.invalidateProfile(userId);

      res.json({
        success: true,
        message:
          "Password changed successfully. Please login again with your new password.",
      });
    } catch (error) {
      next(error);
    }
  }
  // Optional: Forgot password - request reset
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Don't reveal if user exists or not for security
        return res.json({
          success: true,
          message:
            "If an account exists with this email, you will receive password reset instructions.",
        });
      }

      // Generate reset token
      const resetToken = require("crypto").randomBytes(32).toString("hex");
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

      // Store reset token in database (you'd need to add this field to User model)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpiry: resetTokenExpiry,
        },
      });

      // Here you would send email with reset link
      // await emailService.sendPasswordResetEmail(email, resetToken);

      console.log(`Password reset token for ${email}: ${resetToken}`); // For development

      res.json({
        success: true,
        message:
          "If an account exists with this email, you will receive password reset instructions.",
      });
    } catch (error) {
      next(error);
    }
  }

  // Optional: Reset password with token
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      // Find user with valid reset token
      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
          resetPasswordExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password and clear reset token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        },
      });

      // Revoke all refresh tokens
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { isRevoked: true },
      });

      // Invalidate cache
      await redisService.invalidateUserCache(user.id, user.email);
      await redisService.invalidateUserTokens(user.id);

      res.json({
        success: true,
        message:
          "Password reset successful. Please login with your new password.",
      });
    } catch (error) {
      next(error);
    }
  }

  // Verify email (if you implement email verification)
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;

      // Find user with verification token
      const user = await prisma.user.findFirst({
        where: {
          emailVerificationToken: token,
          emailVerificationExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token",
        });
      }

      // Update user as verified
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiry: null,
        },
      });

      // Update profile
      await prisma.profile.update({
        where: { userId: user.id },
        data: { emailVerified: true },
      });

      // Invalidate cache
      await redisService.invalidateUserCache(user.id, user.email);

      res.json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // Resend verification email
  async resendVerificationEmail(req, res, next) {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.emailVerified) {
        return res.json({
          success: true,
          message: "Email already verified",
        });
      }

      // Generate new verification token
      const verificationToken = require("crypto")
        .randomBytes(32)
        .toString("hex");
      const verificationExpiry = new Date(Date.now() + 24 * 3600000); // 24 hours

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
        },
      });

      // Here you would send email with verification link
      console.log(
        `Email verification token for ${email}: ${verificationToken}`,
      ); // For development

      res.json({
        success: true,
        message: "Verification email sent",
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
