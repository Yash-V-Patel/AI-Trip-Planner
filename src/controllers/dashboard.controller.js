const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ─── module-level response helpers ───────────────────────────────────────────
const notFound  = (res, msg = "Not found")  => res.status(404).json({ success: false, message: msg });
const forbidden = (res, msg = "Forbidden")  => res.status(403).json({ success: false, message: msg });
const badRequest= (res, msg = "Bad request")=> res.status(400).json({ success: false, message: msg });

const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
};

class DashboardController {
  // No constructor — no this.bind() needed; methods are called as instance
  // methods through the exported singleton so `this` is always bound.

  // ==================== PUBLIC ROUTE HANDLERS ====================

  /**
   * GET /api/dashboard
   * Returns role-appropriate full dashboard data.
   */
  async getDashboard(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true, vendor: true },
      });

      if (!user) return notFound(res, "User not found");

      const roleInfo = await this._determineUserRole(user, req.user.isSuperAdmin);

      let dashboardData = {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          profilePicture: user.profile?.profilePicture,
          role: roleInfo.primaryRole,
          roles: roleInfo.allRoles,
          isSuperAdmin: req.user.isSuperAdmin || false,
          isVendor: !!user.vendor,
          vendorStatus: user.vendor?.verificationStatus,
        },
        stats: {},
        recentActivity: [],
        quickActions: [],
        notifications: [],
        widgets: [],
        overview: {},
        alerts: [],
      };

      switch (roleInfo.primaryRole) {
        case "SUPER_ADMIN":
          dashboardData = await this._getSuperAdminDashboard(userId, dashboardData);
          break;
        case "VENDOR_ADMIN":
          dashboardData = await this._getVendorAdminDashboard(user, dashboardData);
          break;
        case "VENDOR_MANAGER":
          dashboardData = await this._getVendorManagerDashboard(user, dashboardData);
          break;
        case "VENDOR":
          dashboardData = await this._getVendorDashboard(user, dashboardData);
          break;
        case "USER":
        default:
          dashboardData = await this._getUserDashboard(userId, dashboardData);
          break;
      }

      dashboardData.notifications = await this._getUserNotifications(userId);
      dashboardData.alerts       = await this._getUserAlerts(userId, roleInfo);
      dashboardData.widgets      = await this._getWidgetsByRole(roleInfo.primaryRole, user);

      res.json({ success: true, data: dashboardData });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/stats
   */
  async getStats(req, res, next) {
    try {
      const userId = req.user.id;
      const { period = "month", category } = req.query;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });
      if (!user) return notFound(res, "User not found");

      const isSuperAdmin = req.user.isSuperAdmin || false;
      let stats = {};

      if (isSuperAdmin) {
        stats = await this._getSuperAdminStats(period, category);
      } else if (user.vendor) {
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        stats = await this._getVendorStats(user.vendor.id, period, category, vendorRole);
      } else {
        stats = await this._getUserStats(userId, period, category);
      }

      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/activity
   */
  async getRecentActivity(req, res, next) {
    try {
      const userId = req.user.id;
      const limit  = parseIntParam(req.query.limit,  20);
      const offset = parseIntParam(req.query.offset,  0);
      const { type } = req.query;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      let activities = [];

      if (isSuperAdmin) {
        activities = await this._getSystemActivities(limit, offset, type);
      } else if (user?.vendor) {
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        activities = await this._getVendorActivities(user.vendor.id, limit, offset, type, vendorRole);
      } else {
        activities = await this._getUserActivities(userId, limit, offset, type);
      }

      res.json({
        success: true,
        data: activities,
        pagination: { limit, offset, hasMore: activities.length === limit },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/widgets
   */
  async getWidgets(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true, profile: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);
      const userPreferences = user?.profile?.dashboardPreferences || {};
      const widgets = await this._getWidgetsByRole(roleInfo.primaryRole, user, userPreferences);

      res.json({ success: true, data: widgets });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/dashboard/widgets/preferences
   */
  async updateWidgetPreferences(req, res, next) {
    try {
      const userId = req.user.id;
      const { widgets, layout } = req.body;

      const profile = await prisma.profile.findUnique({ where: { userId } });

      const updatedProfile = await prisma.profile.update({
        where: { userId },
        data: {
          dashboardPreferences: {
            ...(profile?.dashboardPreferences || {}),
            widgets,
            layout,
            updatedAt: new Date().toISOString(),
          },
        },
      });

      // Invalidate cache fire-and-forget
      redisService.client?.del(`profile:${userId}`).catch(() => {});

      res.json({
        success: true,
        message: "Widget preferences updated successfully",
        data: updatedProfile.dashboardPreferences,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/quick-actions
   */
  async getQuickActions(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);
      const actions  = await this._getQuickActionsByRole(roleInfo.primaryRole, user);

      res.json({ success: true, data: actions });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/notifications
   */
  async getNotifications(req, res, next) {
    try {
      const userId   = req.user.id;
      const limit     = parseIntParam(req.query.limit, 20);
      const unreadOnly = req.query.unreadOnly === "true";

      const where = { userId };
      if (unreadOnly) where.isRead = false;

      const [notifications, unreadCount] = await Promise.all([
        prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
        prisma.notification.count({ where: { userId, isRead: false } }),
      ]);

      res.json({ success: true, data: notifications, unreadCount });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/dashboard/notifications/:notificationId/read
   */
  async markNotificationRead(req, res, next) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.id;

      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });
      if (!notification) return notFound(res, "Notification not found");

      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });

      res.json({ success: true, message: "Notification marked as read" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/dashboard/notifications/read-all
   */
  async markAllNotificationsRead(req, res, next) {
    try {
      const userId = req.user.id;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      res.json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/role-info
   */
  async getUserRoleInfo(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          vendor: {
            include: { teamMembers: { where: { userId } } },
          },
        },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo     = await this._determineUserRole(user, isSuperAdmin);

      const permissions = {};
      if (roleInfo.primaryRole === "SUPER_ADMIN") {
        permissions.all = true;
      } else if (user?.vendor) {
        permissions.vendor = await this._getVendorPermissions(
          user.vendor.id,
          userId,
          roleInfo.vendorRole,
        );
      }

      res.json({ success: true, data: { ...roleInfo, permissions, isSuperAdmin } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/overview
   */
  async getOverview(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo     = await this._determineUserRole(user, isSuperAdmin);

      let overview = {};
      if (isSuperAdmin) {
        overview = await this._getSuperAdminOverview();
      } else if (user?.vendor) {
        overview = await this._getVendorOverview(user.vendor.id, roleInfo.vendorRole);
      } else {
        overview = await this._getUserOverview(userId);
      }

      res.json({ success: true, data: overview });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/charts
   */
  async getCharts(req, res, next) {
    try {
      const userId = req.user.id;
      const { chart, period = "month" } = req.query;
      if (!chart) return badRequest(res, "Chart type is required");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      let chartData = {};

      if (isSuperAdmin) {
        chartData = await this._getSuperAdminChartData(chart, period);
      } else if (user?.vendor) {
        chartData = await this._getVendorChartData(user.vendor.id, chart, period);
      } else {
        chartData = await this._getUserChartData(userId, chart, period);
      }

      res.json({ success: true, data: chartData });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/alerts
   */
  async getAlerts(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo     = await this._determineUserRole(user, isSuperAdmin);
      const alerts       = await this._getUserAlerts(userId, roleInfo);

      res.json({ success: true, data: alerts });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/upcoming
   */
  async getUpcomingItems(req, res, next) {
    try {
      const userId = req.user.id;
      const limit  = parseIntParam(req.query.limit, 10);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo     = await this._determineUserRole(user, isSuperAdmin);

      let upcomingItems = [];
      if (isSuperAdmin) {
        upcomingItems = await this._getSuperAdminUpcoming(limit);
      } else if (user?.vendor) {
        upcomingItems = await this._getVendorUpcoming(user.vendor.id, limit, roleInfo.vendorRole);
      } else {
        upcomingItems = await this._getUserUpcoming(userId, limit);
      }

      res.json({ success: true, data: upcomingItems });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/dashboard/performance
   */
  async getPerformanceMetrics(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;

      if (!user?.vendor && !isSuperAdmin) {
        return forbidden(res, "Performance metrics not available for regular users");
      }

      let metrics = {};
      if (isSuperAdmin) {
        metrics = await this._getSystemPerformanceMetrics();
      } else if (user?.vendor) {
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        metrics = await this._getVendorPerformanceMetrics(user.vendor.id, vendorRole);
      }

      res.json({ success: true, data: metrics });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ROLE DETERMINATION ====================

  /**
   * Determine user's role hierarchy.
   * NOTE: user must be fetched with `include: { vendor: { include: { teamMembers: ... } } }`
   * when teamMembers resolution is needed.
   */
  async _determineUserRole(user, isSuperAdmin) {
    const roleInfo = {
      primaryRole: "USER",
      allRoles: ["USER"],
      vendorRole: null,
      vendorPermissions: [],
    };

    if (isSuperAdmin) {
      roleInfo.primaryRole = "SUPER_ADMIN";
      roleInfo.allRoles.unshift("SUPER_ADMIN");
      return roleInfo;
    }

    if (user?.vendor) {
      roleInfo.allRoles.push("VENDOR");

      const teamMember = user.vendor.teamMembers?.find((tm) => tm.userId === user.id);
      if (teamMember) {
        roleInfo.vendorRole = teamMember.role;
        roleInfo.vendorPermissions = teamMember.permissions || [];

        switch (teamMember.role) {
          case "ADMIN":
            roleInfo.primaryRole = "VENDOR_ADMIN";
            roleInfo.allRoles.push("VENDOR_ADMIN");
            break;
          case "MANAGER":
            roleInfo.primaryRole = "VENDOR_MANAGER";
            roleInfo.allRoles.push("VENDOR_MANAGER");
            break;
          default:
            roleInfo.primaryRole = "VENDOR";
            roleInfo.allRoles.push("VENDOR_STAFF");
        }
      } else {
        roleInfo.primaryRole = "VENDOR";
        roleInfo.vendorRole  = "OWNER";
      }
    }

    return roleInfo;
  }

  /**
   * Get vendor role for a user (OWNER | ADMIN | MANAGER | EDITOR | VIEWER | null).
   */
  async _getVendorRole(vendorId, userId) {
    try {
      const teamMember = await prisma.vendorTeamMember.findUnique({
        where: { vendorId_userId: { vendorId, userId } },
        select: { role: true },
      });
      if (teamMember) return teamMember.role;

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { userId: true },
      });
      if (vendor?.userId === userId) return "OWNER";

      return null;
    } catch (error) {
      console.error("Error getting vendor role:", error);
      return null;
    }
  }

  /**
   * Get vendor permissions based on role.
   */
  async _getVendorPermissions(vendorId, userId, vendorRole) {
    const base = {
      canViewDashboard: true,
      canViewAnalytics: false,
      canManageListings: false,
      canManageBookings: false,
      canManageTeam: false,
      canManagePayouts: false,
      canEditProfile: false,
      canReplyToReviews: false,
    };

    switch (vendorRole) {
      case "OWNER":
      case "ADMIN":
        return { ...base, canViewAnalytics: true, canManageListings: true, canManageBookings: true, canManageTeam: true, canManagePayouts: true, canEditProfile: true, canReplyToReviews: true };
      case "MANAGER":
        return { ...base, canViewAnalytics: true, canManageListings: true, canManageBookings: true, canReplyToReviews: true };
      case "EDITOR":
        return { ...base, canManageListings: true, canManageBookings: true };
      case "VIEWER":
        return base;
      default:
        return base;
    }
  }

  // ==================== ROLE-BASED DASHBOARD BUILDERS ====================

  async _getSuperAdminDashboard(userId, dashboardData) {
    const [systemStats, recentUsers, recentVendors, recentBookings, pendingApprovals, revenueData] =
      await Promise.all([
        this._getSystemStats(),
        this._getRecentUsers(10),
        this._getRecentVendors(10),
        this._getRecentBookings(10),
        this._getPendingApprovals(),
        this._getRevenueData("month"),
      ]);

    dashboardData.stats = systemStats;
    dashboardData.recentActivity = [
      ...recentUsers.map((u) => ({
        id: `user-${u.id}`, type: "NEW_USER", title: "New User Registered",
        description: `${u.name || u.email} joined the platform`,
        timestamp: u.createdAt, icon: "user-plus", color: "green", data: u,
      })),
      ...recentVendors.map((v) => ({
        id: `vendor-${v.id}`, type: "NEW_VENDOR", title: "New Vendor Application",
        description: `${v.businessName} applied to become a vendor`,
        timestamp: v.createdAt, icon: "store", color: "blue", data: v,
      })),
      ...recentBookings.map((b) => ({
        id: `booking-${b.id}`, type: "NEW_BOOKING", title: "New Booking",
        description: `New booking created for ${b.travelPlan?.title || "a travel plan"}`,
        timestamp: b.createdAt, icon: "calendar-check", color: "purple", data: b,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);

    dashboardData.quickActions = [
      { id: "review-vendors",   label: "Review Vendors",  icon: "clipboard-check", url: "/admin/vendors/pending", count: pendingApprovals.vendors, color: "yellow" },
      { id: "manage-users",     label: "Manage Users",    icon: "users",           url: "/admin/users",           color: "blue"   },
      { id: "view-reports",     label: "View Reports",    icon: "chart-bar",       url: "/admin/reports",         color: "green"  },
      { id: "system-settings",  label: "System Settings", icon: "cog",             url: "/admin/settings",        color: "gray"   },
      { id: "process-payouts",  label: "Process Payouts", icon: "credit-card",     url: "/admin/payouts",         count: pendingApprovals.payouts, color: "purple" },
    ];

    dashboardData.overview = {
      totalUsers:        systemStats.totalUsers,
      totalVendors:      systemStats.totalVendors,
      totalBookings:     systemStats.totalBookings,
      revenue:           revenueData.total,
      growth:            revenueData.growth,
      pendingApprovals,
    };

    return dashboardData;
  }

  async _getVendorAdminDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [vendorStats, teamMembers, pendingApprovals, recentOrders, performanceMetrics, revenueData] =
      await Promise.all([
        // FIX: pass category=null, vendorRole="ADMIN" so team stats are included
        this._getVendorStats(vendorId, "month", null, "ADMIN"),
        prisma.vendorTeamMember.findMany({
          where: { vendorId, isActive: true },
          include: {
            user: { select: { id: true, name: true, email: true, profile: { select: { profilePicture: true } } } },
          },
        }),
        this._getVendorPendingApprovals(vendorId),
        this._getVendorRecentOrders(vendorId, 10),
        this._getVendorPerformanceMetrics(vendorId, "ADMIN"),
        this._getVendorRevenueData(vendorId, "month"),
      ]);

    dashboardData.stats = vendorStats;
    dashboardData.team  = {
      members:      teamMembers,
      total:        teamMembers.length,
      pendingInvites: pendingApprovals.teamInvites || 0,
    };

    dashboardData.recentActivity = recentOrders.map((order) => ({
      id: `order-${order.id}`, type: "NEW_ORDER", title: "New Order",
      description: `Order #${order.id.substring(0, 8)} - $${order.totalAmount}`,
      timestamp: order.createdAt, icon: "shopping-cart", color: "blue", data: order,
    }));

    dashboardData.quickActions = [
      { id: "manage-listings", label: "Manage Listings", icon: "building",      url: "/vendor/listings",      color: "blue"   },
      { id: "manage-team",     label: "Manage Team",     icon: "users",         url: "/vendor/team",          count: teamMembers.length, color: "green"  },
      { id: "view-orders",     label: "View Orders",     icon: "shopping-bag",  url: "/vendor/orders",        count: pendingApprovals.orders || 0, color: "purple" },
      { id: "analytics",       label: "Analytics",       icon: "chart-line",    url: "/vendor/analytics",     color: "yellow" },
      { id: "payouts",         label: "Payouts",         icon: "dollar-sign",   url: "/vendor/payouts",       color: "green"  },
    ];

    dashboardData.overview = {
      totalListings:    vendorStats.listings?.total,
      totalOrders:      vendorStats.bookings?.total,
      revenue:          revenueData.total,
      teamSize:         teamMembers.length,
      pendingApprovals: pendingApprovals.total || 0,
    };
    dashboardData.performance = performanceMetrics;

    return dashboardData;
  }

  async _getVendorManagerDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [teamStats, pendingTasks, recentOrders, inventoryAlerts, performanceMetrics] =
      await Promise.all([
        this._getVendorTeamStats(vendorId),
        this._getVendorPendingTasks(vendorId, user.id),
        this._getVendorRecentOrders(vendorId, 10),
        this._getVendorInventoryAlerts(vendorId),
        this._getVendorPerformanceMetrics(vendorId, "MANAGER"),
      ]);

    dashboardData.stats = { ...teamStats, pendingTasks: pendingTasks.total, inventoryAlerts: inventoryAlerts.total };

    dashboardData.recentActivity = [
      ...recentOrders.map((order) => ({
        id: `order-${order.id}`, type: "NEW_ORDER", title: "New Order",
        description: `Order #${order.id.substring(0, 8)} needs processing`,
        timestamp: order.createdAt, icon: "shopping-cart", color: "blue", data: order,
      })),
      ...inventoryAlerts.items.map((item) => ({
        id: `alert-${item.id}`, type: "INVENTORY_ALERT", title: "Low Inventory",
        description: `${item.name} is running low (${item.stock} left)`,
        timestamp: item.updatedAt, icon: "exclamation-triangle", color: "yellow", data: item,
      })),
    ].slice(0, 20);

    dashboardData.quickActions = [
      { id: "process-orders",    label: "Process Orders",  icon: "clipboard-check", url: "/vendor/orders/pending", count: pendingTasks.orders,  color: "blue"   },
      { id: "manage-inventory",  label: "Manage Inventory",icon: "box",             url: "/vendor/inventory",      count: inventoryAlerts.total, color: "yellow" },
      { id: "team-tasks",        label: "Team Tasks",      icon: "tasks",           url: "/vendor/tasks",          count: pendingTasks.team,    color: "green"  },
      { id: "customer-service",  label: "Customer Service",icon: "headset",         url: "/vendor/support",        count: pendingTasks.support, color: "purple" },
    ];

    dashboardData.overview = {
      teamPerformance: performanceMetrics.team,
      pendingTasks:    pendingTasks.total,
      inventoryStatus: inventoryAlerts.status,
    };

    return dashboardData;
  }

  async _getVendorDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [listingStats, bookingStats, recentTransactions, revenueData, reviews] =
      await Promise.all([
        this._getVendorListingStats(vendorId),
        this._getVendorBookingStats(vendorId),        // no dateRange = all-time pending
        this._getVendorRecentTransactions(vendorId, 10),
        this._getVendorRevenueData(vendorId, "month"),
        this._getVendorRecentReviews(vendorId, 5),
      ]);

    dashboardData.stats = {
      ...listingStats,
      ...bookingStats,
      balance:          user.vendor.balance         || 0,
      lifetimeEarnings: user.vendor.lifetimeEarnings || 0,
      averageRating:    user.vendor.overallRating    || 0,
    };

    dashboardData.recentActivity = [
      ...recentTransactions.map((t) => ({
        id: `transaction-${t.id}`, type: "TRANSACTION",
        title: t.type === "CREDIT" ? "Payment Received" : "Payout Processed",
        description: `$${t.amount} - ${t.description || ""}`,
        timestamp: t.createdAt, icon: t.type === "CREDIT" ? "arrow-down" : "arrow-up",
        color: t.type === "CREDIT" ? "green" : "red", data: t,
      })),
      ...reviews.map((r) => ({
        id: `review-${r.id}`, type: "NEW_REVIEW", title: "New Review",
        description: `${r.rating}★ - ${r.comment?.substring(0, 50)}${(r.comment?.length > 50) ? "..." : ""}`,
        timestamp: r.createdAt, icon: "star", color: "yellow", data: r,
      })),
    ].slice(0, 20);

    dashboardData.quickActions = [
      { id: "add-listing",   label: "Add Listing",   icon: "plus-circle",  url: "/vendor/listings/add", color: "blue"   },
      { id: "view-bookings", label: "View Bookings", icon: "calendar",     url: "/vendor/bookings",     color: "green"  },
      { id: "earnings",      label: "Earnings",      icon: "dollar-sign",  url: "/vendor/earnings",     count: `$${user.vendor.balance || 0}`, color: "purple" },
      { id: "reviews",       label: "Reviews",       icon: "star",         url: "/vendor/reviews",      count: reviews.length, color: "yellow" },
    ];

    dashboardData.overview = {
      activeListings:  listingStats.active,
      pendingBookings: bookingStats.pending,
      revenue:         revenueData.total,
      recentReviews:   reviews.length,
    };

    return dashboardData;
  }

  async _getUserDashboard(userId, dashboardData) {
    const [travelPlans, upcomingTrips, savedItems, recentActivity, recommendations] =
      await Promise.all([
        this._getUserTravelPlans(userId, 3),
        this._getUserUpcomingTrips(userId, 5),
        this._getUserSavedItems(userId, 5),
        this._getUserRecentActivity(userId, 10),
        this._getUserRecommendations(userId, 5),
      ]);

    dashboardData.stats = {
      totalTravelPlans: travelPlans.total,
      upcomingTrips:    upcomingTrips.length,
      savedItems:       savedItems.length,
      completedTrips:   travelPlans.completed || 0,
      totalSpent:       travelPlans.totalSpent || 0,
    };

    dashboardData.recentActivity  = recentActivity;
    dashboardData.travelPlans     = travelPlans.items;
    dashboardData.upcomingTrips   = upcomingTrips;
    dashboardData.savedItems      = savedItems;
    dashboardData.recommendations = recommendations;

    dashboardData.quickActions = [
      { id: "create-trip", label: "Create Trip", icon: "plus-circle", url: "/travel-plans/new", color: "blue"   },
      { id: "my-trips",    label: "My Trips",    icon: "plane",        url: "/travel-plans",    color: "green"  },
      { id: "saved",       label: "Saved",       icon: "bookmark",    url: "/saved",            count: savedItems.length, color: "purple" },
      { id: "profile",     label: "Profile",     icon: "user",        url: "/profile",          color: "gray"   },
    ];

    dashboardData.overview = {
      nextTrip:        upcomingTrips[0] || null,
      recentPlans:     travelPlans.items,
      recommendations: recommendations.length,
    };

    return dashboardData;
  }

  // ==================== OVERVIEW BUILDERS ====================

  async _getSuperAdminOverview() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [usersToday, vendorsToday, bookingsToday, revenueToday, activeUsers, activeVendors, systemHealth] =
      await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: today } } }),
        prisma.vendor.count({ where: { createdAt: { gte: today } } }),
        this._getBookingsCountSince(today),
        this._getRevenueSince(today),
        prisma.user.count({ where: { lastLoginAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        prisma.vendor.count({ where: { isActive: true } }),
        this._getSystemHealth(),
      ]);

    return {
      today:  { newUsers: usersToday, newVendors: vendorsToday, newBookings: bookingsToday, revenue: revenueToday },
      active: { users: activeUsers, vendors: activeVendors },
      health: systemHealth,
    };
  }

  async _getVendorOverview(vendorId, vendorRole) {
    const today       = new Date(); today.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - 7);

    const [totalListings, activeListings, todayBookings, weekBookings, todayRevenue, weekRevenue,
           pendingOrders, lowStockAlerts, recentReviews, teamActivity] =
      await Promise.all([
        this._getVendorTotalListingsCount(vendorId),
        this._getVendorActiveListingsCount(vendorId),
        this._getVendorBookingsCount(vendorId, { gte: today }),
        this._getVendorBookingsCount(vendorId, { gte: startOfWeek }),
        this._getVendorRevenueInRange(vendorId, { start: today, end: new Date() }),
        this._getVendorRevenueInRange(vendorId, { start: startOfWeek, end: new Date() }),
        this._getVendorPendingOrdersCount(vendorId),
        this._getVendorLowStockAlerts(vendorId),
        prisma.vendorReview.count({ where: { vendorId, createdAt: { gte: startOfWeek } } }),
        (vendorRole === "ADMIN" || vendorRole === "MANAGER" || vendorRole === "OWNER")
          ? this._getVendorTeamActivity(vendorId)
          : Promise.resolve(0),
      ]);

    return {
      listings: { total: totalListings, active: activeListings, occupancyRate: totalListings > 0 ? Math.round((activeListings / totalListings) * 100) : 0 },
      bookings: { today: todayBookings, week: weekBookings, pending: pendingOrders },
      revenue:  { today: todayRevenue,  week: weekRevenue,  averagePerDay: weekBookings > 0 ? Math.round(weekRevenue / 7) : 0 },
      alerts:   { lowStock: lowStockAlerts, pendingOrders },
      engagement: { reviews: recentReviews, teamActivity },
      performance: { rating: await this._getVendorAverageRating(vendorId) },
    };
  }

  async _getUserOverview(userId) {
    const [nextTrip, recentPlans, totalSpent, savedCount] = await Promise.all([
      this._getUserNextTrip(userId),
      this._getUserRecentPlans(userId, 3),
      this._getUserTotalSpent(userId),
      this._getUserSavedCount(userId),
    ]);

    return {
      nextTrip,
      recentPlans,
      totalSpent,
      savedCount,
      memberSince: await this._getUserMemberSince(userId),
    };
  }

  // ==================== STATS BUILDERS ====================

  /**
   * Super-admin statistics (single authoritative definition).
   */
  async _getSuperAdminStats(period, category) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      period,
      users:    await this._getUserStatsByPeriod(dateRange),
      vendors:  await this._getVendorStatsByPeriod(dateRange),
      bookings: await this._getBookingStatsByPeriod(dateRange),
      revenue:  await this._getRevenueStatsByPeriod(dateRange),
      platform: await this._getPlatformStats(),
    };

    if (category && baseStats[category]) return { [category]: baseStats[category] };
    return baseStats;
  }

  /**
   * Vendor statistics (single authoritative definition).
   */
  async _getVendorStats(vendorId, period, category, vendorRole) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      listings:    await this._getVendorListingStats(vendorId),
      bookings:    await this._getVendorBookingStats(vendorId, dateRange),
      revenue:     await this._getVendorRevenueStats(vendorId, dateRange),
      performance: await this._getVendorPerformanceStats(vendorId),
    };

    if (vendorRole === "ADMIN" || vendorRole === "MANAGER" || vendorRole === "OWNER") {
      baseStats.team = await this._getVendorTeamStats(vendorId);
    }

    if (category && baseStats[category]) return { [category]: baseStats[category] };
    return baseStats;
  }

  /**
   * User statistics (single authoritative definition).
   */
  async _getUserStats(userId, period, category) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      travelPlans: await this._getUserTravelPlanStats(userId, dateRange),
      bookings:    await this._getUserBookingStats(userId, dateRange),
      spending:    await this._getUserSpendingStats(userId, dateRange),
      activity:    await this._getUserActivityStats(userId, dateRange),
    };

    if (category && baseStats[category]) return { [category]: baseStats[category] };
    return baseStats;
  }

  // ==================== CHART DATA ====================

  async _getSuperAdminChartData(chart, period) {
    const dateRange = this._getDateRange(period);
    switch (chart) {
      case "user-growth":  return this._getUserGrowthChart(dateRange);
      case "revenue":      return this._getRevenueChart(dateRange);
      case "bookings":     return this._getBookingsChart(dateRange);
      case "vendor-types": return this._getVendorTypeDistribution();
      default:             return {};
    }
  }

  async _getVendorChartData(vendorId, chart, period) {
    const dateRange = this._getDateRange(period);
    switch (chart) {
      case "sales":                 return this._getVendorSalesChart(vendorId, dateRange);
      case "bookings":              return this._getVendorBookingsChart(vendorId, dateRange);
      case "revenue":               return this._getVendorRevenueChart(vendorId, dateRange);
      case "popular-items":         return this._getVendorPopularItemsChart(vendorId, dateRange);
      case "customer-demographics": return this._getVendorCustomerDemographicsChart(vendorId, dateRange);
      default:                      return {};
    }
  }

  async _getUserChartData(userId, chart, period) {
    const dateRange = this._getDateRange(period);
    switch (chart) {
      case "travel-stats": return this._getUserTravelChart(userId, dateRange);
      case "spending":     return this._getUserSpendingChart(userId, dateRange);
      case "activity":     return this._getUserActivityChart(userId, dateRange);
      default:             return {};
    }
  }

  // ── Vendor charts ──────────────────────────────────────────────────────────

  async _getVendorSalesChart(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.findMany({ where: { accommodation: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, totalCost: true } }),
      prisma.transportationBooking.findMany({ where: { provider: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, actualFare: true } }),
      prisma.travelPackageBooking.findMany({ where: { package: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, finalAmount: true } }),
      prisma.experienceBooking.findMany({ where: { experience: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, totalAmount: true } }),
    ]);

    const groupedData = this._groupByTimePeriod(accommodation, transportation, packages, experiences, dateRange);
    return {
      labels: groupedData.labels,
      datasets: [
        { label: "Accommodation",  data: groupedData.accommodation,  backgroundColor: "rgba(54,162,235,0.5)",  borderColor: "rgba(54,162,235,1)",  borderWidth: 1 },
        { label: "Transportation", data: groupedData.transportation, backgroundColor: "rgba(255,99,132,0.5)",  borderColor: "rgba(255,99,132,1)",  borderWidth: 1 },
        { label: "Packages",       data: groupedData.packages,       backgroundColor: "rgba(75,192,192,0.5)",  borderColor: "rgba(75,192,192,1)",  borderWidth: 1 },
        { label: "Experiences",    data: groupedData.experiences,    backgroundColor: "rgba(153,102,255,0.5)", borderColor: "rgba(153,102,255,1)", borderWidth: 1 },
      ],
    };
  }

  async _getVendorBookingsChart(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.groupBy({ by: ["createdAt"], where: { accommodation: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { createdAt: "asc" } }),
      prisma.transportationBooking.groupBy({ by: ["createdAt"], where: { provider: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { createdAt: "asc" } }),
      prisma.travelPackageBooking.groupBy({ by: ["createdAt"], where: { package: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { createdAt: "asc" } }),
      prisma.experienceBooking.groupBy({ by: ["createdAt"], where: { experience: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { createdAt: "asc" } }),
    ]);

    const groupedData = this._groupCountByTimePeriod(accommodation, transportation, packages, experiences, dateRange);
    return {
      labels: groupedData.labels,
      datasets: [
        { label: "Accommodation Bookings",  data: groupedData.accommodation,  backgroundColor: "rgba(54,162,235,0.5)",  borderColor: "rgba(54,162,235,1)",  borderWidth: 1 },
        { label: "Transportation Bookings", data: groupedData.transportation, backgroundColor: "rgba(255,99,132,0.5)",  borderColor: "rgba(255,99,132,1)",  borderWidth: 1 },
        { label: "Package Bookings",        data: groupedData.packages,       backgroundColor: "rgba(75,192,192,0.5)",  borderColor: "rgba(75,192,192,1)",  borderWidth: 1 },
        { label: "Experience Bookings",     data: groupedData.experiences,    backgroundColor: "rgba(153,102,255,0.5)", borderColor: "rgba(153,102,255,1)", borderWidth: 1 },
      ],
    };
  }

  async _getVendorRevenueChart(vendorId, dateRange) {
    const revenueData = await this._getVendorRevenueStats(vendorId, dateRange);
    return {
      labels: ["Accommodation", "Transportation", "Packages", "Experiences"],
      datasets: [{
        label: "Revenue by Category",
        data: [revenueData.byType.accommodations, revenueData.byType.transportation, revenueData.byType.packages, revenueData.byType.experiences],
        backgroundColor: ["rgba(54,162,235,0.5)", "rgba(255,99,132,0.5)", "rgba(75,192,192,0.5)", "rgba(153,102,255,0.5)"],
        borderColor:     ["rgba(54,162,235,1)",   "rgba(255,99,132,1)",   "rgba(75,192,192,1)",   "rgba(153,102,255,1)"  ],
        borderWidth: 1,
      }],
    };
  }

  async _getVendorPopularItemsChart(vendorId, dateRange) {
    const [topAccommodations, topExperiences] = await Promise.all([
      prisma.accommodationBooking.groupBy({ by: ["accommodationId"], where: { accommodation: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { _count: { id: "desc" } }, take: 5 }),
      prisma.experienceBooking.groupBy({ by: ["experienceId"], where: { experience: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _count: true, orderBy: { _count: { id: "desc" } }, take: 5 }),
    ]);

    // FIX: resolve names in parallel (N+1 → Promise.all)
    const [accommodationNames, experienceNames] = await Promise.all([
      Promise.all(topAccommodations.map(async (item) => {
        const acc = await prisma.accommodation.findUnique({ where: { id: item.accommodationId }, select: { name: true } });
        return acc?.name || "Unknown";
      })),
      Promise.all(topExperiences.map(async (item) => {
        const exp = await prisma.vendorExperience.findUnique({ where: { id: item.experienceId }, select: { name: true } });
        // FIX: was `exp?.title` — field is `name`
        return exp?.name || "Unknown";
      })),
    ]);

    return {
      labels: [...accommodationNames, ...experienceNames].slice(0, 10),
      datasets: [{
        label: "Popular Items",
        data: [...topAccommodations.map((a) => a._count), ...topExperiences.map((e) => e._count)].slice(0, 10),
        backgroundColor: "rgba(255,159,64,0.5)",
        borderColor:     "rgba(255,159,64,1)",
        borderWidth: 1,
      }],
    };
  }

  async _getVendorCustomerDemographicsChart(vendorId, dateRange) {
    try {
      const getUserIdsFromBookings = async (model, whereCondition) => {
        const bookings = await model.findMany({
          where: { ...whereCondition, createdAt: { gte: dateRange.start, lte: dateRange.end } },
          select: { travelPlan: { select: { userId: true } } },
          distinct: ["travelPlanId"],
        });
        return bookings.map((b) => b.travelPlan?.userId).filter(Boolean);
      };

      const [accUserIds, transUserIds, pkgUserIds, expUserIds] = await Promise.all([
        getUserIdsFromBookings(prisma.accommodationBooking,  { accommodation: { vendorId } }),
        getUserIdsFromBookings(prisma.transportationBooking, { provider:      { vendorId } }),
        getUserIdsFromBookings(prisma.travelPackageBooking,  { package:       { vendorId } }),
        getUserIdsFromBookings(prisma.experienceBooking,     { experience:    { vendorId } }),
      ]);

      const uniqueUserIds = [...new Set([...accUserIds, ...transUserIds, ...pkgUserIds, ...expUserIds])];
      if (uniqueUserIds.length === 0) {
        return {
          byCountry: { labels: [], datasets: [{ data: [] }] },
          byAge:     { labels: [], datasets: [{ data: [] }] },
        };
      }

      const users = await prisma.user.findMany({ where: { id: { in: uniqueUserIds } }, include: { profile: true } });

      const byCountry = {};
      users.forEach((u) => { const c = u.profile?.nationality || "Unknown"; byCountry[c] = (byCountry[c] || 0) + 1; });

      const byAge = { "18-25": 0, "26-35": 0, "36-50": 0, "50+": 0, Unknown: 0 };
      users.forEach((u) => {
        if (u.profile?.dateOfBirth) {
          const age = this._calculateAge(u.profile.dateOfBirth);
          if (age <= 25)      byAge["18-25"]++;
          else if (age <= 35) byAge["26-35"]++;
          else if (age <= 50) byAge["36-50"]++;
          else                byAge["50+"]++;
        } else {
          byAge.Unknown++;
        }
      });

      return {
        byCountry: { labels: Object.keys(byCountry), datasets: [{ data: Object.values(byCountry), backgroundColor: "rgba(75,192,192,0.5)", borderColor: "rgba(75,192,192,1)", borderWidth: 1 }] },
        byAge:     { labels: Object.keys(byAge),     datasets: [{ data: Object.values(byAge),     backgroundColor: "rgba(153,102,255,0.5)", borderColor: "rgba(153,102,255,1)", borderWidth: 1 }] },
      };
    } catch (err) {
      console.error("Error in _getVendorCustomerDemographicsChart:", err);
      return {
        byCountry: { labels: [], datasets: [{ data: [] }] },
        byAge:     { labels: [], datasets: [{ data: [] }] },
        error: "Failed to load demographics data",
      };
    }
  }

  // ── Super-admin charts ─────────────────────────────────────────────────────

  async _getUserGrowthChart(dateRange) {
    const users = await prisma.user.findMany({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true } });
    const byMonth = {};
    users.forEach((u) => { const m = u.createdAt.toISOString().substring(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; });
    const months = Object.keys(byMonth).sort();
    return { labels: months, datasets: [{ label: "New Users", data: months.map((m) => byMonth[m]) }] };
  }

  async _getRevenueChart(dateRange) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.findMany({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, totalCost: true } }),
      prisma.transportationBooking.findMany({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, actualFare: true } }),
      prisma.travelPackageBooking.findMany({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, finalAmount: true } }),
      prisma.experienceBooking.findMany({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, select: { createdAt: true, totalAmount: true } }),
    ]);

    const byMonth = {};
    const add = (items, field) => items.forEach((b) => { const m = b.createdAt.toISOString().substring(0, 7); byMonth[m] = (byMonth[m] || 0) + (b[field] || 0); });
    add(acc,   "totalCost");
    add(trans, "actualFare");
    add(pkg,   "finalAmount");
    add(exp,   "totalAmount");

    const months = Object.keys(byMonth).sort();
    return { labels: months, datasets: [{ label: "Revenue", data: months.map((m) => byMonth[m]) }] };
  }

  async _getBookingsChart(dateRange) {
    const bookings = await prisma.$queryRaw`
      SELECT DATE(created_at) as date, COUNT(*) as count, 'accommodation' as type
      FROM accommodation_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT DATE(created_at) as date, COUNT(*) as count, 'transportation' as type
      FROM transportation_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT DATE(created_at) as date, COUNT(*) as count, 'package' as type
      FROM travel_package_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT DATE(created_at) as date, COUNT(*) as count, 'experience' as type
      FROM experience_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    const byDate = {};
    bookings.forEach((b) => {
      const dateStr = b.date instanceof Date ? b.date.toISOString().split("T")[0] : String(b.date);
      if (!byDate[dateStr]) byDate[dateStr] = { accommodation: 0, transportation: 0, package: 0, experience: 0 };
      byDate[dateStr][b.type] = Number(b.count);
    });

    const dates = Object.keys(byDate).sort();
    return {
      labels: dates,
      datasets: [
        { label: "Accommodation",  data: dates.map((d) => byDate[d].accommodation)  },
        { label: "Transportation", data: dates.map((d) => byDate[d].transportation) },
        { label: "Packages",       data: dates.map((d) => byDate[d].package)        },
        { label: "Experiences",    data: dates.map((d) => byDate[d].experience)     },
      ],
    };
  }

  async _getVendorTypeDistribution() {
    const vendors = await prisma.vendor.findMany({ select: { vendorType: true } });
    const distribution = {};
    vendors.forEach((v) => v.vendorType.forEach((type) => { distribution[type] = (distribution[type] || 0) + 1; }));
    return { labels: Object.keys(distribution), data: Object.values(distribution) };
  }

  // ── User charts ────────────────────────────────────────────────────────────

  async _getUserTravelChart(userId, dateRange) {
    // FIX: was `createdAt: dateRange` — Prisma needs `{ gte, lte }` not the raw dateRange object
    const plans = await prisma.travelPlan.findMany({
      where: { userId, createdAt: { gte: dateRange.start, lte: dateRange.end } },
      select: { createdAt: true, status: true },
    });

    const byMonth = {};
    plans.forEach((p) => {
      const m = p.createdAt.toISOString().substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { total: 0, completed: 0, planning: 0 };
      byMonth[m].total++;
      if (p.status === "COMPLETED") byMonth[m].completed++;
      else if (p.status === "PLANNING") byMonth[m].planning++;
    });

    const months = Object.keys(byMonth).sort();
    return {
      labels: months,
      datasets: [
        { label: "Total",     data: months.map((m) => byMonth[m].total)     },
        { label: "Completed", data: months.map((m) => byMonth[m].completed) },
      ],
    };
  }

  async _getUserSpendingChart(userId, dateRange) {
    // FIX: was `createdAt: dateRange` everywhere
    const filter = { gte: dateRange.start, lte: dateRange.end };

    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.groupBy({ by: ["createdAt"], where: { travelPlan: { userId }, createdAt: filter }, _sum: { totalCost: true } }),
      prisma.transportationBooking.groupBy({ by: ["createdAt"], where: { travelPlan: { userId }, createdAt: filter }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.groupBy({ by: ["createdAt"], where: { travelPlan: { userId }, createdAt: filter }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.groupBy({ by: ["createdAt"], where: { travelPlan: { userId }, createdAt: filter }, _sum: { totalAmount: true } }),
    ]);

    const byMonth = {};
    const addBookings = (bookings, type, field) => bookings.forEach((b) => {
      const m = b.createdAt.toISOString().substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { accommodation: 0, transportation: 0, packages: 0, experiences: 0 };
      byMonth[m][type] += b._sum[field] || 0;
    });

    addBookings(acc,   "accommodation",  "totalCost");
    addBookings(trans, "transportation", "actualFare");
    addBookings(pkg,   "packages",       "finalAmount");
    addBookings(exp,   "experiences",    "totalAmount");

    const months = Object.keys(byMonth).sort();
    return {
      labels: months,
      datasets: [
        { label: "Accommodation",  data: months.map((m) => byMonth[m].accommodation)  },
        { label: "Transportation", data: months.map((m) => byMonth[m].transportation) },
        { label: "Packages",       data: months.map((m) => byMonth[m].packages)       },
        { label: "Experiences",    data: months.map((m) => byMonth[m].experiences)    },
      ],
    };
  }

  async _getUserActivityChart(userId, dateRange) {
    const activities = await prisma.$queryRaw`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM (
        SELECT created_at FROM travel_plans WHERE user_id = ${userId}
        UNION ALL
        SELECT created_at FROM accommodation_bookings WHERE travel_plan_id IN (SELECT id FROM travel_plans WHERE user_id = ${userId})
        UNION ALL
        SELECT created_at FROM transportation_bookings WHERE travel_plan_id IN (SELECT id FROM travel_plans WHERE user_id = ${userId})
      ) as activities
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    return {
      labels: activities.map((a) => (a.date instanceof Date ? a.date.toISOString().split("T")[0] : String(a.date))),
      data:   activities.map((a) => Number(a.count)),
    };
  }

  // ── Chart helpers ─────────────────────────────────────────────────────────

  _groupByTimePeriod(accommodation, transportation, packages, experiences, dateRange) {
    const useDaily = Math.ceil((dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24)) <= 31;
    const grouped  = {};

    const processItems = (items, type) => {
      items.forEach((item) => {
        const date = new Date(item.createdAt);
        const key  = useDaily ? date.toISOString().split("T")[0] : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!grouped[key]) grouped[key] = { accommodation: 0, transportation: 0, packages: 0, experiences: 0 };
        if (type === "accommodation")  grouped[key].accommodation  += item.totalCost   || 0;
        if (type === "transportation") grouped[key].transportation += item.actualFare  || 0;
        if (type === "packages")       grouped[key].packages       += item.finalAmount || 0;
        if (type === "experiences")    grouped[key].experiences    += item.totalAmount || 0;
      });
    };

    processItems(accommodation, "accommodation");
    processItems(transportation, "transportation");
    processItems(packages, "packages");
    processItems(experiences, "experiences");

    const keys = Object.keys(grouped).sort();
    return { labels: keys, accommodation: keys.map((k) => grouped[k].accommodation), transportation: keys.map((k) => grouped[k].transportation), packages: keys.map((k) => grouped[k].packages), experiences: keys.map((k) => grouped[k].experiences) };
  }

  _groupCountByTimePeriod(accommodation, transportation, packages, experiences, dateRange) {
    const useDaily = Math.ceil((dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24)) <= 31;
    const grouped  = {};

    const processItems = (items, type) => {
      items.forEach((item) => {
        const date = new Date(item.createdAt);
        const key  = useDaily ? date.toISOString().split("T")[0] : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!grouped[key]) grouped[key] = { accommodation: 0, transportation: 0, packages: 0, experiences: 0 };
        grouped[key][type] += Number(item._count) || 1;
      });
    };

    processItems(accommodation, "accommodation");
    processItems(transportation, "transportation");
    processItems(packages, "packages");
    processItems(experiences, "experiences");

    const keys = Object.keys(grouped).sort();
    return { labels: keys, accommodation: keys.map((k) => grouped[k].accommodation), transportation: keys.map((k) => grouped[k].transportation), packages: keys.map((k) => grouped[k].packages), experiences: keys.map((k) => grouped[k].experiences) };
  }

  _calculateAge(birthdate) {
    const today     = new Date();
    const birthDate = new Date(birthdate);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }

  // ==================== UPCOMING ITEMS ====================

  async _getSuperAdminUpcoming(limit) {
    const [pendingVendors, pendingPayouts, upcomingReviews] = await Promise.all([
      prisma.vendor.findMany({ where: { verificationStatus: "PENDING" }, take: limit, orderBy: { createdAt: "asc" } }),
      prisma.payout.findMany({ where: { status: "PENDING" }, take: limit, orderBy: { requestedAt: "asc" }, include: { vendor: { select: { businessName: true } } } }),
      this._getUpcomingReviews(limit),
    ]);

    return [
      ...pendingVendors.map((v) => ({ id: `vendor-${v.id}`, type: "PENDING_VENDOR",  title: "Pending Vendor Verification", description: v.businessName, date: v.createdAt,     priority: "high",   action: `/admin/vendors/${v.id}` })),
      ...pendingPayouts.map((p) => ({ id: `payout-${p.id}`, type: "PENDING_PAYOUT",  title: "Pending Payout Request",      description: `${p.vendor.businessName} - $${p.amount}`, date: p.requestedAt, priority: "medium", action: `/admin/payouts/${p.id}` })),
      ...upcomingReviews,
    ].slice(0, limit);
  }

  async _getVendorUpcoming(vendorId, limit, vendorRole) {
    const isManager = vendorRole === "ADMIN" || vendorRole === "MANAGER" || vendorRole === "OWNER";
    const isAdmin   = vendorRole === "ADMIN" || vendorRole === "OWNER";

    const [upcomingBookings, pendingTaskItems, scheduledMaintenance, teamEvents, pendingApprovalItems] =
      await Promise.all([
        this._getVendorUpcomingBookings(vendorId, limit),
        isManager ? this._getVendorPendingTaskItems(vendorId, limit) : Promise.resolve([]),
        this._getVendorScheduledMaintenance(vendorId, limit),
        isAdmin   ? this._getVendorTeamEvents(vendorId, limit)     : Promise.resolve([]),
        isAdmin   ? this._getVendorPendingApprovalItems(vendorId, limit) : Promise.resolve([]),
      ]);

    return [...upcomingBookings, ...pendingTaskItems, ...scheduledMaintenance, ...teamEvents, ...pendingApprovalItems]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  }

  async _getUserUpcoming(userId, limit) {
    const [upcomingTrips, upcomingBookings, pendingPayments] = await Promise.all([
      this._getUserUpcomingTrips(userId, limit),
      this._getUserUpcomingBookings(userId, limit),
      this._getUserPendingPayments(userId, limit),
    ]);

    return [
      ...upcomingTrips.map((trip) => ({ id: `trip-${trip.id}`, type: "TRIP", title: trip.title, description: `${trip.destination} - ${new Date(trip.startDate).toLocaleDateString()}`, date: trip.startDate, icon: "plane", color: "blue", action: `/travel-plans/${trip.id}` })),
      ...upcomingBookings.map((b) => ({ id: `booking-${b.id}`, type: "BOOKING", title: b.title || "Booking", description: b.description, date: b.date, icon: "calendar-check", color: "green", action: b.url })),
      ...pendingPayments.map((p) => ({ id: `payment-${p.id}`, type: "PAYMENT", title: "Pending Payment", description: `$${p.amount} - Due ${new Date(p.dueDate).toLocaleDateString()}`, date: p.dueDate, icon: "credit-card", color: "yellow", action: p.url, priority: "high" })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, limit);
  }

  async _getVendorUpcomingBookings(vendorId, limit = 10) {
    const now             = new Date();
    const thirtyDaysFromNow = new Date(now); thirtyDaysFromNow.setDate(now.getDate() + 30);

    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.findMany({
        where: { accommodation: { vendorId }, checkInDate: { gte: now, lte: thirtyDaysFromNow }, bookingStatus: { in: ["CONFIRMED", "PENDING"] } },
        take: Math.ceil(limit / 4), orderBy: { checkInDate: "asc" },
        include: { accommodation: { select: { name: true } }, travelPlan: { select: { title: true, user: { select: { name: true } } } } },
      }),
      prisma.transportationBooking.findMany({
        where: { provider: { vendorId }, pickupTime: { gte: now, lte: thirtyDaysFromNow }, status: { in: ["CONFIRMED", "BOOKED"] } },
        take: Math.ceil(limit / 4), orderBy: { pickupTime: "asc" },
        include: { provider: { select: { name: true } }, travelPlan: { select: { title: true, user: { select: { name: true } } } } },
      }),
      prisma.travelPackageBooking.findMany({
        where: { package: { vendorId }, startDate: { gte: now, lte: thirtyDaysFromNow }, status: { in: ["CONFIRMED", "PENDING"] } },
        take: Math.ceil(limit / 4), orderBy: { startDate: "asc" },
        // FIX: package.name (not .title)
        include: { package: { select: { name: true } }, travelPlan: { select: { title: true, user: { select: { name: true } } } } },
      }),
      prisma.experienceBooking.findMany({
        where: { experience: { vendorId }, experienceDate: { gte: now, lte: thirtyDaysFromNow }, status: { in: ["CONFIRMED", "PENDING"] } },
        take: Math.ceil(limit / 4), orderBy: { experienceDate: "asc" },
        // FIX: experience.name (not .title)
        include: { experience: { select: { name: true } }, travelPlan: { select: { title: true, user: { select: { name: true } } } } },
      }),
    ]);

    return [
      ...accommodation.map((b) => ({
        id: `acc-booking-${b.id}`, type: "booking", category: "accommodation",
        // FIX: removed booking.totalNights (field doesn't exist on AccommodationBooking)
        title: `Check-in: ${b.accommodation.name}`,
        description: `Guest: ${b.travelPlan?.user?.name || "Unknown"}`,
        date: b.checkInDate, status: b.bookingStatus,
        priority: this._getBookingPriority(b.checkInDate), action: `/vendor/bookings/accommodation/${b.id}`, icon: "hotel", color: "blue",
      })),
      ...transportation.map((b) => ({
        id: `trans-booking-${b.id}`, type: "booking", category: "transportation",
        title: `Pickup: ${b.provider.name}`,
        description: `Customer: ${b.travelPlan?.user?.name || "Unknown"} • ${b.numberOfPassengers || 1} passengers`,
        date: b.pickupTime, status: b.status,
        priority: this._getBookingPriority(b.pickupTime), action: `/vendor/bookings/transportation/${b.id}`, icon: "car", color: "green",
      })),
      ...packages.map((b) => ({
        id: `pkg-booking-${b.id}`, type: "booking", category: "package",
        // FIX: b.package.name (not .title)
        title: `Package: ${b.package.name}`,
        description: `Customer: ${b.travelPlan?.user?.name || "Unknown"} • ${b.numberOfTravelers  || 1} travelers`,
        date: b.startDate, status: b.status,
        priority: this._getBookingPriority(b.startDate), action: `/vendor/bookings/package/${b.id}`, icon: "package", color: "purple",
      })),
      ...experiences.map((b) => ({
        id: `exp-booking-${b.id}`, type: "booking", category: "experience",
        // FIX: b.experience.name (not .title)
        title: `Experience: ${b.experience.name}`,
        description: `Customer: ${b.travelPlan?.user?.name || "Unknown"} • ${b.numberOfParticipants || "?"} participants`,
        date: b.experienceDate, status: b.status,
        priority: this._getBookingPriority(b.experienceDate), action: `/vendor/bookings/experience/${b.id}`, icon: "star", color: "yellow",
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  /**
   * Vendor pending task *items* (formatted array for upcoming feed).
   * Renamed from the items-version of _getVendorPendingTasks to avoid
   * collision with the stats-version used by _getVendorManagerDashboard.
   */
  async _getVendorPendingTaskItems(vendorId, limit = 10) {
    const pendingReviews = await prisma.vendorReview.findMany({
      where: { vendorId, response: null },
      take: limit,
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true } } },
    });

    return pendingReviews.map((review) => ({
      id: `task-review-${review.id}`, type: "task", category: "review",
      title: "Pending Review Response",
      description: `${review.user?.name || "A customer"} left a ${review.rating}★ review`,
      date: review.createdAt, priority: review.rating <= 3 ? "high" : "medium",
      action: `/vendor/reviews/${review.id}/respond`, icon: "chat", color: "yellow",
    }));
  }

  async _getVendorScheduledMaintenance(vendorId, limit) {
    // Placeholder — implement when a Maintenance model is added
    return [];
  }

  async _getVendorTeamEvents(vendorId, limit) {
    // Placeholder — implement when a Calendar/Event model is added
    return [];
  }

  /**
   * Vendor pending approval *items* (formatted array for upcoming feed).
   * Renamed from the items-version of _getVendorPendingApprovals to avoid
   * collision with the stats-version used by _getVendorAdminDashboard.
   */
  async _getVendorPendingApprovalItems(vendorId, limit = 10) {
    const [pendingListingItems, pendingTeamInvites, pendingPayouts] = await Promise.all([
      this._getVendorPendingListingItems(vendorId, Math.ceil(limit / 3)),
      prisma.vendorTeamMember.findMany({
        where: { vendorId, isActive: false, invitedAt: { not: null } },
        take: Math.ceil(limit / 3), orderBy: { invitedAt: "asc" },
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.payout.findMany({ where: { vendorId, status: "PENDING" }, take: Math.ceil(limit / 3), orderBy: { requestedAt: "asc" } }),
    ]);

    return [
      ...pendingListingItems.map((l) => ({ id: `approval-listing-${l.id}`, type: "approval", category: "listing", title: "Listing Pending Approval", description: `${l.name} requires verification`, date: l.createdAt, priority: "medium", action: `/vendor/listings/${l.id}/edit`, icon: "building", color: "blue" })),
      ...pendingTeamInvites.map((i) => ({ id: `approval-invite-${i.id}`, type: "approval", category: "team",    title: "Team Invite Pending",      description: `${i.user?.name || i.user?.email} hasn't accepted yet`, date: i.invitedAt, priority: "low",    action: `/vendor/team`, icon: "user-plus", color: "green" })),
      ...pendingPayouts.map((p)     => ({ id: `approval-payout-${p.id}`, type: "approval", category: "payout",  title: "Payout Request",           description: `$${p.amount} payout requested`, date: p.requestedAt, priority: "high",   action: `/vendor/payouts/${p.id}`, icon: "dollar-sign", color: "purple" })),
    ];
  }

  /**
   * Vendor pending listing *items* (formatted array for upcoming feed).
   */
  async _getVendorPendingListingItems(vendorId, limit = 10) {
    const [accommodations, experiences] = await Promise.all([
      prisma.accommodation.findMany({ where: { vendorId, isVerified: false }, take: limit, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true } }),
      // VendorExperience has no isVerified — show all active as pending review placeholder
      prisma.vendorExperience.findMany({ where: { vendorId, isActive: true }, take: limit, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true } }),
    ]);

    return [
      ...accommodations.map((a) => ({ id: a.id, name: a.name, type: "accommodation", createdAt: a.createdAt, status: "pending_verification" })),
      ...experiences.map((e)    => ({ id: e.id, name: e.name, type: "experience",     createdAt: e.createdAt, status: "active"               })),
    ].slice(0, limit);
  }

  _getBookingPriority(bookingDate) {
    const daysUntil = Math.ceil((new Date(bookingDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 2) return "high";
    if (daysUntil <= 7) return "medium";
    return "low";
  }

  // ==================== DATE RANGE (single authoritative definition) ====================

  /**
   * Returns { start, end, previousStart, previousEnd } for a named period.
   * previousStart/End are used for growth calculations.
   */
  _getDateRange(period) {
    const now   = new Date();
    const start = new Date();
    const end   = new Date();

    switch (period) {
      case "today":
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case "week":
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case "month":
        start.setMonth(now.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case "quarter":
        start.setMonth(now.getMonth() - 3);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case "year":
        start.setFullYear(now.getFullYear() - 1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      default:
        // Default to current calendar month
        return {
          start:         new Date(now.getFullYear(), now.getMonth(), 1),
          end:           now,
          previousStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          previousEnd:   new Date(now.getFullYear(), now.getMonth(), 0),
        };
    }

    const duration     = end   - start;
    const previousStart = new Date(start.getTime() - duration);
    const previousEnd   = new Date(end.getTime()   - duration);
    return { start, end, previousStart, previousEnd };
  }

  // ==================== PERIOD STATISTICS HELPERS ====================

  async _getUserStatsByPeriod(dateRange) {
    const [total, newUsers, activeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: dateRange.start } } }),
    ]);
    return { total, new: newUsers, active: activeUsers };
  }

  async _getVendorStatsByPeriod(dateRange) {
    const [total, newVendors, verifiedVendors, pendingVendors] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
      prisma.vendor.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.vendor.count({ where: { verificationStatus: "PENDING"  } }),
    ]);
    return { total, new: newVendors, verified: verifiedVendors, pending: pendingVendors };
  }

  async _getBookingStatsByPeriod(dateRange) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
      prisma.transportationBooking.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
      prisma.travelPackageBooking.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
      prisma.experienceBooking.count({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } } }),
    ]);
    return { total: accommodation + transportation + packages + experiences, byType: { accommodation, transportation, packages, experiences } };
  }

  async _getRevenueStatsByPeriod(dateRange) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalAmount: true } }),
    ]);

    const total = (accommodation._sum.totalCost || 0) + (transportation._sum.actualFare || 0) + (packages._sum.finalAmount || 0) + (experiences._sum.totalAmount || 0);
    return {
      total,
      byType: {
        accommodation: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages:  packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  async _getPlatformStats() {
    const [totalUsers, totalVendors, totalBookings, totalRevenue] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      this._getTotalBookingsCount(),
      this._getTotalRevenue(),
    ]);
    return { totalUsers, totalVendors, totalBookings, totalRevenue };
  }

  async _getTotalBookingsCount() {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.count(),
      prisma.transportationBooking.count(),
      prisma.travelPackageBooking.count(),
      prisma.experienceBooking.count(),
    ]);
    return acc + trans + pkg + exp;
  }

  /**
   * FIX: use `??` not `||` for zero-safe actualFare fallback.
   */
  async _getTotalRevenue() {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.aggregate({ _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ _sum: { actualFare: true, estimatedFare: true } }),
      prisma.travelPackageBooking.aggregate({ _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ _sum: { totalAmount: true } }),
    ]);

    return (
      (acc._sum.totalCost   ?? 0) +
      // FIX: `??` so a real zero actualFare is not replaced by estimatedFare
      (trans._sum.actualFare ?? trans._sum.estimatedFare ?? 0) +
      (pkg._sum.finalAmount  ?? 0) +
      (exp._sum.totalAmount  ?? 0)
    );
  }

  // ==================== USER STATISTICS HELPERS ====================

  async _getUserTravelPlanStats(userId, dateRange) {
    const [total, completed, planning, ongoing] = await Promise.all([
      prisma.travelPlan.count({ where: { userId } }),
      prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
      prisma.travelPlan.count({ where: { userId, status: "PLANNING"  } }),
      prisma.travelPlan.count({ where: { userId, status: "ONGOING"   } }),
    ]);
    return { total, completed, planning, ongoing };
  }

  /**
   * FIX: kept the correct first-definition form — explicit `gte/lte` instead of passing
   * the raw dateRange object as the `createdAt` filter (which Prisma rejects).
   */
  async _getUserBookingStats(userId, dateRange) {
    const filter = { gte: dateRange.start, lte: dateRange.end };
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.count({ where: { travelPlan: { userId }, createdAt: filter } }),
      prisma.transportationBooking.count({ where: { travelPlan: { userId }, createdAt: filter } }),
      prisma.travelPackageBooking.count({ where: { travelPlan: { userId }, createdAt: filter } }),
      prisma.experienceBooking.count({ where: { travelPlan: { userId }, createdAt: filter } }),
    ]);
    return { total: accommodation + transportation + packages + experiences, byType: { accommodation, transportation, packages, experiences } };
  }

  /**
   * FIX: explicit `gte/lte` filter.
   */
  async _getUserSpendingStats(userId, dateRange) {
    const filter = { gte: dateRange.start, lte: dateRange.end };
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { travelPlan: { userId }, createdAt: filter }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { travelPlan: { userId }, createdAt: filter }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where: { travelPlan: { userId }, createdAt: filter }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where: { travelPlan: { userId }, createdAt: filter }, _sum: { totalAmount: true } }),
    ]);

    const total = (accommodation._sum.totalCost || 0) + (transportation._sum.actualFare || 0) + (packages._sum.finalAmount || 0) + (experiences._sum.totalAmount || 0);
    return { total, byType: { accommodation: accommodation._sum.totalCost || 0, transportation: transportation._sum.actualFare || 0, packages: packages._sum.finalAmount || 0, experiences: experiences._sum.totalAmount || 0 } };
  }

  /**
   * FIX: `lastLogin` does not exist on Profile — read `lastLoginAt` from User instead.
   */
  async _getUserActivityStats(userId, dateRange) {
    const filter = { gte: dateRange.start, lte: dateRange.end };
    const [travelPlansCreated, bookingsMade, reviewsWritten, userRecord] = await Promise.all([
      prisma.travelPlan.count({ where: { userId, createdAt: filter } }),
      this._getUserBookingStats(userId, dateRange).then((s) => s.total),
      prisma.vendorReview.count({ where: { userId, createdAt: filter } }),
      // FIX: lastLoginAt is on User, not Profile
      prisma.user.findUnique({ where: { id: userId }, select: { lastLoginAt: true } }),
    ]);

    return { travelPlansCreated, bookingsMade, reviewsWritten, lastLogin: userRecord?.lastLoginAt };
  }

  // ==================== VENDOR STATISTICS HELPERS ====================

  async _getVendorListingStats(vendorId) {
    const [accommodations, providers, packages, experiences] = await Promise.all([
      prisma.accommodation.findMany({ where: { vendorId }, select: { id: true, isActive: true } }),
      prisma.transportationProvider.findMany({ where: { vendorId }, select: { id: true, isAvailable: true } }),
      prisma.travelPackage.findMany({ where: { vendorId }, select: { id: true, isActive: true } }),
      prisma.vendorExperience.findMany({ where: { vendorId }, select: { id: true, isActive: true } }),
    ]);

    return {
      total:  accommodations.length + providers.length + packages.length + experiences.length,
      active: accommodations.filter((a) => a.isActive).length + providers.filter((p) => p.isAvailable).length + packages.filter((p) => p.isActive).length + experiences.filter((e) => e.isActive).length,
      byType: { accommodations: accommodations.length, transportation: providers.length, packages: packages.length, experiences: experiences.length },
    };
  }

  /**
   * dateRange is optional — omit for all-time pending counts only.
   */
  async _getVendorBookingStats(vendorId, dateRange = null) {
    const whereClause = dateRange ? { createdAt: { gte: dateRange.start, lte: dateRange.end } } : {};

    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.count({ where: { ...whereClause, accommodation: { vendorId } } }),
      prisma.transportationBooking.count({ where: { ...whereClause, provider:      { vendorId } } }),
      prisma.travelPackageBooking.count({ where:  { ...whereClause, package:       { vendorId } } }),
      prisma.experienceBooking.count({ where:     { ...whereClause, experience:    { vendorId } } }),
    ]);

    const total = accommodation + transportation + packages + experiences;

    const [pendingAcc, pendingTrans, pendingPkg, pendingExp] = await Promise.all([
      prisma.accommodationBooking.count({ where: { accommodation: { vendorId }, bookingStatus: "PENDING" } }),
      prisma.transportationBooking.count({ where: { provider:      { vendorId }, status: "BOOKED"   } }),
      prisma.travelPackageBooking.count({ where:  { package:       { vendorId }, status: "PENDING"  } }),
      prisma.experienceBooking.count({ where:     { experience:    { vendorId }, status: "PENDING"  } }),
    ]);

    return {
      total,
      pending: pendingAcc + pendingTrans + pendingPkg + pendingExp,
      byType: { accommodations: accommodation, transportation, packages, experiences },
    };
  }

  async _getVendorRevenueStats(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { accommodation: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { provider:      { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where:  { package:       { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where:     { experience:    { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalAmount: true } }),
    ]);

    const total = (accommodation._sum.totalCost || 0) + (transportation._sum.actualFare || 0) + (packages._sum.finalAmount || 0) + (experiences._sum.totalAmount || 0);
    return { total, byType: { accommodations: accommodation._sum.totalCost || 0, transportation: transportation._sum.actualFare || 0, packages: packages._sum.finalAmount || 0, experiences: experiences._sum.totalAmount || 0 } };
  }

  /**
   * FIX: second definition correctly queries `averageRating` for package & experience,
   * but the ratings array still referenced `.rating` — now fixed to `.averageRating`.
   */
  async _getVendorPerformanceStats(vendorId) {
    const [accRating, transRating, 
      // pkgRating, expRating
    ] = await Promise.all([
      prisma.accommodation.aggregate({ where: { vendorId }, _avg: { starRating: true } }),
      prisma.transportationProvider.aggregate({ where: { vendorId }, _avg: { rating: true } }),
      // prisma.travelPackage.aggregate({ where: { vendorId }, _avg: { averageRating: true } }),
      // prisma.vendorExperience.aggregate({ where: { vendorId }, _avg: { averageRating: true } }),
    ]);
    // TravelPackage has no rating field at all — use review aggregation instead
const pkgRating = await prisma.vendorReview.aggregate({
  where: { vendor: { id: vendorId }, travelPackageId: { not: null }, isHidden: false },
  _avg: { rating: true },
});
const expRating = await prisma.vendorReview.aggregate({
  where: { vendor: { id: vendorId }, vendorExperienceId: { not: null }, isHidden: false },
  _avg: { rating: true },
});

// Then read: pkgRating._avg.rating, expRating._avg.rating
    // FIX: pkgRating._avg.averageRating and expRating._avg.averageRating (not .rating)
    const ratings = [
      accRating._avg.starRating,
      transRating._avg.rating,
      pkgRating._avg.rating,
      expRating._avg.rating,
    ].filter((r) => r !== null && r !== undefined);

    const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    return {
      averageRating,
      totalReviews: await prisma.vendorReview.count({ where: { vendorId } }),
      responseRate: await this._calculateResponseRate(vendorId),
    };
  }

  async _calculateResponseRate(vendorId) {
    const reviews = await prisma.vendorReview.findMany({ where: { vendorId }, select: { response: true } });
    if (reviews.length === 0) return 100;
    const responded = reviews.filter((r) => r.response).length;
    return Math.round((responded / reviews.length) * 100);
  }

  async _getVendorTeamStats(vendorId) {
    const [total, active, byRole] = await Promise.all([
      prisma.vendorTeamMember.count({ where: { vendorId } }),
      prisma.vendorTeamMember.count({ where: { vendorId, isActive: true } }),
      prisma.vendorTeamMember.groupBy({ by: ["role"], where: { vendorId }, _count: true }),
    ]);

    const roleBreakdown = {};
    byRole.forEach((item) => { roleBreakdown[item.role] = item._count; });
    return { total, active, byRole: roleBreakdown };
  }

  async _getVendorPerformanceMetrics(vendorId, role) {
    const [bookingStats, revenueStats, responseTime] = await Promise.all([
      this._getVendorBookingStats(vendorId, this._getDateRange("month")),
      this._getVendorRevenueStats(vendorId, this._getDateRange("month")),
      this._getVendorResponseTime(vendorId),
    ]);

    const metrics = {
      bookings: {
        total: bookingStats.total,
        pending: bookingStats.pending,
        conversionRate: bookingStats.total > 0 ? ((bookingStats.total - bookingStats.pending) / bookingStats.total) * 100 : 0,
      },
      revenue: {
        total: revenueStats.total,
        averagePerBooking: bookingStats.total > 0 ? revenueStats.total / bookingStats.total : 0,
      },
      responseTime,
    };

    if (role === "MANAGER" || role === "ADMIN" || role === "OWNER") {
      metrics.team = {
        productivity:   await this._getTeamProductivity(vendorId),
        taskCompletion: await this._getTaskCompletionRate(vendorId),
      };
    }

    return metrics;
  }

  // ── Vendor overview helpers ────────────────────────────────────────────────

  async _getVendorTotalListingsCount(vendorId) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodation.count({ where: { vendorId } }),
      prisma.transportationProvider.count({ where: { vendorId } }),
      prisma.travelPackage.count({ where: { vendorId } }),
      prisma.vendorExperience.count({ where: { vendorId } }),
    ]);
    return acc + trans + pkg + exp;
  }

  async _getVendorActiveListingsCount(vendorId) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodation.count({ where: { vendorId, isActive: true } }),
      prisma.transportationProvider.count({ where: { vendorId, isAvailable: true } }),
      prisma.travelPackage.count({ where: { vendorId, isActive: true } }),
      prisma.vendorExperience.count({ where: { vendorId, isActive: true } }),
    ]);
    return acc + trans + pkg + exp;
  }

  async _getVendorBookingsCount(vendorId, dateFilter) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.count({ where: { accommodation: { vendorId }, createdAt: dateFilter } }),
      prisma.transportationBooking.count({ where: { provider:      { vendorId }, createdAt: dateFilter } }),
      prisma.travelPackageBooking.count({ where:  { package:       { vendorId }, createdAt: dateFilter } }),
      prisma.experienceBooking.count({ where:     { experience:    { vendorId }, createdAt: dateFilter } }),
    ]);
    return acc + trans + pkg + exp;
  }

  async _getVendorRevenueInRange(vendorId, dateRange) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { accommodation: { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { provider:      { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where:  { package:       { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where:     { experience:    { vendorId }, createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalAmount: true } }),
    ]);
    return (acc._sum.totalCost || 0) + (trans._sum.actualFare || 0) + (pkg._sum.finalAmount || 0) + (exp._sum.totalAmount || 0);
  }

  async _getVendorPendingOrdersCount(vendorId) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.count({ where: { accommodation: { vendorId }, bookingStatus: "PENDING" } }),
      prisma.transportationBooking.count({ where: { provider:      { vendorId }, status: "BOOKED"   } }),
      prisma.travelPackageBooking.count({ where:  { package:       { vendorId }, status: "PENDING"  } }),
      prisma.experienceBooking.count({ where:     { experience:    { vendorId }, status: "PENDING"  } }),
    ]);
    return acc + trans + pkg + exp;
  }

  async _getVendorLowStockAlerts(vendorId) { return 0; /* placeholder */ }
  async _getVendorTeamActivity(vendorId)   { return 0; /* placeholder */ }

  async _getVendorAverageRating(vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { overallRating: true } });
    return vendor?.overallRating || 0;
  }

  // ==================== USER DATA HELPERS ====================

  async _getUserTravelPlans(userId, limit) {
    const [items, total, completed] = await Promise.all([
      prisma.travelPlan.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: { _count: { select: { accommodations: true, transportServices: true, experiences: true } } },
      }),
      prisma.travelPlan.count({ where: { userId } }),
      prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
    ]);
    return { items, total, completed };
  }

  async _getUserUpcomingTrips(userId, limit) {
    return prisma.travelPlan.findMany({
      where: { userId, startDate: { gte: new Date() } },
      orderBy: { startDate: "asc" },
      take: limit,
      select: { id: true, title: true, destination: true, startDate: true, endDate: true, status: true },
    });
  }

  async _getUserSavedItems(userId, limit) { return []; /* placeholder — needs SavedItem model */ }

  async _getUserRecentActivity(userId, limit) {
    const [travelPlans, bookings, reviews] = await Promise.all([
      prisma.travelPlan.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: Math.ceil(limit / 3), select: { id: true, title: true, updatedAt: true, status: true } }),
      this._getRecentBookingsForUser(userId, Math.ceil(limit / 3)),
      prisma.vendorReview.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 3), select: { id: true, rating: true, comment: true, createdAt: true, vendor: { select: { businessName: true } } } }),
    ]);

    const activities = [
      ...travelPlans.map((p) => ({ id: `plan-${p.id}`,   type: "TRAVEL_PLAN", title: "Travel Plan Updated",  description: p.title,                                         timestamp: p.updatedAt, icon: "map",           color: "blue",   data: p })),
      ...bookings.map((b)    => ({ id: `booking-${b.id}`, type: "BOOKING",     title: "Booking Created",      description: b.description,                                   timestamp: b.createdAt, icon: "calendar-check", color: "green",  data: b })),
      ...reviews.map((r)     => ({ id: `review-${r.id}`,  type: "REVIEW",      title: "Review Posted",        description: `${r.rating}★ for ${r.vendor.businessName}`,    timestamp: r.createdAt, icon: "star",           color: "yellow", data: r })),
    ];
    return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  }

  async _getUserRecommendations(userId, limit) { return []; /* placeholder */ }

  async _getUserNextTrip(userId) {
    return prisma.travelPlan.findFirst({
      where: { userId, startDate: { gte: new Date() } },
      orderBy: { startDate: "asc" },
      select: { id: true, title: true, destination: true, startDate: true, endDate: true },
    });
  }

  async _getUserRecentPlans(userId, limit) {
    return prisma.travelPlan.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, title: true, destination: true, startDate: true, status: true } });
  }

  async _getUserTotalSpent(userId) {
    const spending = await this._getUserSpendingStats(userId, { start: new Date(0), end: new Date() });
    return spending.total;
  }

  async _getUserSavedCount(userId)      { return 0; /* placeholder */ }
  async _getUserPendingPayments(userId, limit) { return []; /* placeholder */ }

  async _getUserMemberSince(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    return user?.createdAt;
  }

  async _getUserUpcomingBookings(userId, limit) {
    const [accommodation, transportation, experiences] = await Promise.all([
      prisma.accommodationBooking.findMany({
        where: { travelPlan: { userId }, checkInDate: { gt: new Date() }, bookingStatus: { in: ["CONFIRMED", "PENDING"] } },
        take: limit, orderBy: { checkInDate: "asc" },
        include: { accommodation: { select: { name: true } } },
      }),
      prisma.transportationBooking.findMany({
        where: { travelPlan: { userId }, pickupTime: { gt: new Date() }, status: { in: ["CONFIRMED", "BOOKED"] } },
        take: limit, orderBy: { pickupTime: "asc" },
        include: { provider: { select: { name: true } } },
      }),
      prisma.experienceBooking.findMany({
        where: { travelPlan: { userId }, experienceDate: { gt: new Date() }, status: { in: ["CONFIRMED", "PENDING"] } },
        take: limit, orderBy: { experienceDate: "asc" },
        // FIX: field is `name`, not `title`
        include: { experience: { select: { name: true } } },
      }),
    ]);

    return [
      ...accommodation.map((a) => ({ id: a.id, type: "accommodation", title: a.accommodation.name, date: a.checkInDate, status: a.bookingStatus, url: `/travel-plans/${a.travelPlanId}/accommodations/${a.id}` })),
      ...transportation.map((t) => ({ id: t.id, type: "transportation", title: t.provider.name,  date: t.pickupTime,   status: t.status,         url: `/travel-plans/${t.travelPlanId}/transportation/${t.id}` })),
      // FIX: was e.experience.title — field is name
      ...experiences.map((e)    => ({ id: e.id, type: "experience",     title: e.experience.name, date: e.experienceDate, status: e.status,       url: `/travel-plans/${e.travelPlanId}/experiences/${e.id}` })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, limit);
  }

  // ==================== RECENT ACTIVITY HELPERS ====================

  async _getRecentUsers(limit) {
    return prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, email: true, name: true, createdAt: true } });
  }

  async _getRecentVendors(limit) {
    return prisma.vendor.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, businessName: true, createdAt: true, user: { select: { name: true, email: true } } } });
  }

  async _getRecentBookings(limit) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.findMany({ take: Math.ceil(limit / 4), orderBy: { createdAt: "desc" }, include: { travelPlan: { select: { title: true } } } }),
      prisma.transportationBooking.findMany({ take: Math.ceil(limit / 4), orderBy: { createdAt: "desc" }, include: { travelPlan: { select: { title: true } } } }),
      prisma.travelPackageBooking.findMany({ take: Math.ceil(limit / 4), orderBy: { createdAt: "desc" }, include: { travelPlan: { select: { title: true } } } }),
      prisma.experienceBooking.findMany({ take: Math.ceil(limit / 4), orderBy: { createdAt: "desc" }, include: { travelPlan: { select: { title: true } } } }),
    ]);
    return [...acc, ...trans, ...pkg, ...exp].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  async _getRecentBookingsForUser(userId, limit) {
    const [acc, trans, exp] = await Promise.all([
      prisma.accommodationBooking.findMany({ where: { travelPlan: { userId } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, createdAt: true, bookingStatus: true, accommodation: { select: { name: true } } } }),
      prisma.transportationBooking.findMany({ where: { travelPlan: { userId } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, createdAt: true, status: true, provider: { select: { name: true } } } }),
      prisma.experienceBooking.findMany({ where: { travelPlan: { userId } }, orderBy: { createdAt: "desc" }, take: limit,
        // FIX: field is `name`
        select: { id: true, createdAt: true, status: true, experience: { select: { name: true } } } }),
    ]);

    return [
      ...acc.map((a)  => ({ id: a.id, type: "accommodation", description: `Booked ${a.accommodation.name}`, createdAt: a.createdAt, status: a.bookingStatus })),
      ...trans.map((t) => ({ id: t.id, type: "transportation", description: `Booked ${t.provider.name}`,     createdAt: t.createdAt, status: t.status        })),
      // FIX: was e.experience.title — field is name
      ...exp.map((e)   => ({ id: e.id, type: "experience",     description: `Booked ${e.experience.name}`,   createdAt: e.createdAt, status: e.status        })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async _getSystemActivities(limit, offset, type) { return []; /* placeholder — needs ActivityLog model */ }
  async _getVendorActivities(vendorId, limit, offset, type, vendorRole) { return []; /* placeholder */ }
  async _getUserActivities(userId, limit, offset, type) { return []; /* placeholder */ }

  // ==================== VENDOR DATA HELPERS ====================

  async _getVendorRecentOrders(vendorId, limit) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.findMany({ where: { accommodation: { vendorId } }, orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 4), include: { travelPlan: { select: { title: true } } } }),
      prisma.transportationBooking.findMany({ where: { provider:      { vendorId } }, orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 4), include: { travelPlan: { select: { title: true } } } }),
      prisma.travelPackageBooking.findMany({ where:  { package:       { vendorId } }, orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 4), include: { travelPlan: { select: { title: true } } } }),
      prisma.experienceBooking.findMany({ where:     { experience:    { vendorId } }, orderBy: { createdAt: "desc" }, take: Math.ceil(limit / 4), include: { travelPlan: { select: { title: true } } } }),
    ]);

    return [
      ...acc.map((a)   => ({ ...a, type: "accommodation", totalAmount: a.totalCost })),
      ...trans.map((t) => ({ ...t, type: "transportation", totalAmount: t.actualFare ?? t.estimatedFare })),
      ...pkg.map((p)   => ({ ...p, type: "package",        totalAmount: p.finalAmount })),
      ...exp.map((e)   => ({ ...e, type: "experience",     totalAmount: e.totalAmount })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  async _getVendorRecentTransactions(vendorId, limit) {
    return prisma.transaction.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: limit });
  }

  async _getVendorRecentReviews(vendorId, limit) {
    return prisma.vendorReview.findMany({
      where: { vendorId }, orderBy: { createdAt: "desc" }, take: limit,
      include: { user: { select: { name: true, profile: { select: { profilePicture: true } } } } },
    });
  }

  async _getVendorInventoryAlerts(vendorId) {
    return { total: 0, items: [], status: "good" }; /* placeholder */
  }

  async _getVendorRevenueData(vendorId, period) {
    const dateRange = this._getDateRange(period);

    const [currentPeriod, previousPeriod] = await Promise.all([
      this._getVendorRevenueStats(vendorId, dateRange),
      this._getVendorRevenueStats(vendorId, { start: dateRange.previousStart, end: dateRange.previousEnd }),
    ]);

    const growth = previousPeriod.total > 0 ? ((currentPeriod.total - previousPeriod.total) / previousPeriod.total) * 100 : 0;
    return { total: currentPeriod.total, growth, byType: currentPeriod.byType };
  }

  async _getVendorResponseTime(vendorId) { return 0; /* placeholder */ }
  async _getTeamProductivity(vendorId)   { return 0; /* placeholder */ }
  async _getTaskCompletionRate(vendorId) { return 0; /* placeholder */ }
  async _getLowInventoryItems(vendorId, limit) { return []; /* placeholder */ }

  /**
   * Vendor pending tasks stats (returns `{total, orders, team, support}`).
   * Used by _getVendorManagerDashboard.
   * See _getVendorPendingTaskItems() for the formatted-items version used by _getVendorUpcoming.
   */
  async _getVendorPendingTasks(vendorId, userId) {
    const [orders, team, support] = await Promise.all([
      this._getVendorPendingOrders(vendorId),
      this._getVendorTeamTasks(vendorId, userId),
      this._getVendorSupportTickets(vendorId),
    ]);
    return { total: orders + team + support, orders, team, support };
  }

  async _getVendorTeamTasks(vendorId, userId) { return 0; /* placeholder — needs Tasks model */ }
  async _getVendorSupportTickets(vendorId)    { return 0; /* placeholder — needs SupportTicket model */ }

  async _getVendorPendingOrders(vendorId) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.count({ where: { accommodation: { vendorId }, bookingStatus: "PENDING" } }),
      prisma.transportationBooking.count({ where: { provider:      { vendorId }, status: "BOOKED"  } }),
      prisma.travelPackageBooking.count({ where:  { package:       { vendorId }, status: "PENDING" } }),
      prisma.experienceBooking.count({ where:     { experience:    { vendorId }, status: "PENDING" } }),
    ]);
    return acc + trans + pkg + exp;
  }

  /**
   * Vendor pending approvals STATS (returns `{total, listings, orders, teamInvites}`).
   * Used by _getVendorAdminDashboard.
   * See _getVendorPendingApprovalItems() for the formatted-items version used by _getVendorUpcoming.
   */
  async _getVendorPendingApprovals(vendorId) {
    const [orders, teamInvites] = await Promise.all([
      this._getVendorPendingOrders(vendorId),
      prisma.vendorTeamMember.count({
        where: { vendorId, isActive: false, invitedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);
    return { total: orders + teamInvites, listings: 0, orders, teamInvites };
  }

  // ==================== NOTIFICATIONS & ALERTS ====================

  async _getUserNotifications(userId) {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { items: notifications, unreadCount };
  }

  async _getUserAlerts(userId, roleInfo) {
    const alerts = [];

    if (roleInfo.primaryRole === "VENDOR" && roleInfo.vendorRole === "OWNER") {
      const vendor = await prisma.vendor.findUnique({ where: { userId }, select: { verificationStatus: true } });
      if (vendor && vendor.verificationStatus !== "VERIFIED") {
        alerts.push({ id: "vendor-verification", type: "warning", title: "Vendor Verification Pending", message: "Your vendor account is pending verification. Some features may be limited.", action: "/vendor/profile", dismissible: false });
      }
    }

    if (roleInfo.primaryRole.startsWith("VENDOR")) {
      const vendor = await prisma.vendor.findUnique({ where: { userId }, select: { balance: true, minimumPayout: true } });
      if (vendor && vendor.balance > vendor.minimumPayout) {
        alerts.push({ id: "payout-available", type: "info", title: "Payout Available", message: `You have $${vendor.balance} available for payout.`, action: "/vendor/payouts/request", dismissible: true });
      }
    }

    if (roleInfo.primaryRole === "USER") {
      const upcomingTrips = await prisma.travelPlan.count({
        where: { userId, startDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } },
      });
      if (upcomingTrips > 0) {
        alerts.push({ id: "upcoming-trips", type: "info", title: "Upcoming Trips", message: `You have ${upcomingTrips} trip${upcomingTrips > 1 ? "s" : ""} coming up soon.`, action: "/travel-plans", dismissible: true });
      }
    }

    return alerts;
  }

  // ==================== SYSTEM STATISTICS ====================

  async _getSystemStats() {
    const [totalUsers, totalVendors, totalBookings, totalRevenue, activeUsers, pendingVendors] =
      await Promise.all([
        prisma.user.count(),
        prisma.vendor.count(),
        this._getTotalBookingsCount(),
        this._getTotalRevenue(),
        prisma.user.count({ where: { lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
        prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
      ]);

    return {
      totalUsers, totalVendors, totalBookings, totalRevenue, activeUsers, pendingVendors,
      growthRate: await this._calculateGrowthRate(),
    };
  }

  async _calculateGrowthRate() {
    const lastMonth    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const [lastMonthUsers, twoMonthsAgoUsers] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: lastMonth } } }),
      prisma.user.count({ where: { createdAt: { gte: twoMonthsAgo, lt: lastMonth } } }),
    ]);

    if (twoMonthsAgoUsers === 0) return 0;
    return ((lastMonthUsers - twoMonthsAgoUsers) / twoMonthsAgoUsers) * 100;
  }

  async _getSystemHealth() {
    let dbStatus = "healthy";
    try { await prisma.$queryRaw`SELECT 1`; } catch { dbStatus = "unhealthy"; }

    let redisStatus = "unknown";
    try { if (redisService.client) { await redisService.client.ping(); redisStatus = "healthy"; } } catch { redisStatus = "unhealthy"; }

    let openfgaStatus = "unknown";
    try { if (process.env.OPENFGA_ENABLED === "true" && openfgaService.initialized) { await openfgaService.getStoreInfo(); openfgaStatus = "healthy"; } } catch { openfgaStatus = "unhealthy"; }

    return { database: dbStatus, redis: redisStatus, openfga: openfgaStatus, uptime: process.uptime(), memory: process.memoryUsage(), timestamp: new Date().toISOString() };
  }

  async _getSystemPerformanceMetrics() {
    const [responseTime, errorRate, activeUsers, apiCalls] = await Promise.all([
      this._getAverageResponseTime(),
      this._getErrorRate(),
      prisma.user.count({ where: { lastLoginAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } } }),
      this._getApiCallCount(),
    ]);
    return { responseTime, errorRate, activeUsers, apiCalls, timestamp: new Date().toISOString() };
  }

  async _getAverageResponseTime() { return 250; /* placeholder */ }
  async _getErrorRate()           { return 0.5; /* placeholder */ }
  async _getApiCallCount()        { return 10000; /* placeholder */ }

  // ==================== REVENUE HELPERS ====================

  async _getRevenueData(period) {
    const dateRange = this._getDateRange(period);

    const [currentPeriod, previousPeriod] = await Promise.all([
      this._getTotalRevenueInRange(dateRange),
      this._getTotalRevenueInRange({ start: dateRange.previousStart, end: dateRange.previousEnd }),
    ]);

    const growth = previousPeriod > 0 ? ((currentPeriod - previousPeriod) / previousPeriod) * 100 : 0;
    return { total: currentPeriod, growth, byCategory: await this._getRevenueByCategory(dateRange) };
  }

  async _getTotalRevenueInRange(dateRange) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where:  { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where:     { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalAmount: true } }),
    ]);
    return (acc._sum.totalCost || 0) + (trans._sum.actualFare || 0) + (pkg._sum.finalAmount || 0) + (exp._sum.totalAmount || 0);
  }

  async _getRevenueByCategory(dateRange) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalCost: true } }),
      prisma.transportationBooking.aggregate({ where: { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { actualFare: true } }),
      prisma.travelPackageBooking.aggregate({ where:  { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { finalAmount: true } }),
      prisma.experienceBooking.aggregate({ where:     { createdAt: { gte: dateRange.start, lte: dateRange.end } }, _sum: { totalAmount: true } }),
    ]);
    return { accommodation: acc._sum.totalCost || 0, transportation: trans._sum.actualFare || 0, packages: pkg._sum.finalAmount || 0, experiences: exp._sum.totalAmount || 0 };
  }

  async _getRevenueSince(date) { return this._getTotalRevenueInRange({ start: date, end: new Date() }); }

  // ==================== WIDGETS & QUICK ACTIONS ====================

  async _getWidgetsByRole(role, user, preferences = {}) {
    const defaultWidgets = {
      SUPER_ADMIN: [
        { id: "stats-overview",    title: "Platform Overview",    type: "stats",    size: "large",  enabled: true },
        { id: "user-growth",       title: "User Growth",          type: "chart",    size: "large",  enabled: true },
        { id: "revenue-chart",     title: "Revenue",              type: "chart",    size: "large",  enabled: true },
        { id: "pending-approvals", title: "Pending Approvals",    type: "list",     size: "medium", enabled: true },
        { id: "recent-users",      title: "Recent Users",         type: "table",    size: "medium", enabled: true },
        { id: "system-health",     title: "System Health",        type: "metric",   size: "small",  enabled: true },
        { id: "top-vendors",       title: "Top Vendors",          type: "list",     size: "small",  enabled: true },
        { id: "recent-bookings",   title: "Recent Bookings",      type: "timeline", size: "medium", enabled: true },
      ],
      VENDOR_ADMIN: [
        { id: "stats-overview",   title: "Business Overview",  type: "stats",  size: "large",  enabled: true },
        { id: "sales-chart",      title: "Sales",              type: "chart",  size: "large",  enabled: true },
        { id: "recent-orders",    title: "Recent Orders",      type: "list",   size: "medium", enabled: true },
        { id: "team-performance", title: "Team Performance",   type: "metric", size: "small",  enabled: true },
        { id: "inventory-status", title: "Inventory Status",   type: "gauge",  size: "small",  enabled: true },
        { id: "pending-tasks",    title: "Pending Tasks",      type: "list",   size: "medium", enabled: true },
        { id: "customer-reviews", title: "Recent Reviews",     type: "list",   size: "small",  enabled: true },
        { id: "earnings",         title: "Earnings",           type: "metric", size: "small",  enabled: true },
      ],
      VENDOR_MANAGER: [
        { id: "stats-overview",    title: "Team Overview",     type: "stats",  size: "large",  enabled: true },
        { id: "pending-orders",    title: "Pending Orders",    type: "list",   size: "large",  enabled: true },
        { id: "team-tasks",        title: "Team Tasks",        type: "list",   size: "medium", enabled: true },
        { id: "inventory-alerts",  title: "Inventory Alerts",  type: "alert",  size: "medium", enabled: true },
        { id: "performance",       title: "Performance",       type: "metric", size: "small",  enabled: true },
        { id: "customer-issues",   title: "Customer Issues",   type: "list",   size: "small",  enabled: true },
      ],
      VENDOR: [
        { id: "stats-overview",   title: "My Business",       type: "stats",  size: "large",  enabled: true },
        { id: "my-listings",      title: "My Listings",       type: "list",   size: "medium", enabled: true },
        { id: "recent-bookings",  title: "Recent Bookings",   type: "list",   size: "medium", enabled: true },
        { id: "earnings",         title: "Earnings",          type: "metric", size: "small",  enabled: true },
        { id: "reviews",          title: "Recent Reviews",    type: "list",   size: "small",  enabled: true },
        { id: "tasks",            title: "Tasks",             type: "list",   size: "small",  enabled: true },
      ],
      USER: [
        { id: "stats-overview",   title: "My Travel",          type: "stats",    size: "large",  enabled: true },
        { id: "my-trips",         title: "My Trips",           type: "list",     size: "large",  enabled: true },
        { id: "upcoming",         title: "Upcoming",           type: "timeline", size: "medium", enabled: true },
        { id: "saved-items",      title: "Saved Items",        type: "grid",     size: "medium", enabled: true },
        { id: "recommendations",  title: "Recommendations",    type: "list",     size: "small",  enabled: true },
        { id: "recent-activity",  title: "Recent Activity",    type: "timeline", size: "small",  enabled: true },
      ],
    };

    const roleWidgets = defaultWidgets[role] || defaultWidgets.USER;
    if (preferences.widgets) {
      return roleWidgets.map((widget) => ({
        ...widget,
        enabled: preferences.widgets[widget.id]?.enabled ?? widget.enabled,
        order:   preferences.widgets[widget.id]?.order   ?? widget.order,
        config:  preferences.widgets[widget.id]?.config  || {},
      }));
    }
    return roleWidgets;
  }

  async _getQuickActionsByRole(role, user) {
    const baseActions = {
      SUPER_ADMIN: [
        { id: "manage-users",    label: "Manage Users",    icon: "users",    url: "/admin/users",    color: "blue"   },
        { id: "manage-vendors",  label: "Manage Vendors",  icon: "store",    url: "/admin/vendors",  color: "green"  },
        { id: "view-reports",    label: "View Reports",    icon: "chart-bar",url: "/admin/reports",  color: "purple" },
        { id: "system-settings", label: "Settings",        icon: "cog",      url: "/admin/settings", color: "gray"   },
      ],
      VENDOR_ADMIN: [
        { id: "add-listing",  label: "Add Listing",   icon: "plus-circle", url: "/vendor/listings/add", color: "blue"   },
        { id: "manage-team",  label: "Manage Team",   icon: "users",       url: "/vendor/team",         color: "green"  },
        { id: "view-orders",  label: "View Orders",   icon: "shopping-bag",url: "/vendor/orders",       color: "purple" },
        { id: "analytics",    label: "Analytics",     icon: "chart-line",  url: "/vendor/analytics",    color: "yellow" },
      ],
      VENDOR_MANAGER: [
        { id: "process-orders",   label: "Process Orders",  icon: "clipboard-check", url: "/vendor/orders/pending", color: "blue"   },
        { id: "manage-inventory", label: "Inventory",        icon: "box",             url: "/vendor/inventory",      color: "green"  },
        { id: "team-tasks",       label: "Team Tasks",       icon: "tasks",           url: "/vendor/tasks",          color: "purple" },
        { id: "support",          label: "Support",          icon: "headset",         url: "/vendor/support",        color: "yellow" },
      ],
      VENDOR: [
        { id: "add-listing",   label: "Add Listing",   icon: "plus-circle", url: "/vendor/listings/add", color: "blue"   },
        { id: "view-bookings", label: "View Bookings", icon: "calendar",    url: "/vendor/bookings",     color: "green"  },
        { id: "earnings",      label: "Earnings",      icon: "dollar-sign", url: "/vendor/earnings",     color: "purple" },
        { id: "profile",       label: "Profile",       icon: "user",        url: "/vendor/profile",      color: "gray"   },
      ],
      USER: [
        { id: "create-trip", label: "Create Trip", icon: "plus-circle", url: "/travel-plans/new", color: "blue"   },
        { id: "my-trips",    label: "My Trips",    icon: "plane",       url: "/travel-plans",     color: "green"  },
        { id: "saved",       label: "Saved",       icon: "bookmark",    url: "/saved",            color: "purple" },
        { id: "profile",     label: "Profile",     icon: "user",        url: "/profile",          color: "gray"   },
      ],
    };

    let actions = baseActions[role] || baseActions.USER;

    if (role === "SUPER_ADMIN") {
      const pendingCounts = await this._getPendingCounts();
      actions = actions.map((a) => a.id === "manage-vendors" ? { ...a, count: pendingCounts.vendors } : a);
    } else if (user?.vendor) {
      const pendingCounts = await this._getVendorPendingCounts(user.vendor.id);
      actions = actions.map((a) => {
        if (a.id === "process-orders" || a.id === "view-orders") return { ...a, count: pendingCounts.orders };
        if (a.id === "manage-inventory")                         return { ...a, count: pendingCounts.inventoryAlerts };
        return a;
      });
    }

    return actions;
  }

  // ==================== PENDING COUNTS HELPERS ====================

  async _getPendingApprovals() {
    const [vendors, payouts] = await Promise.all([
      prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
      prisma.payout.count({ where: { status: "PENDING" } }),
    ]);
    return { vendors, payouts };
  }

  async _getPendingCounts() {
    return this._getPendingApprovals();
  }

  async _getVendorPendingCounts(vendorId) {
    const [orders, inventoryAlerts] = await Promise.all([
      this._getVendorPendingOrders(vendorId),
      this._getVendorInventoryAlerts(vendorId).then((a) => a.total),
    ]);
    return { orders, inventoryAlerts };
  }

  async _getBookingsCountSince(date) {
    const [acc, trans, pkg, exp] = await Promise.all([
      prisma.accommodationBooking.count({ where: { createdAt: { gte: date } } }),
      prisma.transportationBooking.count({ where: { createdAt: { gte: date } } }),
      prisma.travelPackageBooking.count({ where:  { createdAt: { gte: date } } }),
      prisma.experienceBooking.count({ where:     { createdAt: { gte: date } } }),
    ]);
    return acc + trans + pkg + exp;
  }

  async _getUpcomingReviews(limit) { return []; /* placeholder */ }
}

module.exports = new DashboardController();