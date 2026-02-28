const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All dashboard routes require authentication
router.use(authMiddleware.authenticate);

// ==================== MAIN DASHBOARD ====================

/**
 * Get main dashboard based on user role
 * GET /api/dashboard
 */
router.get('/', dashboardController.getDashboard);

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 */
router.get('/stats', dashboardController.getStats);

/**
 * Get recent activity
 * GET /api/dashboard/activity
 */
router.get('/activity', dashboardController.getRecentActivity);

/**
 * Get dashboard widgets configuration
 * GET /api/dashboard/widgets
 */
router.get('/widgets', dashboardController.getWidgets);

/**
 * Update widget preferences
 * POST /api/dashboard/widgets/preferences
 */
router.post('/widgets/preferences', dashboardController.updateWidgetPreferences);

/**
 * Get quick actions based on role
 * GET /api/dashboard/quick-actions
 */
router.get('/quick-actions', dashboardController.getQuickActions);

// ==================== NOTIFICATIONS ====================

/**
 * Get user notifications
 * GET /api/dashboard/notifications
 */
router.get('/notifications', dashboardController.getNotifications);

/**
 * Mark notification as read
 * PATCH /api/dashboard/notifications/:notificationId/read
 */
router.patch('/notifications/:notificationId/read', dashboardController.markNotificationRead);

/**
 * Mark all notifications as read
 * POST /api/dashboard/notifications/read-all
 */
router.post('/notifications/read-all', dashboardController.markAllNotificationsRead);

// ==================== USER ROLE INFORMATION ====================

/**
 * Get user role information
 * GET /api/dashboard/role-info
 */
router.get('/role-info', dashboardController.getUserRoleInfo);

// ==================== OVERVIEW ====================

/**
 * Get overview dashboard (simplified version)
 * GET /api/dashboard/overview
 */
router.get('/overview', dashboardController.getOverview);

/**
 * Get chart data for dashboard
 * GET /api/dashboard/charts
 */
router.get('/charts', dashboardController.getCharts);

/**
 * Get alerts for current user
 * GET /api/dashboard/alerts
 */
router.get('/alerts', dashboardController.getAlerts);

/**
 * Get upcoming items (bookings, tasks, etc.)
 * GET /api/dashboard/upcoming
 */
router.get('/upcoming', dashboardController.getUpcomingItems);

// ==================== PERFORMANCE (VENDOR/ADMIN ONLY) ====================

/**
 * Get performance metrics
 * GET /api/dashboard/performance
 */
router.get('/performance', dashboardController.getPerformanceMetrics);

module.exports = router;