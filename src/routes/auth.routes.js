const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resendVerificationSchema   // <-- import new schema
} = require('../schemas/auth.schema');

// Public routes
router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/resend-verification', validate(resendVerificationSchema), authController.resendVerificationEmail);

// Protected routes
router.get('/me', authMiddleware.authenticate, authController.getCurrentUser);
router.post('/logout', authMiddleware.authenticate, authController.logout);
router.post('/change-password', 
  authMiddleware.authenticate, 
  validate(changePasswordSchema), 
  authController.changePassword
);

module.exports = router;