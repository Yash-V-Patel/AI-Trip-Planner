/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management and profile operations
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  profileUpdateSchema,
  updateUserSchema,
  userIdParamSchema,
  sessionIdParamSchema,
  clearCacheQuerySchema
} = require('../schemas/profile.schema');

// All user routes require authentication
router.use(authMiddleware.authenticate);

// ==================== PROFILE ====================

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Skip cache and fetch fresh data
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Profile'
 *                 cached:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Profile not found
 */
router.get('/profile', userController.getProfile);

/**
 * @swagger
 * /users/profile:
 *   put:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileUpdate'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Profile'
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put('/profile', validate(profileUpdateSchema), userController.updateProfile);

// ==================== USER MANAGEMENT ====================

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users (superadmin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by email or name
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserListItem'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       403:
 *         description: Forbidden (requires superadmin)
 */
router.get('/', authMiddleware.requireSuperAdmin, userController.getAllUsers);

/**
 * @swagger
 * /users/{userId}:
 *   get:
 *     summary: Get user by ID (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Skip cache
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserDetail'
 *                 cached:
 *                   type: boolean
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.get('/:userId', validate(userIdParamSchema, 'params'), userController.getUserById);

/**
 * @swagger
 * /users/{userId}:
 *   put:
 *     summary: Update user (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdate'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already in use
 */
router.put('/:userId', validate(userIdParamSchema, 'params'), validate(updateUserSchema), userController.updateUser);

/**
 * @swagger
 * /users/{userId}:
 *   delete:
 *     summary: Delete user (superadmin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       403:
 *         description: Forbidden (requires superadmin)
 *       404:
 *         description: User not found
 */
router.delete('/:userId', authMiddleware.requireSuperAdmin, validate(userIdParamSchema, 'params'), userController.deleteUser);

// ==================== SESSION MANAGEMENT ====================

/**
 * @swagger
 * /users/{userId}/sessions:
 *   get:
 *     summary: Get active sessions for a user (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: List of active sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Session'
 *       403:
 *         description: Forbidden
 */
router.get('/:userId/sessions', validate(userIdParamSchema, 'params'), userController.getUserSessions);

/**
 * @swagger
 * /users/sessions/{sessionId}:
 *   delete:
 *     summary: Revoke a specific session (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session revoked successfully
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Session not found
 */
router.delete('/sessions/:sessionId', validate(sessionIdParamSchema, 'params'), userController.revokeSession);

/**
 * @swagger
 * /users/{userId}/sessions:
 *   delete:
 *     summary: Revoke all sessions for a user (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: All sessions revoked successfully
 *       403:
 *         description: Forbidden
 */
router.delete('/:userId/sessions', validate(userIdParamSchema, 'params'), userController.revokeAllSessions);

// ==================== SUPERADMIN MANAGEMENT ====================

/**
 * @swagger
 * /users/{userId}/superadmin:
 *   post:
 *     summary: Assign superadmin role to a user (superadmin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: Superadmin assigned successfully
 *       403:
 *         description: Forbidden (requires superadmin)
 *       404:
 *         description: User not found
 */
router.post('/:userId/superadmin', authMiddleware.requireSuperAdmin, validate(userIdParamSchema, 'params'), userController.assignSuperAdmin);

/**
 * @swagger
 * /users/{userId}/superadmin:
 *   delete:
 *     summary: Remove superadmin role from a user (superadmin only, cannot self-remove)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: Superadmin removed successfully
 *       400:
 *         description: Cannot remove your own superadmin status
 *       403:
 *         description: Forbidden (requires superadmin)
 *       404:
 *         description: User not found
 */
router.delete('/:userId/superadmin', authMiddleware.requireSuperAdmin, validate(userIdParamSchema, 'params'), userController.removeSuperAdmin);

// ==================== USER STATISTICS ====================

/**
 * @swagger
 * /users/{userId}/statistics:
 *   get:
 *     summary: Get user statistics (self or admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Skip cache
 *     responses:
 *       200:
 *         description: User statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserStatistics'
 *                 cached:
 *                   type: boolean
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.get('/:userId/statistics', validate(userIdParamSchema, 'params'), userController.getUserStatistics);

// ==================== CACHE MANAGEMENT ====================

/**
 * @swagger
 * /users/cache:
 *   delete:
 *     summary: Clear user cache (superadmin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Clear cache for specific user
 *       - in: query
 *         name: pattern
 *         schema:
 *           type: string
 *         description: Clear cache matching Redis pattern
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *       400:
 *         description: Either userId or pattern required
 *       403:
 *         description: Forbidden (requires superadmin)
 */
router.delete('/cache', authMiddleware.requireSuperAdmin, validate(clearCacheQuerySchema, 'query'), userController.clearCache);

module.exports = router;