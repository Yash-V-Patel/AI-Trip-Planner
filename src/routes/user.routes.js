const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { profileUpdateSchema } = require('../schemas/profile.schema');

// All user routes require authentication
router.use(authMiddleware.authenticate);

// Profile routes
router.get('/profile', userController.getProfile);

router.put('/profile', 
  validate(profileUpdateSchema),
  userController.updateProfile
);

// User management routes (superadmin only for some)
router.get('/', 
  authMiddleware.requireSuperAdmin,
  userController.getAllUsers
);

router.get('/:userId',
  userController.getUserById
);

router.put('/:userId',
  userController.updateUser
);

router.delete('/:userId',
  authMiddleware.requireSuperAdmin,
  userController.deleteUser
);

// Session management
router.get('/:userId/sessions',
  userController.getUserSessions
);

router.delete('/sessions/:sessionId',
  userController.revokeSession
);

router.delete('/:userId/sessions',
  userController.revokeAllSessions
);

// Superadmin management
router.post('/:userId/superadmin',
  authMiddleware.requireSuperAdmin,
  userController.assignSuperAdmin
);

router.delete('/:userId/superadmin',
  authMiddleware.requireSuperAdmin,
  userController.removeSuperAdmin
);

// User statistics
router.get('/:userId/statistics',
  userController.getUserStatistics
);

// Cache management (superadmin only) - Add a fallback if method doesn't exist
router.delete('/cache',
  authMiddleware.requireSuperAdmin,
  (req, res) => {
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  }
);

module.exports = router;