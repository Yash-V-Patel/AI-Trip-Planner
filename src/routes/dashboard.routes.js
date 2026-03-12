const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  statsQuerySchema,
  activityQuerySchema,
  updateWidgetPreferencesSchema,
  notificationsQuerySchema,
  notificationIdParamSchema,
  chartsQuerySchema,
  upcomingQuerySchema
} = require('../schemas/dashboard.schema');

// All dashboard routes require authentication
router.use(authMiddleware.authenticate);

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: User dashboard endpoints
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         userId:
 *           type: string
 *         title:
 *           type: string
 *         message:
 *           type: string
 *         isRead:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 */

// ==================== MAIN DASHBOARD ====================

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     summary: Get role‑based main dashboard
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Contains user info, stats, recent activity, quick actions, notifications, widgets, overview, and alerts – all tailored to the user’s role.
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden
 */
router.get('/', dashboardController.getDashboard);

/**
 * @swagger
 * /api/dashboard/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, week, month, quarter, year]
 *         description: Time period for statistics (defaults to month)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Optional category to filter stats (e.g., 'users', 'bookings')
 *     responses:
 *       200:
 *         description: Statistics returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Role‑specific statistics
 */
router.get(
  '/stats',
  validate(statsQuerySchema, 'query'),
  dashboardController.getStats
);

/**
 * @swagger
 * /api/dashboard/activity:
 *   get:
 *     summary: Get recent activity feed
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Pagination offset
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by activity type (optional)
 *     responses:
 *       200:
 *         description: Activity feed returned
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       icon:
 *                         type: string
 *                       color:
 *                         type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 */
router.get(
  '/activity',
  validate(activityQuerySchema, 'query'),
  dashboardController.getRecentActivity
);

/**
 * @swagger
 * /api/dashboard/widgets:
 *   get:
 *     summary: Get dashboard widgets configuration
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available widgets with user preferences applied
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       type:
 *                         type: string
 *                       size:
 *                         type: string
 *                       enabled:
 *                         type: boolean
 *                       order:
 *                         type: integer
 *                       config:
 *                         type: object
 */
router.get('/widgets', dashboardController.getWidgets);

/**
 * @swagger
 * /api/dashboard/widgets/preferences:
 *   post:
 *     summary: Update user widget preferences
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               widgets:
 *                 type: object
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     order:
 *                       type: integer
 *                     config:
 *                       type: object
 *               layout:
 *                 type: object
 *                 description: Optional layout configuration
 *     responses:
 *       200:
 *         description: Preferences updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   description: Updated preferences
 */
router.post(
  '/widgets/preferences',
  validate(updateWidgetPreferencesSchema),
  dashboardController.updateWidgetPreferences
);

// ==================== NOTIFICATIONS ====================

/**
 * @swagger
 * /api/dashboard/notifications:
 *   get:
 *     summary: Get user notifications
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of notifications to return
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Return only unread notifications
 *     responses:
 *       200:
 *         description: Notifications retrieved
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
 *                     $ref: '#/components/schemas/Notification'
 *                 unreadCount:
 *                   type: integer
 */
router.get(
  '/notifications',
  validate(notificationsQuerySchema, 'query'),
  dashboardController.getNotifications
);

/**
 * @swagger
 * /api/dashboard/notifications/{notificationId}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the notification
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Notification not found
 */
router.patch(
  '/notifications/:notificationId/read',
  validate(notificationIdParamSchema, 'params'),
  dashboardController.markNotificationRead
);

/**
 * @swagger
 * /api/dashboard/notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post('/notifications/read-all', dashboardController.markAllNotificationsRead);

// ==================== USER ROLE INFORMATION ====================

/**
 * @swagger
 * /api/dashboard/role-info:
 *   get:
 *     summary: Get current user's role and permissions
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Role information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     primaryRole:
 *                       type: string
 *                       enum: [SUPER_ADMIN, VENDOR_ADMIN, VENDOR_MANAGER, VENDOR, USER]
 *                     allRoles:
 *                       type: array
 *                       items:
 *                         type: string
 *                     vendorRole:
 *                       type: string
 *                       nullable: true
 *                     permissions:
 *                       type: object
 *                     isSuperAdmin:
 *                       type: boolean
 */
router.get('/role-info', dashboardController.getUserRoleInfo);

// ==================== OVERVIEW ====================

/**
 * @swagger
 * /api/dashboard/overview:
 *   get:
 *     summary: Get a simplified overview dashboard
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overview data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Role‑specific high‑level summary
 */
router.get('/overview', dashboardController.getOverview);

/**
 * @swagger
 * /api/dashboard/charts:
 *   get:
 *     summary: Get chart data for a specific chart type
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chart
 *         required: true
 *         schema:
 *           type: string
 *         description: Chart identifier (e.g., 'user-growth', 'revenue', 'bookings')
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, week, month, quarter, year]
 *           default: month
 *         description: Time period for the chart
 *     responses:
 *       200:
 *         description: Chart data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Chart‑specific data structure (labels, datasets)
 */
router.get(
  '/charts',
  validate(chartsQuerySchema, 'query'),
  dashboardController.getCharts
);

/**
 * @swagger
 * /api/dashboard/alerts:
 *   get:
 *     summary: Get active alerts for the current user
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of alerts
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [warning, info, success, error]
 *                       title:
 *                         type: string
 *                       message:
 *                         type: string
 *                       action:
 *                         type: string
 *                       dismissible:
 *                         type: boolean
 */
router.get('/alerts', dashboardController.getAlerts);

/**
 * @swagger
 * /api/dashboard/upcoming:
 *   get:
 *     summary: Get upcoming items (bookings, tasks, trips)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of items to return
 *     responses:
 *       200:
 *         description: List of upcoming items
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       date:
 *                         type: string
 *                         format: date-time
 *                       priority:
 *                         type: string
 *                       action:
 *                         type: string
 *                       icon:
 *                         type: string
 *                       color:
 *                         type: string
 */
router.get(
  '/upcoming',
  validate(upcomingQuerySchema, 'query'),
  dashboardController.getUpcomingItems
);

// ==================== PERFORMANCE (VENDOR/ADMIN ONLY) ====================

/**
 * @swagger
 * /api/dashboard/performance:
 *   get:
 *     summary: Get performance metrics (vendors and admins only)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Metrics like response time, error rate, active users, etc.
 *       403:
 *         description: Not available for regular users
 */
router.get('/performance', dashboardController.getPerformanceMetrics);

module.exports = router;