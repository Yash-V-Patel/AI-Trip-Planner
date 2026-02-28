const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");
const accommodationController = require("./accommodation.controller");
const storeController = require("./store.controller");
const transportationController = require("./transportation.controller");
const travelPlanController = require("./travelplan.controller");
const vendorController = require("./vendor.controller");
const userController = require("./user.controller");

const prisma = new PrismaClient();

class DashboardController {
  constructor() {
    // Bind methods
    this.getDashboard = this.getDashboard.bind(this);
    this.getStats = this.getStats.bind(this);
    this.getRecentActivity = this.getRecentActivity.bind(this);
    this.getWidgets = this.getWidgets.bind(this);
    this.updateWidgetPreferences = this.updateWidgetPreferences.bind(this);
    this.getQuickActions = this.getQuickActions.bind(this);
    this.getNotifications = this.getNotifications.bind(this);
    this.markNotificationRead = this.markNotificationRead.bind(this);
    this.markAllNotificationsRead = this.markAllNotificationsRead.bind(this);
    this.getUserRoleInfo = this.getUserRoleInfo.bind(this);
    this.getOverview = this.getOverview.bind(this);
    this.getCharts = this.getCharts.bind(this);
    this.getAlerts = this.getAlerts.bind(this);
    this.getUpcomingItems = this.getUpcomingItems.bind(this);
    this.getPerformanceMetrics = this.getPerformanceMetrics.bind(this);

    // Private helper methods (these don't need binding usually as they're called internally)
    // But if you want to bind them as well, you can add them here
    this._getVendorRole = this._getVendorRole.bind(this);
    this._getSuperAdminStats = this._getSuperAdminStats.bind(this);
    this._getVendorStats = this._getVendorStats.bind(this);
    this._getUserStats = this._getUserStats.bind(this);
    this._getDateRange = this._getDateRange.bind(this);
    this._getUserStatsByPeriod = this._getUserStatsByPeriod.bind(this);
    this._getVendorStatsByPeriod = this._getVendorStatsByPeriod.bind(this);
    this._getBookingStatsByPeriod = this._getBookingStatsByPeriod.bind(this);
    this._getRevenueStatsByPeriod = this._getRevenueStatsByPeriod.bind(this);
    this._getPlatformStats = this._getPlatformStats.bind(this);
    this._getVendorListingStats = this._getVendorListingStats.bind(this);
    this._getVendorBookingStats = this._getVendorBookingStats.bind(this);
    this._getVendorRevenueStats = this._getVendorRevenueStats.bind(this);
    this._getVendorPerformanceStats =
      this._getVendorPerformanceStats.bind(this);
    this._calculateVendorResponseRate =
      this._calculateVendorResponseRate.bind(this);
    this._getVendorTeamStats = this._getVendorTeamStats.bind(this);
    this._getUserTravelPlanStats = this._getUserTravelPlanStats.bind(this);
    this._getUserBookingStats = this._getUserBookingStats.bind(this);
    this._getUserSpendingStats = this._getUserSpendingStats.bind(this);
    this._getUserActivityStats = this._getUserActivityStats.bind(this);
    this._getTotalBookingsCount = this._getTotalBookingsCount.bind(this);
    this._getTotalRevenue = this._getTotalRevenue.bind(this);
    this._getVendorOverview = this._getVendorOverview.bind(this);
    this._getVendorTotalListingsCount =
      this._getVendorTotalListingsCount.bind(this);
    this._getVendorActiveListingsCount =
      this._getVendorActiveListingsCount.bind(this);
    this._getVendorBookingsCount = this._getVendorBookingsCount.bind(this);
    this._getVendorRevenueInRange = this._getVendorRevenueInRange.bind(this);
    this._getVendorPendingOrdersCount =
      this._getVendorPendingOrdersCount.bind(this);
    this._getVendorLowStockAlerts = this._getVendorLowStockAlerts.bind(this);
    this._getVendorTeamActivity = this._getVendorTeamActivity.bind(this);
    this._getVendorAverageRating = this._getVendorAverageRating.bind(this);
    this._getVendorChartData = this._getVendorChartData.bind(this);
    this._getVendorSalesChart = this._getVendorSalesChart.bind(this);
    this._getVendorBookingsChart = this._getVendorBookingsChart.bind(this);
    this._getVendorRevenueChart = this._getVendorRevenueChart.bind(this);
    this._getVendorPopularItemsChart =
      this._getVendorPopularItemsChart.bind(this);
    this._getVendorCustomerDemographicsChart =
      this._getVendorCustomerDemographicsChart.bind(this);
    this._groupByTimePeriod = this._groupByTimePeriod.bind(this);
    this._groupCountByTimePeriod = this._groupCountByTimePeriod.bind(this);
    this._calculateAge = this._calculateAge.bind(this);
    this._getVendorUpcoming = this._getVendorUpcoming.bind(this);
    this._getVendorUpcomingBookings =
      this._getVendorUpcomingBookings.bind(this);
    this._getVendorPendingTasks = this._getVendorPendingTasks.bind(this);
    this._getVendorScheduledMaintenance =
      this._getVendorScheduledMaintenance.bind(this);
    this._getVendorTeamEvents = this._getVendorTeamEvents.bind(this);
    this._getVendorPendingApprovals =
      this._getVendorPendingApprovals.bind(this);
    this._getVendorPendingListings = this._getVendorPendingListings.bind(this);
    this._getBookingPriority = this._getBookingPriority.bind(this);
    this._getLowInventoryItems = this._getLowInventoryItems.bind(this);
  }

  // ==================== MAIN DASHBOARD METHODS ====================
  // Add these methods to your existing DashboardController class

  /**
   * Get vendor role for a user
   */
  async _getVendorRole(vendorId, userId) {
    try {
      // Check if user is a team member
      const teamMember = await prisma.vendorTeamMember.findUnique({
        where: {
          vendorId_userId: {
            vendorId,
            userId,
          },
        },
      });

      if (teamMember) {
        return teamMember.role;
      }

      // Check if user is the vendor owner
      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
      });

      if (vendor?.userId === userId) {
        return "OWNER";
      }

      return null;
    } catch (error) {
      console.error("Error getting vendor role:", error);
      return null;
    }
  }

  /**
   * Get super admin statistics
   */
  async _getSuperAdminStats(period, category) {
    const dateRange = this._getDateRange(period);

    const stats = {
      users: await this._getUserStatsByPeriod(dateRange),
      vendors: await this._getVendorStatsByPeriod(dateRange),
      bookings: await this._getBookingStatsByPeriod(dateRange),
      revenue: await this._getRevenueStatsByPeriod(dateRange),
      platform: await this._getPlatformStats(),
    };

    // Return only requested category if specified
    if (category && stats[category]) {
      return { [category]: stats[category] };
    }

    return stats;
  }

  /**
   * Get vendor statistics based on role
   */
  async _getVendorStats(vendorId, period, category, vendorRole) {
    const dateRange = this._getDateRange(period);

    const stats = {
      listings: await this._getVendorListingStats(vendorId),
      bookings: await this._getVendorBookingStats(vendorId, dateRange),
      revenue: await this._getVendorRevenueStats(vendorId, dateRange),
      performance: await this._getVendorPerformanceStats(vendorId),
    };

    // Add team stats for admin/manager
    if (
      vendorRole === "ADMIN" ||
      vendorRole === "MANAGER" ||
      vendorRole === "OWNER"
    ) {
      stats.team = await this._getVendorTeamStats(vendorId);
    }

    // Return only requested category if specified
    if (category && stats[category]) {
      return { [category]: stats[category] };
    }

    return stats;
  }

  /**
   * Get user statistics
   */
  async _getUserStats(userId, period, category) {
    const dateRange = this._getDateRange(period);

    const stats = {
      travelPlans: await this._getUserTravelPlanStats(userId, dateRange),
      bookings: await this._getUserBookingStats(userId, dateRange),
      spending: await this._getUserSpendingStats(userId, dateRange),
      activity: await this._getUserActivityStats(userId, dateRange),
    };

    // Return only requested category if specified
    if (category && stats[category]) {
      return { [category]: stats[category] };
    }

    return stats;
  }

  // ==================== HELPER METHODS FOR STATISTICS ====================

  /**
   * Get user statistics by period
   */
  async _getUserStatsByPeriod(dateRange) {
    const [total, newUsers, activeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      }),
      prisma.user.count({
        where: {
          lastLoginAt: {
            gte: dateRange.start,
          },
        },
      }),
    ]);

    return { total, new: newUsers, active: activeUsers };
  }

  /**
   * Get vendor statistics by period
   */
  async _getVendorStatsByPeriod(dateRange) {
    const [total, newVendors, verifiedVendors, pendingVendors] =
      await Promise.all([
        prisma.vendor.count(),
        prisma.vendor.count({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.vendor.count({ where: { verificationStatus: "VERIFIED" } }),
        prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
      ]);

    return {
      total,
      new: newVendors,
      verified: verifiedVendors,
      pending: pendingVendors,
    };
  }

  /**
   * Get booking statistics by period
   */
  async _getBookingStatsByPeriod(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.transportationBooking.count({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.travelPackageBooking.count({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.experienceBooking.count({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
      ]);

    return {
      total: accommodation + transportation + packages + experiences,
      byType: {
        accommodation,
        transportation,
        packages,
        experiences,
      },
    };
  }

  /**
   * Get revenue statistics by period
   */
  async _getRevenueStatsByPeriod(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: {
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          _sum: { totalAmount: true },
        }),
      ]);

    const total =
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0);

    return {
      total,
      byType: {
        accommodation: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages: packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  /**
   * Get platform statistics
   */
  async _getPlatformStats() {
    const [totalUsers, totalVendors, totalBookings, totalRevenue] =
      await Promise.all([
        prisma.user.count(),
        prisma.vendor.count(),
        this._getTotalBookingsCount(),
        this._getTotalRevenue(),
      ]);

    return {
      totalUsers,
      totalVendors,
      totalBookings,
      totalRevenue,
    };
  }

  /**
   * Get vendor listing statistics
   */
  async _getVendorListingStats(vendorId) {
    const [accommodations, providers, packages, experiences] =
      await Promise.all([
        prisma.accommodation.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
        prisma.transportationProvider.findMany({
          where: { vendorId },
          select: { id: true, isAvailable: true },
        }),
        prisma.travelPackage.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
        prisma.vendorExperience.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
      ]);

    return {
      total:
        accommodations.length +
        providers.length +
        packages.length +
        experiences.length,
      active:
        accommodations.filter((a) => a.isActive).length +
        providers.filter((p) => p.isAvailable).length +
        packages.filter((p) => p.isActive).length +
        experiences.filter((e) => e.isActive).length,
      byType: {
        accommodations: accommodations.length,
        transportation: providers.length,
        packages: packages.length,
        experiences: experiences.length,
      },
    };
  }

  /**
   * Get vendor booking statistics
   */
  async _getVendorBookingStats(vendorId, dateRange) {
    const whereClause = {
      createdAt: { gte: dateRange.start, lte: dateRange.end },
    };

    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { ...whereClause, accommodation: { vendorId } },
        }),
        prisma.transportationBooking.count({
          where: { ...whereClause, provider: { vendorId } },
        }),
        prisma.travelPackageBooking.count({
          where: { ...whereClause, package: { vendorId } },
        }),
        prisma.experienceBooking.count({
          where: { ...whereClause, experience: { vendorId } },
        }),
      ]);

    const total = accommodation + transportation + packages + experiences;

    // Get pending counts
    const [
      pendingAccommodation,
      pendingTransportation,
      pendingPackages,
      pendingExperiences,
    ] = await Promise.all([
      prisma.accommodationBooking.count({
        where: { accommodation: { vendorId }, bookingStatus: "PENDING" },
      }),
      prisma.transportationBooking.count({
        where: { provider: { vendorId }, status: "BOOKED" },
      }),
      prisma.travelPackageBooking.count({
        where: { package: { vendorId }, status: "PENDING" },
      }),
      prisma.experienceBooking.count({
        where: { experience: { vendorId }, status: "PENDING" },
      }),
    ]);

    return {
      total,
      pending:
        pendingAccommodation +
        pendingTransportation +
        pendingPackages +
        pendingExperiences,
      byType: {
        accommodations: accommodation,
        transportation: transportation,
        packages: packages,
        experiences: experiences,
      },
    };
  }

  /**
   * Get vendor revenue statistics
   */
  async _getVendorRevenueStats(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: {
            accommodation: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: {
            provider: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: {
            package: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: {
            experience: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalAmount: true },
        }),
      ]);

    const total =
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0);

    return {
      total,
      byType: {
        accommodations: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages: packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  /**
   * Get vendor performance statistics
   */
  async _getVendorPerformanceStats(vendorId) {
    const [
      accommodationRating,
      transportationRating,
      packageRating,
      experienceRating,
      reviews,
    ] = await Promise.all([
      prisma.accommodation.aggregate({
        where: { vendorId },
        _avg: { starRating: true },
      }),
      prisma.transportationProvider.aggregate({
        where: { vendorId },
        _avg: { rating: true },
      }),
      prisma.travelPackage.aggregate({
        where: { vendorId },
        _avg: { rating: true },
      }),
      prisma.vendorExperience.aggregate({
        where: { vendorId },
        _avg: { rating: true },
      }),
      prisma.vendorReview.count({ where: { vendorId } }),
    ]);

    const ratings = [
      accommodationRating._avg.starRating,
      transportationRating._avg.rating,
      packageRating._avg.rating,
      experienceRating._avg.rating,
    ].filter((r) => r !== null);

    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    return {
      averageRating,
      totalReviews: reviews,
      responseRate: await this._calculateVendorResponseRate(vendorId),
    };
  }

  /**
   * Calculate vendor response rate
   */
  async _calculateVendorResponseRate(vendorId) {
    const reviews = await prisma.vendorReview.findMany({
      where: { vendorId },
      select: { response: true },
    });

    if (reviews.length === 0) return 100;

    const responded = reviews.filter((r) => r.response).length;
    return Math.round((responded / reviews.length) * 100);
  }

  /**
   * Get vendor team statistics
   */
  async _getVendorTeamStats(vendorId) {
    const [total, active, byRole] = await Promise.all([
      prisma.vendorTeamMember.count({ where: { vendorId } }),
      prisma.vendorTeamMember.count({ where: { vendorId, isActive: true } }),
      prisma.vendorTeamMember.groupBy({
        by: ["role"],
        where: { vendorId },
        _count: true,
      }),
    ]);

    const roleBreakdown = {};
    byRole.forEach((item) => {
      roleBreakdown[item.role] = item._count;
    });

    return {
      total,
      active,
      byRole: roleBreakdown,
    };
  }

  /**
   * Get user travel plan statistics
   */
  async _getUserTravelPlanStats(userId, dateRange) {
    const [total, completed, planning, ongoing] = await Promise.all([
      prisma.travelPlan.count({ where: { userId } }),
      prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
      prisma.travelPlan.count({ where: { userId, status: "PLANNING" } }),
      prisma.travelPlan.count({ where: { userId, status: "ONGOING" } }),
    ]);

    return { total, completed, planning, ongoing };
  }

  /**
   * Get user booking statistics
   */
  async _getUserBookingStats(userId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
        prisma.transportationBooking.count({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
        prisma.travelPackageBooking.count({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
        prisma.experienceBooking.count({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
      ]);

    return {
      total: accommodation + transportation + packages + experiences,
      byType: { accommodation, transportation, packages, experiences },
    };
  }

  /**
   * Get user spending statistics
   */
  async _getUserSpendingStats(userId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: {
            travelPlan: { userId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalAmount: true },
        }),
      ]);

    const total =
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0);

    return {
      total,
      byType: {
        accommodation: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages: packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  /**
   * Get user activity statistics
   */
  async _getUserActivityStats(userId, dateRange) {
    const [travelPlansCreated, bookingsMade, reviewsWritten] =
      await Promise.all([
        prisma.travelPlan.count({
          where: {
            userId,
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
        this._getUserBookingStats(userId, dateRange).then((s) => s.total),
        prisma.vendorReview.count({
          where: {
            userId,
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
        }),
      ]);

    const lastLogin = await prisma.profile.findUnique({
      where: { userId },
      select: { lastLogin: true },
    });

    return {
      travelPlansCreated,
      bookingsMade,
      reviewsWritten,
      lastLogin: lastLogin?.lastLogin,
    };
  }

  /**
   * Get total bookings count
   */
  async _getTotalBookingsCount() {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count(),
        prisma.transportationBooking.count(),
        prisma.travelPackageBooking.count(),
        prisma.experienceBooking.count(),
      ]);
    return accommodation + transportation + packages + experiences;
  }

  /**
   * Get total revenue
   */
  async _getTotalRevenue() {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({ _sum: { totalCost: true } }),
        prisma.transportationBooking.aggregate({
          _sum: { actualFare: true, estimatedFare: true },
        }),
        prisma.travelPackageBooking.aggregate({ _sum: { finalAmount: true } }),
        prisma.experienceBooking.aggregate({ _sum: { totalAmount: true } }),
      ]);

    return (
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare ||
        transportation._sum.estimatedFare ||
        0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0)
    );
  }

  /**
   * Get date range based on period
   */
  _getDateRange(period) {
    const now = new Date();
    const start = new Date();
    const end = new Date();

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
        // Default to current month
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
    }

    return { start, end };
  }
  /**
   * Get dashboard based on user role
   * GET /api/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const userId = req.user.id;

      // Get user with vendor info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          vendor: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine user role category
      const roleInfo = await this._determineUserRole(
        user,
        req.user.isSuperAdmin,
      );

      // Get role-specific dashboard data
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

      // Get dashboard data based on role
      switch (roleInfo.primaryRole) {
        case "SUPER_ADMIN":
          dashboardData = await this._getSuperAdminDashboard(
            userId,
            dashboardData,
          );
          break;
        case "VENDOR_ADMIN":
          dashboardData = await this._getVendorAdminDashboard(
            user,
            dashboardData,
          );
          break;
        case "VENDOR_MANAGER":
          dashboardData = await this._getVendorManagerDashboard(
            user,
            dashboardData,
          );
          break;
        case "VENDOR":
          dashboardData = await this._getVendorDashboard(user, dashboardData);
          break;
        case "USER":
        default:
          dashboardData = await this._getUserDashboard(userId, dashboardData);
          break;
      }

      // Get common data for all users
      dashboardData.notifications = await this._getUserNotifications(userId);
      dashboardData.alerts = await this._getUserAlerts(userId, roleInfo);

      // Get widgets configuration
      dashboardData.widgets = await this._getWidgetsByRole(
        roleInfo.primaryRole,
        user,
      );

      res.json({
        success: true,
        data: dashboardData,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get dashboard statistics
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

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isSuperAdmin = req.user.isSuperAdmin || false;
      let stats = {};

      if (isSuperAdmin) {
        stats = await this._getSuperAdminStats(period, category);
      } else if (user.vendor) {
        // Check vendor role for specific stats
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        stats = await this._getVendorStats(
          user.vendor.id,
          period,
          category,
          vendorRole,
        );
      } else {
        stats = await this._getUserStats(userId, period, category);
      }

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get recent activity
   * GET /api/dashboard/activity
   */
  async getRecentActivity(req, res, next) {
    try {
      const userId = req.user.id;
      const { limit = 20, offset = 0, type } = req.query;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;

      let activities = [];

      if (isSuperAdmin) {
        activities = await this._getSystemActivities(
          parseInt(limit),
          parseInt(offset),
          type,
        );
      } else if (user.vendor) {
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        activities = await this._getVendorActivities(
          user.vendor.id,
          parseInt(limit),
          parseInt(offset),
          type,
          vendorRole,
        );
      } else {
        activities = await this._getUserActivities(
          userId,
          parseInt(limit),
          parseInt(offset),
          type,
        );
      }

      res.json({
        success: true,
        data: activities,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: activities.length === parseInt(limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get dashboard widgets configuration
   * GET /api/dashboard/widgets
   */
  async getWidgets(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          vendor: true,
          profile: true,
        },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);

      // Get user's widget preferences or defaults
      const userPreferences = user.profile?.dashboardPreferences || {};
      const widgets = await this._getWidgetsByRole(
        roleInfo.primaryRole,
        user,
        userPreferences,
      );

      res.json({
        success: true,
        data: widgets,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update widget preferences
   * POST /api/dashboard/widgets/preferences
   */
  async updateWidgetPreferences(req, res, next) {
    try {
      const userId = req.user.id;
      const { widgets, layout } = req.body;

      // Get current profile
      const profile = await prisma.profile.findUnique({
        where: { userId },
      });

      // Update dashboard preferences
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

      // Invalidate cache
      await redisService.client?.del(`user:${userId}:profile`);

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
   * Get quick actions based on role
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

      const actions = await this._getQuickActionsByRole(
        roleInfo.primaryRole,
        user,
      );

      res.json({
        success: true,
        data: actions,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user notifications
   * GET /api/dashboard/notifications
   */
  async getNotifications(req, res, next) {
    try {
      const userId = req.user.id;
      const { unreadOnly = false, limit = 20 } = req.query;

      const where = { userId };
      if (unreadOnly === "true") {
        where.isRead = false;
      }

      const notifications = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
      });

      const unreadCount = await prisma.notification.count({
        where: { userId, isRead: false },
      });

      res.json({
        success: true,
        data: notifications,
        unreadCount,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark notification as read
   * PATCH /api/dashboard/notifications/:notificationId/read
   */
  async markNotificationRead(req, res, next) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.id;

      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId,
        },
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });

      res.json({
        success: true,
        message: "Notification marked as read",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all notifications as read
   * POST /api/dashboard/notifications/read-all
   */
  async markAllNotificationsRead(req, res, next) {
    try {
      const userId = req.user.id;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      res.json({
        success: true,
        message: "All notifications marked as read",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user role information
   * GET /api/dashboard/role-info
   */
  async getUserRoleInfo(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          vendor: {
            include: {
              teamMembers: {
                where: { userId },
              },
            },
          },
        },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);

      // Get permissions for each role
      const permissions = {};

      if (roleInfo.primaryRole === "SUPER_ADMIN") {
        permissions.all = true;
      } else if (user.vendor) {
        // Get vendor-specific permissions
        const vendorPermissions = await this._getVendorPermissions(
          user.vendor.id,
          userId,
          roleInfo.vendorRole,
        );
        permissions.vendor = vendorPermissions;
      }

      res.json({
        success: true,
        data: {
          ...roleInfo,
          permissions,
          isSuperAdmin,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get overview dashboard (simplified version)
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
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);

      let overview = {};

      if (isSuperAdmin) {
        overview = await this._getSuperAdminOverview();
      } else if (user.vendor) {
        overview = await this._getVendorOverview(
          user.vendor.id,
          roleInfo.vendorRole,
        );
      } else {
        overview = await this._getUserOverview(userId);
      }

      res.json({
        success: true,
        data: overview,
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Get vendor overview (simplified stats for dashboard overview)
   */
  async _getVendorOverview(vendorId, vendorRole) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - 7);

    const [
      totalListings,
      activeListings,
      todayBookings,
      weekBookings,
      todayRevenue,
      weekRevenue,
      pendingOrders,
      lowStockAlerts,
      recentReviews,
      teamActivity,
    ] = await Promise.all([
      // Total listings count
      this._getVendorTotalListingsCount(vendorId),

      // Active listings count
      this._getVendorActiveListingsCount(vendorId),

      // Today's bookings
      this._getVendorBookingsCount(vendorId, { gte: today }),

      // This week's bookings
      this._getVendorBookingsCount(vendorId, { gte: startOfWeek }),

      // Today's revenue
      this._getVendorRevenueInRange(vendorId, {
        start: today,
        end: new Date(),
      }),

      // This week's revenue
      this._getVendorRevenueInRange(vendorId, {
        start: startOfWeek,
        end: new Date(),
      }),

      // Pending orders
      this._getVendorPendingOrdersCount(vendorId),

      // Low stock alerts (if applicable)
      this._getVendorLowStockAlerts(vendorId),

      // Recent reviews
      prisma.vendorReview.count({
        where: {
          vendorId,
          createdAt: { gte: startOfWeek },
        },
      }),

      // Team activity (for admin/manager roles)
      vendorRole === "ADMIN" ||
      vendorRole === "MANAGER" ||
      vendorRole === "OWNER"
        ? this._getVendorTeamActivity(vendorId)
        : Promise.resolve(0),
    ]);

    return {
      listings: {
        total: totalListings,
        active: activeListings,
        occupancyRate:
          totalListings > 0
            ? Math.round((activeListings / totalListings) * 100)
            : 0,
      },
      bookings: {
        today: todayBookings,
        week: weekBookings,
        pending: pendingOrders,
      },
      revenue: {
        today: todayRevenue,
        week: weekRevenue,
        averagePerDay: weekBookings > 0 ? Math.round(weekRevenue / 7) : 0,
      },
      alerts: {
        lowStock: lowStockAlerts,
        pendingOrders,
      },
      engagement: {
        reviews: recentReviews,
        teamActivity: teamActivity,
      },
      performance: {
        rating: await this._getVendorAverageRating(vendorId),
      },
    };
  }

  /**
   * Get vendor total listings count
   */
  async _getVendorTotalListingsCount(vendorId) {
    const [accommodations, providers, packages, experiences] =
      await Promise.all([
        prisma.accommodation.count({ where: { vendorId } }),
        prisma.transportationProvider.count({ where: { vendorId } }),
        prisma.travelPackage.count({ where: { vendorId } }),
        prisma.vendorExperience.count({ where: { vendorId } }),
      ]);

    return accommodations + providers + packages + experiences;
  }

  /**
   * Get vendor active listings count
   */
  async _getVendorActiveListingsCount(vendorId) {
    const [accommodations, providers, packages, experiences] =
      await Promise.all([
        prisma.accommodation.count({ where: { vendorId, isActive: true } }),
        prisma.transportationProvider.count({
          where: { vendorId, isAvailable: true },
        }),
        prisma.travelPackage.count({ where: { vendorId, isActive: true } }),
        prisma.vendorExperience.count({ where: { vendorId, isActive: true } }),
      ]);

    return accommodations + providers + packages + experiences;
  }

  /**
   * Get vendor bookings count within date range
   */
  async _getVendorBookingsCount(vendorId, dateFilter) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            accommodation: { vendorId },
            createdAt: dateFilter,
          },
        }),
        prisma.transportationBooking.count({
          where: {
            provider: { vendorId },
            createdAt: dateFilter,
          },
        }),
        prisma.travelPackageBooking.count({
          where: {
            package: { vendorId },
            createdAt: dateFilter,
          },
        }),
        prisma.experienceBooking.count({
          where: {
            experience: { vendorId },
            createdAt: dateFilter,
          },
        }),
      ]);

    return accommodation + transportation + packages + experiences;
  }

  /**
   * Get vendor revenue within date range
   */
  async _getVendorRevenueInRange(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: {
            accommodation: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: {
            provider: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: {
            package: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: {
            experience: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalAmount: true },
        }),
      ]);

    return (
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0)
    );
  }

  /**
   * Get vendor pending orders count
   */
  async _getVendorPendingOrdersCount(vendorId) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            accommodation: { vendorId },
            bookingStatus: "PENDING",
          },
        }),
        prisma.transportationBooking.count({
          where: {
            provider: { vendorId },
            status: "BOOKED",
          },
        }),
        prisma.travelPackageBooking.count({
          where: {
            package: { vendorId },
            status: "PENDING",
          },
        }),
        prisma.experienceBooking.count({
          where: {
            experience: { vendorId },
            status: "PENDING",
          },
        }),
      ]);

    return accommodation + transportation + packages + experiences;
  }

  /**
   * Get vendor low stock alerts
   */
  async _getVendorLowStockAlerts(vendorId) {
    // This would need inventory management - placeholder for now
    // You can implement this based on your actual inventory model
    return 0;
  }

  /**
   * Get vendor team activity count
   */
  async _getVendorTeamActivity(vendorId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // This would need an activity log model - placeholder for now
    // You can implement this based on your actual activity tracking
    return 0;
  }

  /**
   * Get vendor average rating
   */
  async _getVendorAverageRating(vendorId) {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { overallRating: true },
    });

    return vendor?.overallRating || 0;
  }
  /**
   * Get chart data for dashboard
   * GET /api/dashboard/charts
   */
  async getCharts(req, res, next) {
    try {
      const userId = req.user.id;
      const { chart, period = "month" } = req.query;

      if (!chart) {
        return res.status(400).json({
          success: false,
          message: "Chart type is required",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      let chartData = {};

      if (isSuperAdmin) {
        chartData = await this._getSuperAdminChartData(chart, period);
      } else if (user.vendor) {
        chartData = await this._getVendorChartData(
          user.vendor.id,
          chart,
          period,
        );
      } else {
        chartData = await this._getUserChartData(userId, chart, period);
      }

      res.json({
        success: true,
        data: chartData,
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Get vendor chart data
   */
  async _getVendorChartData(vendorId, chart, period) {
    const dateRange = this._getDateRange(period);

    switch (chart) {
      case "sales":
        return await this._getVendorSalesChart(vendorId, dateRange);
      case "bookings":
        return await this._getVendorBookingsChart(vendorId, dateRange);
      case "revenue":
        return await this._getVendorRevenueChart(vendorId, dateRange);
      case "popular-items":
        return await this._getVendorPopularItemsChart(vendorId, dateRange);
      case "customer-demographics":
        return await this._getVendorCustomerDemographicsChart(
          vendorId,
          dateRange,
        );
      default:
        return {};
    }
  }

  /**
   * Get vendor sales chart data
   */
  async _getVendorSalesChart(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.findMany({
          where: {
            accommodation: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          select: { createdAt: true, totalCost: true },
        }),
        prisma.transportationBooking.findMany({
          where: {
            provider: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          select: { createdAt: true, actualFare: true },
        }),
        prisma.travelPackageBooking.findMany({
          where: {
            package: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          select: { createdAt: true, finalAmount: true },
        }),
        prisma.experienceBooking.findMany({
          where: {
            experience: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          select: { createdAt: true, totalAmount: true },
        }),
      ]);

    // Group by day/month based on period
    const groupedData = this._groupByTimePeriod(
      accommodation,
      transportation,
      packages,
      experiences,
      dateRange,
    );

    return {
      labels: groupedData.labels,
      datasets: [
        {
          label: "Accommodation",
          data: groupedData.accommodation,
          backgroundColor: "rgba(54, 162, 235, 0.5)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
        {
          label: "Transportation",
          data: groupedData.transportation,
          backgroundColor: "rgba(255, 99, 132, 0.5)",
          borderColor: "rgba(255, 99, 132, 1)",
          borderWidth: 1,
        },
        {
          label: "Packages",
          data: groupedData.packages,
          backgroundColor: "rgba(75, 192, 192, 0.5)",
          borderColor: "rgba(75, 192, 192, 1)",
          borderWidth: 1,
        },
        {
          label: "Experiences",
          data: groupedData.experiences,
          backgroundColor: "rgba(153, 102, 255, 0.5)",
          borderColor: "rgba(153, 102, 255, 1)",
          borderWidth: 1,
        },
      ],
    };
  }

  /**
   * Get vendor bookings chart data
   */
  async _getVendorBookingsChart(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.groupBy({
          by: ["createdAt"],
          where: {
            accommodation: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _count: true,
          orderBy: { createdAt: "asc" },
        }),
        prisma.transportationBooking.groupBy({
          by: ["createdAt"],
          where: {
            provider: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _count: true,
          orderBy: { createdAt: "asc" },
        }),
        prisma.travelPackageBooking.groupBy({
          by: ["createdAt"],
          where: {
            package: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _count: true,
          orderBy: { createdAt: "asc" },
        }),
        prisma.experienceBooking.groupBy({
          by: ["createdAt"],
          where: {
            experience: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _count: true,
          orderBy: { createdAt: "asc" },
        }),
      ]);

    // Group by day/month
    const groupedData = this._groupCountByTimePeriod(
      accommodation,
      transportation,
      packages,
      experiences,
      dateRange,
    );

    return {
      labels: groupedData.labels,
      datasets: [
        {
          label: "Accommodation Bookings",
          data: groupedData.accommodation,
          backgroundColor: "rgba(54, 162, 235, 0.5)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
        {
          label: "Transportation Bookings",
          data: groupedData.transportation,
          backgroundColor: "rgba(255, 99, 132, 0.5)",
          borderColor: "rgba(255, 99, 132, 1)",
          borderWidth: 1,
        },
        {
          label: "Package Bookings",
          data: groupedData.packages,
          backgroundColor: "rgba(75, 192, 192, 0.5)",
          borderColor: "rgba(75, 192, 192, 1)",
          borderWidth: 1,
        },
        {
          label: "Experience Bookings",
          data: groupedData.experiences,
          backgroundColor: "rgba(153, 102, 255, 0.5)",
          borderColor: "rgba(153, 102, 255, 1)",
          borderWidth: 1,
        },
      ],
    };
  }

  /**
   * Get vendor revenue chart data
   */
  async _getVendorRevenueChart(vendorId, dateRange) {
    const revenueData = await this._getVendorRevenueStats(vendorId, dateRange);

    return {
      labels: ["Accommodation", "Transportation", "Packages", "Experiences"],
      datasets: [
        {
          label: "Revenue by Category",
          data: [
            revenueData.byType.accommodations,
            revenueData.byType.transportation,
            revenueData.byType.packages,
            revenueData.byType.experiences,
          ],
          backgroundColor: [
            "rgba(54, 162, 235, 0.5)",
            "rgba(255, 99, 132, 0.5)",
            "rgba(75, 192, 192, 0.5)",
            "rgba(153, 102, 255, 0.5)",
          ],
          borderColor: [
            "rgba(54, 162, 235, 1)",
            "rgba(255, 99, 132, 1)",
            "rgba(75, 192, 192, 1)",
            "rgba(153, 102, 255, 1)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }

  /**
   * Get vendor popular items chart data
   */
  async _getVendorPopularItemsChart(vendorId, dateRange) {
    // Get top accommodations
    const topAccommodations = await prisma.accommodationBooking.groupBy({
      by: ["accommodationId"],
      where: {
        accommodation: { vendorId },
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: 5,
    });

    // Get accommodation names
    const accommodationNames = await Promise.all(
      topAccommodations.map(async (item) => {
        const acc = await prisma.accommodation.findUnique({
          where: { id: item.accommodationId },
          select: { name: true },
        });
        return acc?.name || "Unknown";
      }),
    );

    // Get top experiences
    const topExperiences = await prisma.experienceBooking.groupBy({
      by: ["experienceId"],
      where: {
        experience: { vendorId },
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: true,
      orderBy: { _count: { id: "desc" } },
      take: 5,
    });

    // Get experience titles
    const experienceNames = await Promise.all(
      topExperiences.map(async (item) => {
        const exp = await prisma.vendorExperience.findUnique({
          where: { id: item.experienceId },
          select: { name : true },
        });
        return exp?.title || "Unknown";
      }),
    );

    return {
      labels: [...accommodationNames, ...experienceNames].slice(0, 10),
      datasets: [
        {
          label: "Popular Items",
          data: [
            ...topAccommodations.map((a) => a._count),
            ...topExperiences.map((e) => e._count),
          ].slice(0, 10),
          backgroundColor: "rgba(255, 159, 64, 0.5)",
          borderColor: "rgba(255, 159, 64, 1)",
          borderWidth: 1,
        },
      ],
    };
  }

  /**
   * Get vendor customer demographics chart data
   * (Rewritten without raw SQL – using Prisma Client only)
   */
  async _getVendorCustomerDemographicsChart(vendorId, dateRange) {
    try {
      // ────────────────────────────────────────────────
      // 1. Collect unique user IDs from all relevant bookings
      // ────────────────────────────────────────────────

      // Helper to extract userIds from one booking type
      const getUserIdsFromBookings = async (model, whereCondition) => {
        const bookings = await model.findMany({
          where: {
            ...whereCondition,
            createdAt: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          select: {
            travelPlan: {
              select: {
                userId: true,
              },
            },
          },
          distinct: ["travelPlanId"], // helps reduce duplicates early
        });

        return bookings
          .map((b) => b.travelPlan?.userId)
          .filter((id) => id != null); // remove null/undefined
      };

      const [
        accommodationUserIds,
        transportationUserIds,
        packageUserIds,
        experienceUserIds,
      ] = await Promise.all([
        // Accommodation
        getUserIdsFromBookings(prisma.accommodationBooking, {
          accommodation: { vendorId },
        }),

        // Transportation
        getUserIdsFromBookings(prisma.transportationBooking, {
          provider: { vendorId },
        }),

        // Travel Packages
        getUserIdsFromBookings(prisma.travelPackageBooking, {
          package: { vendorId },
        }),

        // Experiences
        getUserIdsFromBookings(prisma.experienceBooking, {
          experience: { vendorId },
        }),
      ]);

      // Combine and deduplicate user IDs
      const uniqueUserIds = [
        ...new Set([
          ...accommodationUserIds,
          ...transportationUserIds,
          ...packageUserIds,
          ...experienceUserIds,
        ]),
      ];

      if (uniqueUserIds.length === 0) {
        return {
          byCountry: { labels: [], datasets: [{ data: [] }] },
          byAge: { labels: [], datasets: [{ data: [] }] },
        };
      }

      // ────────────────────────────────────────────────
      // 2. Fetch users + profiles
      // ────────────────────────────────────────────────
      const users = await prisma.user.findMany({
        where: {
          id: { in: uniqueUserIds },
        },
        include: {
          profile: true,
        },
        // Optional: limit if you expect very large result sets
        // take: 500,
      });

      // ────────────────────────────────────────────────
      // 3. Group by country (nationality)
      // ────────────────────────────────────────────────
      const byCountry = {};
      users.forEach((user) => {
        const country = user.profile?.nationality || "Unknown";
        byCountry[country] = (byCountry[country] || 0) + 1;
      });

      // ────────────────────────────────────────────────
      // 4. Group by age range (if dateOfBirth exists)
      // ────────────────────────────────────────────────
      const byAge = {
        "18-25": 0,
        "26-35": 0,
        "36-50": 0,
        "50+": 0,
        Unknown: 0,
      };

      users.forEach((user) => {
        const birthdate = user.profile?.dateOfBirth; // note field name from your schema

        if (birthdate) {
          const age = this._calculateAge(birthdate);
          if (age <= 25) byAge["18-25"]++;
          else if (age <= 35) byAge["26-35"]++;
          else if (age <= 50) byAge["36-50"]++;
          else byAge["50+"]++;
        } else {
          byAge["Unknown"]++;
        }
      });

      // ────────────────────────────────────────────────
      // 5. Format for chart.js / frontend
      // ────────────────────────────────────────────────
      return {
        byCountry: {
          labels: Object.keys(byCountry),
          datasets: [
            {
              data: Object.values(byCountry),
              backgroundColor: "rgba(75, 192, 192, 0.5)",
              borderColor: "rgba(75, 192, 192, 1)",
              borderWidth: 1,
            },
          ],
        },
        byAge: {
          labels: Object.keys(byAge),
          datasets: [
            {
              data: Object.values(byAge),
              backgroundColor: "rgba(153, 102, 255, 0.5)",
              borderColor: "rgba(153, 102, 255, 1)",
              borderWidth: 1,
            },
          ],
        },
      };
    } catch (err) {
      console.error("Error in _getVendorCustomerDemographicsChart:", err);
      return {
        byCountry: { labels: [], datasets: [{ data: [] }] },
        byAge: { labels: [], datasets: [{ data: [] }] },
        error: "Failed to load demographics data",
      };
    }
  }
  /**
   * Group data by time period helper
   */
  _groupByTimePeriod(
    accommodation,
    transportation,
    packages,
    experiences,
    dateRange,
  ) {
    const daysDiff = Math.ceil(
      (dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24),
    );
    const useDaily = daysDiff <= 31; // Use daily for up to 31 days, otherwise monthly

    const grouped = {};

    const processItems = (items, type) => {
      items.forEach((item) => {
        const date = new Date(item.createdAt);
        const key = useDaily
          ? date.toISOString().split("T")[0]
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

        if (!grouped[key]) {
          grouped[key] = {
            accommodation: 0,
            transportation: 0,
            packages: 0,
            experiences: 0,
          };
        }

        if (type === "accommodation") {
          grouped[key].accommodation += item.totalCost || 0;
        } else if (type === "transportation") {
          grouped[key].transportation += item.actualFare || 0;
        } else if (type === "packages") {
          grouped[key].packages += item.finalAmount || 0;
        } else if (type === "experiences") {
          grouped[key].experiences += item.totalAmount || 0;
        }
      });
    };

    processItems(accommodation, "accommodation");
    processItems(transportation, "transportation");
    processItems(packages, "packages");
    processItems(experiences, "experiences");

    const sortedKeys = Object.keys(grouped).sort();

    return {
      labels: sortedKeys,
      accommodation: sortedKeys.map((k) => grouped[k].accommodation),
      transportation: sortedKeys.map((k) => grouped[k].transportation),
      packages: sortedKeys.map((k) => grouped[k].packages),
      experiences: sortedKeys.map((k) => grouped[k].experiences),
    };
  }

  /**
   * Group count by time period helper
   */
  _groupCountByTimePeriod(
    accommodation,
    transportation,
    packages,
    experiences,
    dateRange,
  ) {
    const daysDiff = Math.ceil(
      (dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24),
    );
    const useDaily = daysDiff <= 31;

    const grouped = {};

    const processItems = (items, type) => {
      items.forEach((item) => {
        const date = new Date(item.createdAt);
        const key = useDaily
          ? date.toISOString().split("T")[0]
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

        if (!grouped[key]) {
          grouped[key] = {
            accommodation: 0,
            transportation: 0,
            packages: 0,
            experiences: 0,
          };
        }

        grouped[key][type] += Number(item._count) || 1;
      });
    };

    processItems(accommodation, "accommodation");
    processItems(transportation, "transportation");
    processItems(packages, "packages");
    processItems(experiences, "experiences");

    const sortedKeys = Object.keys(grouped).sort();

    return {
      labels: sortedKeys,
      accommodation: sortedKeys.map((k) => grouped[k].accommodation),
      transportation: sortedKeys.map((k) => grouped[k].transportation),
      packages: sortedKeys.map((k) => grouped[k].packages),
      experiences: sortedKeys.map((k) => grouped[k].experiences),
    };
  }

  /**
   * Calculate age from birthdate
   */
  _calculateAge(birthdate) {
    const today = new Date();
    const birthDate = new Date(birthdate);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }
  /**
   * Get alerts for current user
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
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);

      const alerts = await this._getUserAlerts(userId, roleInfo);

      res.json({
        success: true,
        data: alerts,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get upcoming items (bookings, tasks, etc.)
   * GET /api/dashboard/upcoming
   */
  async getUpcomingItems(req, res, next) {
    try {
      const userId = req.user.id;
      const { limit = 10 } = req.query;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { vendor: true },
      });

      const isSuperAdmin = req.user.isSuperAdmin || false;
      const roleInfo = await this._determineUserRole(user, isSuperAdmin);

      let upcomingItems = [];

      if (isSuperAdmin) {
        upcomingItems = await this._getSuperAdminUpcoming(parseInt(limit));
      } else if (user.vendor) {
        upcomingItems = await this._getVendorUpcoming(
          user.vendor.id,
          parseInt(limit),
          roleInfo.vendorRole,
        );
      } else {
        upcomingItems = await this._getUserUpcoming(userId, parseInt(limit));
      }

      res.json({
        success: true,
        data: upcomingItems,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get performance metrics
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

      if (!user.vendor && !isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "Performance metrics not available for regular users",
        });
      }

      let metrics = {};

      if (isSuperAdmin) {
        metrics = await this._getSystemPerformanceMetrics();
      } else if (user.vendor) {
        const vendorRole = await this._getVendorRole(user.vendor.id, userId);
        metrics = await this._getVendorPerformanceMetrics(
          user.vendor.id,
          vendorRole,
        );
      }

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PRIVATE METHODS - ROLE DETERMINATION ====================

  /**
   * Determine user's role hierarchy
   */
  async _determineUserRole(user, isSuperAdmin) {
    const roleInfo = {
      primaryRole: "USER",
      allRoles: ["USER"],
      vendorRole: null,
      vendorPermissions: [],
    };

    // Check SuperAdmin first (highest priority)
    if (isSuperAdmin) {
      roleInfo.primaryRole = "SUPER_ADMIN";
      roleInfo.allRoles.unshift("SUPER_ADMIN");
      return roleInfo;
    }

    // Check if user is a vendor
    if (user.vendor) {
      roleInfo.allRoles.push("VENDOR");

      // Check vendor team role
      const teamMember = user.vendor.teamMembers?.find(
        (tm) => tm.userId === user.id,
      );

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
        // Vendor owner
        roleInfo.primaryRole = "VENDOR";
        roleInfo.vendorRole = "OWNER";
      }
    }

    return roleInfo;
  }

  /**
   * Get vendor role for a user
   */
  async _getVendorRole(vendorId, userId) {
    const teamMember = await prisma.vendorTeamMember.findUnique({
      where: {
        vendorId_userId: {
          vendorId,
          userId,
        },
      },
    });

    if (teamMember) {
      return teamMember.role;
    }

    // Check if user is the vendor owner
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    if (vendor?.userId === userId) {
      return "OWNER";
    }

    return null;
  }

  /**
   * Get vendor permissions based on role
   */
  async _getVendorPermissions(vendorId, userId, vendorRole) {
    const basePermissions = {
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
        return {
          ...basePermissions,
          canViewAnalytics: true,
          canManageListings: true,
          canManageBookings: true,
          canManageTeam: true,
          canManagePayouts: true,
          canEditProfile: true,
          canReplyToReviews: true,
        };

      case "MANAGER":
        return {
          ...basePermissions,
          canViewAnalytics: true,
          canManageListings: true,
          canManageBookings: true,
          canManageTeam: false,
          canManagePayouts: false,
          canEditProfile: false,
          canReplyToReviews: true,
        };

      case "EDITOR":
        return {
          ...basePermissions,
          canViewAnalytics: false,
          canManageListings: true,
          canManageBookings: true,
          canManageTeam: false,
          canManagePayouts: false,
          canEditProfile: false,
          canReplyToReviews: false,
        };

      case "VIEWER":
        return {
          ...basePermissions,
          canViewAnalytics: false,
          canManageListings: false,
          canManageBookings: false,
          canManageTeam: false,
          canManagePayouts: false,
          canEditProfile: false,
          canReplyToReviews: false,
        };

      default:
        return basePermissions;
    }
  }

  // ==================== PRIVATE METHODS - SUPER ADMIN ====================

  /**
   * Get super admin dashboard
   */
  async _getSuperAdminDashboard(userId, dashboardData) {
    const [
      systemStats,
      recentUsers,
      recentVendors,
      recentBookings,
      pendingApprovals,
      revenueData,
    ] = await Promise.all([
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
        id: `user-${u.id}`,
        type: "NEW_USER",
        title: "New User Registered",
        description: `${u.name || u.email} joined the platform`,
        timestamp: u.createdAt,
        icon: "user-plus",
        color: "green",
        data: u,
      })),
      ...recentVendors.map((v) => ({
        id: `vendor-${v.id}`,
        type: "NEW_VENDOR",
        title: "New Vendor Application",
        description: `${v.businessName} applied to become a vendor`,
        timestamp: v.createdAt,
        icon: "store",
        color: "blue",
        data: v,
      })),
      ...recentBookings.map((b) => ({
        id: `booking-${b.id}`,
        type: "NEW_BOOKING",
        title: "New Booking",
        description: `New booking created for ${b.travelPlan?.title || "a travel plan"}`,
        timestamp: b.createdAt,
        icon: "calendar-check",
        color: "purple",
        data: b,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    dashboardData.quickActions = [
      {
        id: "review-vendors",
        label: "Review Vendors",
        icon: "clipboard-check",
        url: "/admin/vendors/pending",
        count: pendingApprovals.vendors,
        color: "yellow",
      },
      {
        id: "manage-users",
        label: "Manage Users",
        icon: "users",
        url: "/admin/users",
        color: "blue",
      },
      {
        id: "view-reports",
        label: "View Reports",
        icon: "chart-bar",
        url: "/admin/reports",
        color: "green",
      },
      {
        id: "system-settings",
        label: "System Settings",
        icon: "cog",
        url: "/admin/settings",
        color: "gray",
      },
      {
        id: "process-payouts",
        label: "Process Payouts",
        icon: "credit-card",
        url: "/admin/payouts",
        count: pendingApprovals.payouts,
        color: "purple",
      },
    ];

    dashboardData.overview = {
      totalUsers: systemStats.totalUsers,
      totalVendors: systemStats.totalVendors,
      totalBookings: systemStats.totalBookings,
      revenue: revenueData.total,
      growth: revenueData.growth,
      pendingApprovals,
    };

    return dashboardData;
  }

  /**
   * Get super admin statistics
   */
  async _getSuperAdminStats(period, category) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      period,
      users: await this._getUserStatsByPeriod(dateRange),
      vendors: await this._getVendorStatsByPeriod(dateRange),
      bookings: await this._getBookingStatsByPeriod(dateRange),
      revenue: await this._getRevenueStatsByPeriod(dateRange),
      platform: await this._getPlatformStats(),
    };

    // Filter by category if specified
    if (category && baseStats[category]) {
      return { [category]: baseStats[category] };
    }

    return baseStats;
  }

  /**
   * Get super admin overview
   */
  async _getSuperAdminOverview() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      usersToday,
      vendorsToday,
      bookingsToday,
      revenueToday,
      activeUsers,
      activeVendors,
      systemHealth,
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.vendor.count({ where: { createdAt: { gte: today } } }),
      this._getBookingsCountSince(today),
      this._getRevenueSince(today),
      prisma.user.count({
        where: {
          lastLoginAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.vendor.count({ where: { isActive: true } }),
      this._getSystemHealth(),
    ]);

    return {
      today: {
        newUsers: usersToday,
        newVendors: vendorsToday,
        newBookings: bookingsToday,
        revenue: revenueToday,
      },
      active: {
        users: activeUsers,
        vendors: activeVendors,
      },
      health: systemHealth,
    };
  }

  /**
   * Get super admin chart data
   */
  async _getSuperAdminChartData(chart, period) {
    const dateRange = this._getDateRange(period);

    switch (chart) {
      case "user-growth":
        return await this._getUserGrowthChart(dateRange);
      case "revenue":
        return await this._getRevenueChart(dateRange);
      case "bookings":
        return await this._getBookingsChart(dateRange);
      case "vendor-types":
        return await this._getVendorTypeDistribution();
      default:
        return {};
    }
  }

  /**
   * Get super admin upcoming items
   */
  async _getSuperAdminUpcoming(limit) {
    const [pendingVendors, pendingPayouts, upcomingReviews] = await Promise.all(
      [
        prisma.vendor.findMany({
          where: { verificationStatus: "PENDING" },
          take: limit,
          orderBy: { createdAt: "asc" },
        }),
        prisma.payout.findMany({
          where: { status: "PENDING" },
          take: limit,
          orderBy: { requestedAt: "asc" },
          include: { vendor: { select: { businessName: true } } },
        }),
        this._getUpcomingReviews(limit),
      ],
    );

    return [
      ...pendingVendors.map((v) => ({
        id: `vendor-${v.id}`,
        type: "PENDING_VENDOR",
        title: "Pending Vendor Verification",
        description: v.businessName,
        date: v.createdAt,
        priority: "high",
        action: `/admin/vendors/${v.id}`,
      })),
      ...pendingPayouts.map((p) => ({
        id: `payout-${p.id}`,
        type: "PENDING_PAYOUT",
        title: "Pending Payout Request",
        description: `${p.vendor.businessName} - $${p.amount}`,
        date: p.requestedAt,
        priority: "medium",
        action: `/admin/payouts/${p.id}`,
      })),
      ...upcomingReviews,
    ].slice(0, limit);
  }

  // ==================== PRIVATE METHODS - VENDOR ADMIN ====================

  /**
   * Get vendor admin dashboard
   */
  async _getVendorAdminDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [
      vendorStats,
      teamMembers,
      pendingApprovals,
      recentOrders,
      performanceMetrics,
      revenueData,
    ] = await Promise.all([
      this._getVendorStats(vendorId, "month"),
      prisma.vendorTeamMember.findMany({
        where: { vendorId, isActive: true },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profile: { select: { profilePicture: true } },
            },
          },
        },
      }),
      this._getVendorPendingApprovals(vendorId),
      this._getVendorRecentOrders(vendorId, 10),
      this._getVendorPerformanceMetrics(vendorId, "ADMIN"),
      this._getVendorRevenueData(vendorId, "month"),
    ]);

    dashboardData.stats = vendorStats;
    dashboardData.team = {
      members: teamMembers,
      total: teamMembers.length,
      pendingInvites: pendingApprovals.teamInvites || 0,
    };

    dashboardData.recentActivity = recentOrders.map((order) => ({
      id: `order-${order.id}`,
      type: "NEW_ORDER",
      title: "New Order",
      description: `Order #${order.id.substring(0, 8)} - $${order.totalAmount}`,
      timestamp: order.createdAt,
      icon: "shopping-cart",
      color: "blue",
      data: order,
    }));

    dashboardData.quickActions = [
      {
        id: "manage-listings",
        label: "Manage Listings",
        icon: "building",
        url: "/vendor/listings",
        color: "blue",
      },
      {
        id: "manage-team",
        label: "Manage Team",
        icon: "users",
        url: "/vendor/team",
        count: teamMembers.length,
        color: "green",
      },
      {
        id: "view-orders",
        label: "View Orders",
        icon: "shopping-bag",
        url: "/vendor/orders",
        count: pendingApprovals.orders || 0,
        color: "purple",
      },
      {
        id: "analytics",
        label: "Analytics",
        icon: "chart-line",
        url: "/vendor/analytics",
        color: "yellow",
      },
      {
        id: "payouts",
        label: "Payouts",
        icon: "dollar-sign",
        url: "/vendor/payouts",
        color: "green",
      },
    ];

    dashboardData.overview = {
      totalListings: vendorStats.totalListings,
      totalOrders: vendorStats.totalOrders,
      revenue: revenueData.total,
      teamSize: teamMembers.length,
      pendingApprovals: pendingApprovals.total || 0,
    };

    dashboardData.performance = performanceMetrics;

    return dashboardData;
  }

  // ==================== PRIVATE METHODS - VENDOR MANAGER ====================

  /**
   * Get vendor manager dashboard
   */
  async _getVendorManagerDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [
      teamStats,
      pendingTasks,
      recentOrders,
      inventoryAlerts,
      performanceMetrics,
    ] = await Promise.all([
      this._getVendorTeamStats(vendorId),
      this._getVendorPendingTasks(vendorId, user.id),
      this._getVendorRecentOrders(vendorId, 10),
      this._getVendorInventoryAlerts(vendorId),
      this._getVendorPerformanceMetrics(vendorId, "MANAGER"),
    ]);

    dashboardData.stats = {
      ...teamStats,
      pendingTasks: pendingTasks.total,
      inventoryAlerts: inventoryAlerts.total,
    };

    dashboardData.recentActivity = [
      ...recentOrders.map((order) => ({
        id: `order-${order.id}`,
        type: "NEW_ORDER",
        title: "New Order",
        description: `Order #${order.id.substring(0, 8)} needs processing`,
        timestamp: order.createdAt,
        icon: "shopping-cart",
        color: "blue",
        data: order,
      })),
      ...inventoryAlerts.items.map((item) => ({
        id: `alert-${item.id}`,
        type: "INVENTORY_ALERT",
        title: "Low Inventory",
        description: `${item.name} is running low (${item.stock} left)`,
        timestamp: item.updatedAt,
        icon: "exclamation-triangle",
        color: "yellow",
        data: item,
      })),
    ].slice(0, 20);

    dashboardData.quickActions = [
      {
        id: "process-orders",
        label: "Process Orders",
        icon: "clipboard-check",
        url: "/vendor/orders/pending",
        count: pendingTasks.orders,
        color: "blue",
      },
      {
        id: "manage-inventory",
        label: "Manage Inventory",
        icon: "box",
        url: "/vendor/inventory",
        count: inventoryAlerts.total,
        color: "yellow",
      },
      {
        id: "team-tasks",
        label: "Team Tasks",
        icon: "tasks",
        url: "/vendor/tasks",
        count: pendingTasks.team,
        color: "green",
      },
      {
        id: "customer-service",
        label: "Customer Service",
        icon: "headset",
        url: "/vendor/support",
        count: pendingTasks.support,
        color: "purple",
      },
    ];

    dashboardData.overview = {
      teamPerformance: performanceMetrics.team,
      pendingTasks: pendingTasks.total,
      inventoryStatus: inventoryAlerts.status,
    };

    return dashboardData;
  }

  // ==================== PRIVATE METHODS - VENDOR (OWNER) ====================

  /**
   * Get vendor dashboard (owner)
   */
  async _getVendorDashboard(user, dashboardData) {
    const vendorId = user.vendor.id;

    const [
      listingStats,
      bookingStats,
      recentTransactions,
      revenueData,
      reviews,
    ] = await Promise.all([
      this._getVendorListingStats(vendorId),
      this._getVendorBookingStats(vendorId),
      this._getVendorRecentTransactions(vendorId, 10),
      this._getVendorRevenueData(vendorId, "month"),
      this._getVendorRecentReviews(vendorId, 5),
    ]);

    dashboardData.stats = {
      ...listingStats,
      ...bookingStats,
      balance: user.vendor.balance || 0,
      lifetimeEarnings: user.vendor.lifetimeEarnings || 0,
      averageRating: user.vendor.overallRating || 0,
    };

    dashboardData.recentActivity = [
      ...recentTransactions.map((t) => ({
        id: `transaction-${t.id}`,
        type: "TRANSACTION",
        title: t.type === "CREDIT" ? "Payment Received" : "Payout Processed",
        description: `$${t.amount} - ${t.description || ""}`,
        timestamp: t.createdAt,
        icon: t.type === "CREDIT" ? "arrow-down" : "arrow-up",
        color: t.type === "CREDIT" ? "green" : "red",
        data: t,
      })),
      ...reviews.map((r) => ({
        id: `review-${r.id}`,
        type: "NEW_REVIEW",
        title: "New Review",
        description: `${r.rating}★ - ${r.comment?.substring(0, 50)}${r.comment?.length > 50 ? "..." : ""}`,
        timestamp: r.createdAt,
        icon: "star",
        color: "yellow",
        data: r,
      })),
    ].slice(0, 20);

    dashboardData.quickActions = [
      {
        id: "add-listing",
        label: "Add Listing",
        icon: "plus-circle",
        url: "/vendor/listings/add",
        color: "blue",
      },
      {
        id: "view-bookings",
        label: "View Bookings",
        icon: "calendar",
        url: "/vendor/bookings",
        color: "green",
      },
      {
        id: "earnings",
        label: "Earnings",
        icon: "dollar-sign",
        url: "/vendor/earnings",
        count: `$${user.vendor.balance || 0}`,
        color: "purple",
      },
      {
        id: "reviews",
        label: "Reviews",
        icon: "star",
        url: "/vendor/reviews",
        count: reviews.length,
        color: "yellow",
      },
    ];

    dashboardData.overview = {
      activeListings: listingStats.active,
      pendingBookings: bookingStats.pending,
      revenue: revenueData.total,
      recentReviews: reviews.length,
    };

    return dashboardData;
  }

  // ==================== PRIVATE METHODS - REGULAR USER ====================

  /**
   * Get regular user dashboard
   */
  async _getUserDashboard(userId, dashboardData) {
    const [
      travelPlans,
      upcomingTrips,
      savedItems,
      recentActivity,
      recommendations,
    ] = await Promise.all([
      this._getUserTravelPlans(userId, 3),
      this._getUserUpcomingTrips(userId, 5),
      this._getUserSavedItems(userId, 5),
      this._getUserRecentActivity(userId, 10),
      this._getUserRecommendations(userId, 5),
    ]);

    dashboardData.stats = {
      totalTravelPlans: travelPlans.total,
      upcomingTrips: upcomingTrips.length,
      savedItems: savedItems.length,
      completedTrips: travelPlans.completed || 0,
      totalSpent: travelPlans.totalSpent || 0,
    };

    dashboardData.recentActivity = recentActivity;
    dashboardData.travelPlans = travelPlans.items;
    dashboardData.upcomingTrips = upcomingTrips;
    dashboardData.savedItems = savedItems;
    dashboardData.recommendations = recommendations;

    dashboardData.quickActions = [
      {
        id: "create-trip",
        label: "Create Trip",
        icon: "plus-circle",
        url: "/travel-plans/new",
        color: "blue",
      },
      {
        id: "my-trips",
        label: "My Trips",
        icon: "plane",
        url: "/travel-plans",
        color: "green",
      },
      {
        id: "saved",
        label: "Saved",
        icon: "bookmark",
        url: "/saved",
        count: savedItems.length,
        color: "purple",
      },
      {
        id: "profile",
        label: "Profile",
        icon: "user",
        url: "/profile",
        color: "gray",
      },
    ];

    dashboardData.overview = {
      nextTrip: upcomingTrips[0] || null,
      recentPlans: travelPlans.items,
      recommendations: recommendations.length,
    };

    return dashboardData;
  }

  /**
   * Get user statistics
   */
  async _getUserStats(userId, period, category) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      travelPlans: await this._getUserTravelPlanStats(userId, dateRange),
      bookings: await this._getUserBookingStats(userId, dateRange),
      spending: await this._getUserSpendingStats(userId, dateRange),
      activity: await this._getUserActivityStats(userId, dateRange),
    };

    if (category && baseStats[category]) {
      return { [category]: baseStats[category] };
    }

    return baseStats;
  }

  /**
   * Get user overview
   */
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

  /**
   * Get user chart data
   */
  async _getUserChartData(userId, chart, period) {
    const dateRange = this._getDateRange(period);

    switch (chart) {
      case "travel-stats":
        return await this._getUserTravelChart(userId, dateRange);
      case "spending":
        return await this._getUserSpendingChart(userId, dateRange);
      case "activity":
        return await this._getUserActivityChart(userId, dateRange);
      default:
        return {};
    }
  }

  /**
   * Get user upcoming items
   */
  async _getUserUpcoming(userId, limit) {
    const [upcomingTrips, upcomingBookings, pendingPayments] =
      await Promise.all([
        this._getUserUpcomingTrips(userId, limit),
        this._getUserUpcomingBookings(userId, limit),
        this._getUserPendingPayments(userId, limit),
      ]);

    return [
      ...upcomingTrips.map((trip) => ({
        id: `trip-${trip.id}`,
        type: "TRIP",
        title: trip.title,
        description: `${trip.destination} - ${new Date(trip.startDate).toLocaleDateString()}`,
        date: trip.startDate,
        icon: "plane",
        color: "blue",
        action: `/travel-plans/${trip.id}`,
      })),
      ...upcomingBookings.map((booking) => ({
        id: `booking-${booking.id}`,
        type: "BOOKING",
        title: booking.title || "Booking",
        description: booking.description,
        date: booking.date,
        icon: "calendar-check",
        color: "green",
        action: booking.url,
      })),
      ...pendingPayments.map((payment) => ({
        id: `payment-${payment.id}`,
        type: "PAYMENT",
        title: "Pending Payment",
        description: `$${payment.amount} - Due ${new Date(payment.dueDate).toLocaleDateString()}`,
        date: payment.dueDate,
        icon: "credit-card",
        color: "yellow",
        action: payment.url,
        priority: "high",
      })),
    ]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  }

  // ==================== PRIVATE METHODS - COMMON DATA FETCHERS ====================

  /**
   * Get widgets by role
   */
  async _getWidgetsByRole(role, user, preferences = {}) {
    const defaultWidgets = {
      SUPER_ADMIN: [
        {
          id: "stats-overview",
          title: "Platform Overview",
          type: "stats",
          size: "large",
          enabled: true,
        },
        {
          id: "user-growth",
          title: "User Growth",
          type: "chart",
          size: "large",
          enabled: true,
        },
        {
          id: "revenue-chart",
          title: "Revenue",
          type: "chart",
          size: "large",
          enabled: true,
        },
        {
          id: "pending-approvals",
          title: "Pending Approvals",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "recent-users",
          title: "Recent Users",
          type: "table",
          size: "medium",
          enabled: true,
        },
        {
          id: "system-health",
          title: "System Health",
          type: "metric",
          size: "small",
          enabled: true,
        },
        {
          id: "top-vendors",
          title: "Top Vendors",
          type: "list",
          size: "small",
          enabled: true,
        },
        {
          id: "recent-bookings",
          title: "Recent Bookings",
          type: "timeline",
          size: "medium",
          enabled: true,
        },
      ],
      VENDOR_ADMIN: [
        {
          id: "stats-overview",
          title: "Business Overview",
          type: "stats",
          size: "large",
          enabled: true,
        },
        {
          id: "sales-chart",
          title: "Sales",
          type: "chart",
          size: "large",
          enabled: true,
        },
        {
          id: "recent-orders",
          title: "Recent Orders",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "team-performance",
          title: "Team Performance",
          type: "metric",
          size: "small",
          enabled: true,
        },
        {
          id: "inventory-status",
          title: "Inventory Status",
          type: "gauge",
          size: "small",
          enabled: true,
        },
        {
          id: "pending-tasks",
          title: "Pending Tasks",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "customer-reviews",
          title: "Recent Reviews",
          type: "list",
          size: "small",
          enabled: true,
        },
        {
          id: "earnings",
          title: "Earnings",
          type: "metric",
          size: "small",
          enabled: true,
        },
      ],
      VENDOR_MANAGER: [
        {
          id: "stats-overview",
          title: "Team Overview",
          type: "stats",
          size: "large",
          enabled: true,
        },
        {
          id: "pending-orders",
          title: "Pending Orders",
          type: "list",
          size: "large",
          enabled: true,
        },
        {
          id: "team-tasks",
          title: "Team Tasks",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "inventory-alerts",
          title: "Inventory Alerts",
          type: "alert",
          size: "medium",
          enabled: true,
        },
        {
          id: "performance",
          title: "Performance",
          type: "metric",
          size: "small",
          enabled: true,
        },
        {
          id: "customer-issues",
          title: "Customer Issues",
          type: "list",
          size: "small",
          enabled: true,
        },
      ],
      VENDOR: [
        {
          id: "stats-overview",
          title: "My Business",
          type: "stats",
          size: "large",
          enabled: true,
        },
        {
          id: "my-listings",
          title: "My Listings",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "recent-bookings",
          title: "Recent Bookings",
          type: "list",
          size: "medium",
          enabled: true,
        },
        {
          id: "earnings",
          title: "Earnings",
          type: "metric",
          size: "small",
          enabled: true,
        },
        {
          id: "reviews",
          title: "Recent Reviews",
          type: "list",
          size: "small",
          enabled: true,
        },
        {
          id: "tasks",
          title: "Tasks",
          type: "list",
          size: "small",
          enabled: true,
        },
      ],
      USER: [
        {
          id: "stats-overview",
          title: "My Travel",
          type: "stats",
          size: "large",
          enabled: true,
        },
        {
          id: "my-trips",
          title: "My Trips",
          type: "list",
          size: "large",
          enabled: true,
        },
        {
          id: "upcoming",
          title: "Upcoming",
          type: "timeline",
          size: "medium",
          enabled: true,
        },
        {
          id: "saved-items",
          title: "Saved Items",
          type: "grid",
          size: "medium",
          enabled: true,
        },
        {
          id: "recommendations",
          title: "Recommendations",
          type: "list",
          size: "small",
          enabled: true,
        },
        {
          id: "recent-activity",
          title: "Recent Activity",
          type: "timeline",
          size: "small",
          enabled: true,
        },
      ],
    };

    const roleWidgets = defaultWidgets[role] || defaultWidgets.USER;

    // Apply user preferences
    if (preferences.widgets) {
      return roleWidgets.map((widget) => ({
        ...widget,
        enabled: preferences.widgets[widget.id]?.enabled ?? widget.enabled,
        order: preferences.widgets[widget.id]?.order ?? widget.order,
        config: preferences.widgets[widget.id]?.config || {},
      }));
    }

    return roleWidgets;
  }

  /**
   * Get quick actions by role
   */
  async _getQuickActionsByRole(role, user) {
    const baseActions = {
      SUPER_ADMIN: [
        {
          id: "manage-users",
          label: "Manage Users",
          icon: "users",
          url: "/admin/users",
          color: "blue",
        },
        {
          id: "manage-vendors",
          label: "Manage Vendors",
          icon: "store",
          url: "/admin/vendors",
          color: "green",
        },
        {
          id: "view-reports",
          label: "View Reports",
          icon: "chart-bar",
          url: "/admin/reports",
          color: "purple",
        },
        {
          id: "system-settings",
          label: "Settings",
          icon: "cog",
          url: "/admin/settings",
          color: "gray",
        },
      ],
      VENDOR_ADMIN: [
        {
          id: "add-listing",
          label: "Add Listing",
          icon: "plus-circle",
          url: "/vendor/listings/add",
          color: "blue",
        },
        {
          id: "manage-team",
          label: "Manage Team",
          icon: "users",
          url: "/vendor/team",
          color: "green",
        },
        {
          id: "view-orders",
          label: "View Orders",
          icon: "shopping-bag",
          url: "/vendor/orders",
          color: "purple",
        },
        {
          id: "analytics",
          label: "Analytics",
          icon: "chart-line",
          url: "/vendor/analytics",
          color: "yellow",
        },
      ],
      VENDOR_MANAGER: [
        {
          id: "process-orders",
          label: "Process Orders",
          icon: "clipboard-check",
          url: "/vendor/orders/pending",
          color: "blue",
        },
        {
          id: "manage-inventory",
          label: "Inventory",
          icon: "box",
          url: "/vendor/inventory",
          color: "green",
        },
        {
          id: "team-tasks",
          label: "Team Tasks",
          icon: "tasks",
          url: "/vendor/tasks",
          color: "purple",
        },
        {
          id: "support",
          label: "Support",
          icon: "headset",
          url: "/vendor/support",
          color: "yellow",
        },
      ],
      VENDOR: [
        {
          id: "add-listing",
          label: "Add Listing",
          icon: "plus-circle",
          url: "/vendor/listings/add",
          color: "blue",
        },
        {
          id: "view-bookings",
          label: "View Bookings",
          icon: "calendar",
          url: "/vendor/bookings",
          color: "green",
        },
        {
          id: "earnings",
          label: "Earnings",
          icon: "dollar-sign",
          url: "/vendor/earnings",
          color: "purple",
        },
        {
          id: "profile",
          label: "Profile",
          icon: "user",
          url: "/vendor/profile",
          color: "gray",
        },
      ],
      USER: [
        {
          id: "create-trip",
          label: "Create Trip",
          icon: "plus-circle",
          url: "/travel-plans/new",
          color: "blue",
        },
        {
          id: "my-trips",
          label: "My Trips",
          icon: "plane",
          url: "/travel-plans",
          color: "green",
        },
        {
          id: "saved",
          label: "Saved",
          icon: "bookmark",
          url: "/saved",
          color: "purple",
        },
        {
          id: "profile",
          label: "Profile",
          icon: "user",
          url: "/profile",
          color: "gray",
        },
      ],
    };

    let actions = baseActions[role] || baseActions.USER;

    // Add counts for actions where applicable
    if (role === "SUPER_ADMIN") {
      const pendingCounts = await this._getPendingCounts();
      actions = actions.map((action) => {
        if (action.id === "manage-vendors") {
          return { ...action, count: pendingCounts.vendors };
        }
        return action;
      });
    } else if (user.vendor) {
      const vendorId = user.vendor.id;
      const pendingCounts = await this._getVendorPendingCounts(vendorId);
      actions = actions.map((action) => {
        if (action.id === "process-orders" || action.id === "view-orders") {
          return { ...action, count: pendingCounts.orders };
        }
        if (action.id === "manage-inventory") {
          return { ...action, count: pendingCounts.inventoryAlerts };
        }
        return action;
      });
    }

    return actions;
  }

  /**
   * Get user notifications
   */
  async _getUserNotifications(userId) {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    return {
      items: notifications,
      unreadCount,
    };
  }

  /**
   * Get user alerts based on role
   */
  async _getUserAlerts(userId, roleInfo) {
    const alerts = [];

    // Check for pending vendor verification
    if (roleInfo.primaryRole === "VENDOR" && roleInfo.vendorRole === "OWNER") {
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { verificationStatus: true },
      });

      if (vendor && vendor.verificationStatus !== "VERIFIED") {
        alerts.push({
          id: "vendor-verification",
          type: "warning",
          title: "Vendor Verification Pending",
          message:
            "Your vendor account is pending verification. Some features may be limited.",
          action: "/vendor/profile",
          dismissible: false,
        });
      }
    }

    // Check for low balance (vendors)
    if (roleInfo.primaryRole.startsWith("VENDOR")) {
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { balance: true, minimumPayout: true },
      });

      if (vendor && vendor.balance > vendor.minimumPayout) {
        alerts.push({
          id: "payout-available",
          type: "info",
          title: "Payout Available",
          message: `You have $${vendor.balance} available for payout.`,
          action: "/vendor/payouts/request",
          dismissible: true,
        });
      }
    }

    // Check for upcoming trips (regular users)
    if (roleInfo.primaryRole === "USER") {
      const upcomingTrips = await prisma.travelPlan.count({
        where: {
          userId,
          startDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
          },
        },
      });

      if (upcomingTrips > 0) {
        alerts.push({
          id: "upcoming-trips",
          type: "info",
          title: "Upcoming Trips",
          message: `You have ${upcomingTrips} trip${upcomingTrips > 1 ? "s" : ""} coming up soon.`,
          action: "/travel-plans",
          dismissible: true,
        });
      }
    }

    return alerts;
  }

  // ==================== SYSTEM STATISTICS HELPERS ====================

  async _getSystemStats() {
    const [
      totalUsers,
      totalVendors,
      totalBookings,
      totalRevenue,
      activeUsers,
      pendingVendors,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      this._getTotalBookingsCount(),
      this._getTotalRevenue(),
      prisma.user.count({
        where: {
          lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
    ]);

    return {
      totalUsers,
      totalVendors,
      totalBookings,
      totalRevenue,
      activeUsers,
      pendingVendors,
      growthRate: await this._calculateGrowthRate(),
    };
  }

  async _getTotalBookingsCount() {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count(),
        prisma.transportationBooking.count(),
        prisma.travelPackageBooking.count(),
        prisma.experienceBooking.count(),
      ]);
    return accommodation + transportation + packages + experiences;
  }

  async _getTotalRevenue() {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({ _sum: { totalCost: true } }),
        prisma.transportationBooking.aggregate({
          _sum: { actualFare: true, estimatedFare: true },
        }),
        prisma.travelPackageBooking.aggregate({ _sum: { finalAmount: true } }),
        prisma.experienceBooking.aggregate({ _sum: { totalAmount: true } }),
      ]);

    return (
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare ||
        transportation._sum.estimatedFare ||
        0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0)
    );
  }

  async _calculateGrowthRate() {
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const [lastMonthUsers, twoMonthsAgoUsers] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: lastMonth } } }),
      prisma.user.count({
        where: { createdAt: { gte: twoMonthsAgo, lt: lastMonth } },
      }),
    ]);

    if (twoMonthsAgoUsers === 0) return 0;
    return ((lastMonthUsers - twoMonthsAgoUsers) / twoMonthsAgoUsers) * 100;
  }

  // ==================== VENDOR STATISTICS HELPERS ====================

  async _getVendorStats(vendorId, period, category, vendorRole) {
    const dateRange = this._getDateRange(period);

    const baseStats = {
      listings: await this._getVendorListingStats(vendorId),
      bookings: await this._getVendorBookingStats(vendorId, dateRange),
      revenue: await this._getVendorRevenueStats(vendorId, dateRange),
      performance: await this._getVendorPerformanceStats(vendorId),
    };

    // Add team stats for admin/manager
    if (vendorRole === "ADMIN" || vendorRole === "MANAGER") {
      baseStats.team = await this._getVendorTeamStats(vendorId);
    }

    if (category && baseStats[category]) {
      return { [category]: baseStats[category] };
    }

    return baseStats;
  }

  async _getVendorListingStats(vendorId) {
    const [accommodations, providers, packages, experiences] =
      await Promise.all([
        prisma.accommodation.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
        prisma.transportationProvider.findMany({
          where: { vendorId },
          select: { id: true, isAvailable: true },
        }),
        prisma.travelPackage.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
        prisma.vendorExperience.findMany({
          where: { vendorId },
          select: { id: true, isActive: true },
        }),
      ]);

    return {
      total:
        accommodations.length +
        providers.length +
        packages.length +
        experiences.length,
      active:
        accommodations.filter((a) => a.isActive).length +
        providers.filter((p) => p.isAvailable).length +
        packages.filter((p) => p.isActive).length +
        experiences.filter((e) => e.isActive).length,
      byType: {
        accommodations: accommodations.length,
        transportation: providers.length,
        packages: packages.length,
        experiences: experiences.length,
      },
    };
  }

  async _getVendorBookingStats(vendorId, dateRange = null) {
    const whereClause = dateRange
      ? {
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        }
      : {};

    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { ...whereClause, accommodation: { vendorId } },
        }),
        prisma.transportationBooking.count({
          where: { ...whereClause, provider: { vendorId } },
        }),
        prisma.travelPackageBooking.count({
          where: { ...whereClause, package: { vendorId } },
        }),
        prisma.experienceBooking.count({
          where: { ...whereClause, experience: { vendorId } },
        }),
      ]);

    const total = accommodation + transportation + packages + experiences;

    // Get pending counts
    const [
      pendingAccommodation,
      pendingTransportation,
      pendingPackages,
      pendingExperiences,
    ] = await Promise.all([
      prisma.accommodationBooking.count({
        where: { accommodation: { vendorId }, bookingStatus: "PENDING" },
      }),
      prisma.transportationBooking.count({
        where: { provider: { vendorId }, status: "BOOKED" },
      }),
      prisma.travelPackageBooking.count({
        where: { package: { vendorId }, status: "PENDING" },
      }),
      prisma.experienceBooking.count({
        where: { experience: { vendorId }, status: "PENDING" },
      }),
    ]);

    return {
      total,
      pending:
        pendingAccommodation +
        pendingTransportation +
        pendingPackages +
        pendingExperiences,
      byType: {
        accommodations: accommodation,
        transportation: transportation,
        packages: packages,
        experiences: experiences,
      },
    };
  }

  async _getVendorRevenueStats(vendorId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: {
            accommodation: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: {
            provider: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: {
            package: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: {
            experience: { vendorId },
            createdAt: { gte: dateRange.start, lte: dateRange.end },
          },
          _sum: { totalAmount: true },
        }),
      ]);

    const total =
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0);

    return {
      total,
      byType: {
        accommodations: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages: packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  async _getVendorPerformanceStats(vendorId) {
    const [
      accommodationRating,
      transportationRating,
      packageRating,
      experienceRating,
    ] = await Promise.all([
      prisma.accommodation.aggregate({
        where: { vendorId },
        _avg: { starRating: true },
      }),
      prisma.transportationProvider.aggregate({
        where: { vendorId },
        _avg: { rating: true },
      }),
      prisma.travelPackage.aggregate({
        where: { vendorId },
        _avg: { averageRating: true },
      }),
      prisma.vendorExperience.aggregate({
        where: { vendorId },
        _avg: { averageRating: true },
      }),
    ]);

    const ratings = [
      accommodationRating._avg.starRating,
      transportationRating._avg.rating,
      packageRating._avg.rating,
      experienceRating._avg.rating,
    ].filter((r) => r !== null);

    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    return {
      averageRating,
      totalReviews: await prisma.vendorReview.count({ where: { vendorId } }),
      responseRate: await this._calculateResponseRate(vendorId),
    };
  }

  async _calculateResponseRate(vendorId) {
    const reviews = await prisma.vendorReview.findMany({
      where: { vendorId },
      select: { response: true, createdAt: true },
    });

    if (reviews.length === 0) return 100;

    const responded = reviews.filter((r) => r.response).length;
    return (responded / reviews.length) * 100;
  }

  async _getVendorTeamStats(vendorId) {
    const [total, active, byRole] = await Promise.all([
      prisma.vendorTeamMember.count({ where: { vendorId } }),
      prisma.vendorTeamMember.count({ where: { vendorId, isActive: true } }),
      prisma.vendorTeamMember.groupBy({
        by: ["role"],
        where: { vendorId },
        _count: true,
      }),
    ]);

    const roleBreakdown = {};
    byRole.forEach((item) => {
      roleBreakdown[item.role] = item._count;
    });

    return {
      total,
      active,
      byRole: roleBreakdown,
    };
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
        conversionRate:
          bookingStats.total > 0
            ? ((bookingStats.total - bookingStats.pending) /
                bookingStats.total) *
              100
            : 0,
      },
      revenue: {
        total: revenueStats.total,
        averagePerBooking:
          bookingStats.total > 0 ? revenueStats.total / bookingStats.total : 0,
      },
      responseTime,
    };

    // Add team performance for managers
    if (role === "MANAGER" || role === "ADMIN") {
      metrics.team = {
        productivity: await this._getTeamProductivity(vendorId),
        taskCompletion: await this._getTaskCompletionRate(vendorId),
      };
    }

    return metrics;
  }

  // ==================== USER STATISTICS HELPERS ====================

  async _getUserTravelPlanStats(userId, dateRange) {
    const [total, completed, planning, ongoing] = await Promise.all([
      prisma.travelPlan.count({ where: { userId } }),
      prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
      prisma.travelPlan.count({ where: { userId, status: "PLANNING" } }),
      prisma.travelPlan.count({ where: { userId, status: "ONGOING" } }),
    ]);

    return { total, completed, planning, ongoing };
  }

  async _getUserBookingStats(userId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { travelPlan: { userId }, createdAt: dateRange },
        }),
        prisma.transportationBooking.count({
          where: { travelPlan: { userId }, createdAt: dateRange },
        }),
        prisma.travelPackageBooking.count({
          where: { travelPlan: { userId }, createdAt: dateRange },
        }),
        prisma.experienceBooking.count({
          where: { travelPlan: { userId }, createdAt: dateRange },
        }),
      ]);

    return {
      total: accommodation + transportation + packages + experiences,
      byType: { accommodation, transportation, packages, experiences },
    };
  }

  async _getUserSpendingStats(userId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { totalAmount: true },
        }),
      ]);

    const total =
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0);

    return {
      total,
      byType: {
        accommodation: accommodation._sum.totalCost || 0,
        transportation: transportation._sum.actualFare || 0,
        packages: packages._sum.finalAmount || 0,
        experiences: experiences._sum.totalAmount || 0,
      },
    };
  }

  async _getUserActivityStats(userId, dateRange) {
    const [travelPlansCreated, bookingsMade, reviewsWritten, logins] =
      await Promise.all([
        prisma.travelPlan.count({ where: { userId, createdAt: dateRange } }),
        this._getUserBookingStats(userId, dateRange).then((s) => s.total),
        prisma.vendorReview.count({ where: { userId, createdAt: dateRange } }),
        prisma.profile.findUnique({
          where: { userId },
          select: { lastLogin: true },
        }),
      ]);

    return {
      travelPlansCreated,
      bookingsMade,
      reviewsWritten,
      lastLogin: logins?.lastLogin,
    };
  }

  async _getUserTravelPlans(userId, limit) {
    const [items, total, completed] = await Promise.all([
      prisma.travelPlan.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          _count: {
            select: {
              accommodations: true,
              transportServices: true,
              experiences: true,
            },
          },
        },
      }),
      prisma.travelPlan.count({ where: { userId } }),
      prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
    ]);

    return { items, total, completed };
  }

  async _getUserUpcomingTrips(userId, limit) {
    return prisma.travelPlan.findMany({
      where: {
        userId,
        startDate: { gte: new Date() },
      },
      orderBy: { startDate: "asc" },
      take: limit,
      select: {
        id: true,
        title: true,
        destination: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
  }

  async _getUserSavedItems(userId, limit) {
    // This would need a SavedItem model
    return [];
  }

  async _getUserRecentActivity(userId, limit) {
    const [travelPlans, bookings, reviews] = await Promise.all([
      prisma.travelPlan.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: Math.ceil(limit / 3),
        select: {
          id: true,
          title: true,
          updatedAt: true,
          status: true,
        },
      }),
      this._getRecentBookingsForUser(userId, Math.ceil(limit / 3)),
      prisma.vendorReview.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: Math.ceil(limit / 3),
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          vendor: { select: { businessName: true } },
        },
      }),
    ]);

    const activities = [
      ...travelPlans.map((p) => ({
        id: `plan-${p.id}`,
        type: "TRAVEL_PLAN",
        title: "Travel Plan Updated",
        description: p.title,
        timestamp: p.updatedAt,
        icon: "map",
        color: "blue",
        data: p,
      })),
      ...bookings.map((b) => ({
        id: `booking-${b.id}`,
        type: "BOOKING",
        title: "Booking Created",
        description: b.description,
        timestamp: b.createdAt,
        icon: "calendar-check",
        color: "green",
        data: b,
      })),
      ...reviews.map((r) => ({
        id: `review-${r.id}`,
        type: "REVIEW",
        title: "Review Posted",
        description: `${r.rating}★ for ${r.vendor.businessName}`,
        timestamp: r.createdAt,
        icon: "star",
        color: "yellow",
        data: r,
      })),
    ];

    return activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  async _getUserRecommendations(userId, limit) {
    // This would integrate with an AI recommendation service
    return [];
  }

  async _getUserNextTrip(userId) {
    return prisma.travelPlan.findFirst({
      where: {
        userId,
        startDate: { gte: new Date() },
      },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        title: true,
        destination: true,
        startDate: true,
        endDate: true,
      },
    });
  }

  async _getUserRecentPlans(userId, limit) {
    return prisma.travelPlan.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        destination: true,
        startDate: true,
        status: true,
      },
    });
  }

  async _getUserTotalSpent(userId) {
    const spending = await this._getUserSpendingStats(userId, {
      start: new Date(0),
      end: new Date(),
    });
    return spending.total;
  }

  async _getUserSavedCount(userId) {
    // This would need a SavedItem model
    return 0;
  }

  async _getUserMemberSince(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    return user?.createdAt;
  }

  async _getUserTravelChart(userId, dateRange) {
    const plans = await prisma.travelPlan.findMany({
      where: { userId, createdAt: dateRange },
      select: { createdAt: true, status: true },
    });

    // Group by month
    const byMonth = {};
    plans.forEach((p) => {
      const month = p.createdAt.toISOString().substring(0, 7);
      if (!byMonth[month]) {
        byMonth[month] = { total: 0, completed: 0, planning: 0 };
      }
      byMonth[month].total++;
      if (p.status === "COMPLETED") byMonth[month].completed++;
      else if (p.status === "PLANNING") byMonth[month].planning++;
    });

    return {
      labels: Object.keys(byMonth).sort(),
      datasets: [
        {
          label: "Total",
          data: Object.keys(byMonth)
            .sort()
            .map((m) => byMonth[m].total),
        },
        {
          label: "Completed",
          data: Object.keys(byMonth)
            .sort()
            .map((m) => byMonth[m].completed),
        },
      ],
    };
  }

  async _getUserSpendingChart(userId, dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.groupBy({
          by: ["createdAt"],
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.groupBy({
          by: ["createdAt"],
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.groupBy({
          by: ["createdAt"],
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.groupBy({
          by: ["createdAt"],
          where: { travelPlan: { userId }, createdAt: dateRange },
          _sum: { totalAmount: true },
        }),
      ]);

    // Group by month
    const byMonth = {};

    const processBookings = (bookings, type) => {
      bookings.forEach((b) => {
        const month = b.createdAt.toISOString().substring(0, 7);
        if (!byMonth[month]) {
          byMonth[month] = {
            accommodation: 0,
            transportation: 0,
            packages: 0,
            experiences: 0,
          };
        }
        byMonth[month][type] +=
          b._sum[
            type === "accommodation"
              ? "totalCost"
              : type === "transportation"
                ? "actualFare"
                : type === "packages"
                  ? "finalAmount"
                  : "totalAmount"
          ] || 0;
      });
    };

    processBookings(accommodation, "accommodation");
    processBookings(transportation, "transportation");
    processBookings(packages, "packages");
    processBookings(experiences, "experiences");

    const months = Object.keys(byMonth).sort();

    return {
      labels: months,
      datasets: [
        {
          label: "Accommodation",
          data: months.map((m) => byMonth[m].accommodation),
        },
        {
          label: "Transportation",
          data: months.map((m) => byMonth[m].transportation),
        },
        {
          label: "Packages",
          data: months.map((m) => byMonth[m].packages),
        },
        {
          label: "Experiences",
          data: months.map((m) => byMonth[m].experiences),
        },
      ],
    };
  }

  async _getUserActivityChart(userId, dateRange) {
    const activities = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
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
      labels: activities.map((a) => a.date.toISOString().split("T")[0]),
      data: activities.map((a) => Number(a.count)),
    };
  }

  async _getUserUpcomingBookings(userId, limit) {
    const [accommodation, transportation, experiences] = await Promise.all([
      prisma.accommodationBooking.findMany({
        where: {
          travelPlan: { userId },
          checkInDate: { gt: new Date() },
          bookingStatus: { in: ["CONFIRMED", "PENDING"] },
        },
        take: limit,
        orderBy: { checkInDate: "asc" },
        include: { accommodation: { select: { name: true } } },
      }),
      prisma.transportationBooking.findMany({
        where: {
          travelPlan: { userId },
          pickupTime: { gt: new Date() },
          status: { in: ["CONFIRMED", "BOOKED"] },
        },
        take: limit,
        orderBy: { pickupTime: "asc" },
        include: { provider: { select: { name: true } } },
      }),
      prisma.experienceBooking.findMany({
        where: {
          travelPlan: { userId },
          experienceDate: { gt: new Date() },
          status: { in: ["CONFIRMED", "PENDING"] },
        },
        take: limit,
        orderBy: { experienceDate: "asc" },
        include: { experience: { select: { title: true } } },
      }),
    ]);

    return [
      ...accommodation.map((a) => ({
        id: a.id,
        type: "accommodation",
        title: a.accommodation.name,
        date: a.checkInDate,
        status: a.bookingStatus,
        url: `/travel-plans/${a.travelPlanId}/accommodations/${a.id}`,
      })),
      ...transportation.map((t) => ({
        id: t.id,
        type: "transportation",
        title: t.provider.name,
        date: t.pickupTime,
        status: t.status,
        url: `/travel-plans/${t.travelPlanId}/transportation/${t.id}`,
      })),
      ...experiences.map((e) => ({
        id: e.id,
        type: "experience",
        title: e.experience.title,
        date: e.experienceDate,
        status: e.status,
        url: `/travel-plans/${e.travelPlanId}/experiences/${e.id}`,
      })),
    ]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  }

  async _getUserPendingPayments(userId, limit) {
    // This would need a payments model
    return [];
  }

  // ==================== RECENT ACTIVITY HELPERS ====================

  async _getRecentUsers(limit) {
    return prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
  }

  async _getRecentVendors(limit) {
    return prisma.vendor.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        businessName: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    });
  }

  async _getRecentBookings(limit) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.findMany({
          take: Math.ceil(limit / 4),
          orderBy: { createdAt: "desc" },
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.transportationBooking.findMany({
          take: Math.ceil(limit / 4),
          orderBy: { createdAt: "desc" },
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.travelPackageBooking.findMany({
          take: Math.ceil(limit / 4),
          orderBy: { createdAt: "desc" },
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.experienceBooking.findMany({
          take: Math.ceil(limit / 4),
          orderBy: { createdAt: "desc" },
          include: { travelPlan: { select: { title: true } } },
        }),
      ]);

    return [...accommodation, ...transportation, ...packages, ...experiences]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  async _getSystemActivities(limit, offset, type) {
    // This would need an ActivityLog model
    return [];
  }

  async _getVendorActivities(vendorId, limit, offset, type, vendorRole) {
    // This would need an ActivityLog model
    return [];
  }

  async _getUserActivities(userId, limit, offset, type) {
    // This would need an ActivityLog model
    return [];
  }

  async _getRecentBookingsForUser(userId, limit) {
    const [accommodation, transportation, experiences] = await Promise.all([
      prisma.accommodationBooking.findMany({
        where: { travelPlan: { userId } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          bookingStatus: true,
          accommodation: { select: { name: true } },
        },
      }),
      prisma.transportationBooking.findMany({
        where: { travelPlan: { userId } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          status: true,
          provider: { select: { name: true } },
        },
      }),
      prisma.experienceBooking.findMany({
        where: { travelPlan: { userId } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          status: true,
          experience: { select: { name: true } },
        },
      }),
    ]);

    return [
      ...accommodation.map((a) => ({
        id: a.id,
        type: "accommodation",
        description: `Booked ${a.accommodation.name}`,
        createdAt: a.createdAt,
        status: a.bookingStatus,
      })),
      ...transportation.map((t) => ({
        id: t.id,
        type: "transportation",
        description: `Booked ${t.provider.name}`,
        createdAt: t.createdAt,
        status: t.status,
      })),
      ...experiences.map((e) => ({
        id: e.id,
        type: "experience",
        description: `Booked ${e.experience.title}`,
        createdAt: e.createdAt,
        status: e.status,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ==================== PENDING APPROVALS HELPERS ====================

  async _getPendingApprovals() {
    const [vendors, payouts] = await Promise.all([
      prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
      prisma.payout.count({ where: { status: "PENDING" } }),
    ]);

    return { vendors, payouts };
  }

  async _getVendorPendingApprovals(vendorId) {
    const [listings, orders, teamInvites] = await Promise.all([
      this._getVendorPendingListings(vendorId),
      this._getVendorPendingOrders(vendorId),
      prisma.vendorTeamMember.count({
        where: {
          vendorId,
          isActive: false,
          invitedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
        },
      }),
    ]);

    return {
      total: listings + orders + teamInvites,
      listings,
      orders,
      teamInvites,
    };
  }

  async _getVendorPendingListings(vendorId) {
    // This would need a verification status on listings
    return 0;
  }

  async _getVendorPendingOrders(vendorId) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { accommodation: { vendorId }, bookingStatus: "PENDING" },
        }),
        prisma.transportationBooking.count({
          where: { provider: { vendorId }, status: "BOOKED" },
        }),
        prisma.travelPackageBooking.count({
          where: { package: { vendorId }, status: "PENDING" },
        }),
        prisma.experienceBooking.count({
          where: { experience: { vendorId }, status: "PENDING" },
        }),
      ]);

    return accommodation + transportation + packages + experiences;
  }

  async _getVendorPendingTasks(vendorId, userId) {
    const [orders, team, support] = await Promise.all([
      this._getVendorPendingOrders(vendorId),
      this._getVendorTeamTasks(vendorId, userId),
      this._getVendorSupportTickets(vendorId),
    ]);

    return {
      total: orders + team + support,
      orders,
      team,
      support,
    };
  }

  async _getVendorTeamTasks(vendorId, userId) {
    // This would need a Tasks model
    return 0;
  }

  async _getVendorSupportTickets(vendorId) {
    // This would need a SupportTicket model
    return 0;
  }

  async _getVendorRecentOrders(vendorId, limit) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.findMany({
          where: { accommodation: { vendorId } },
          orderBy: { createdAt: "desc" },
          take: Math.ceil(limit / 4),
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.transportationBooking.findMany({
          where: { provider: { vendorId } },
          orderBy: { createdAt: "desc" },
          take: Math.ceil(limit / 4),
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.travelPackageBooking.findMany({
          where: { package: { vendorId } },
          orderBy: { createdAt: "desc" },
          take: Math.ceil(limit / 4),
          include: { travelPlan: { select: { title: true } } },
        }),
        prisma.experienceBooking.findMany({
          where: { experience: { vendorId } },
          orderBy: { createdAt: "desc" },
          take: Math.ceil(limit / 4),
          include: { travelPlan: { select: { title: true } } },
        }),
      ]);

    return [
      ...accommodation.map((a) => ({
        ...a,
        type: "accommodation",
        totalAmount: a.totalCost,
      })),
      ...transportation.map((t) => ({
        ...t,
        type: "transportation",
        totalAmount: t.actualFare || t.estimatedFare,
      })),
      ...packages.map((p) => ({
        ...p,
        type: "package",
        totalAmount: p.finalAmount,
      })),
      ...experiences.map((e) => ({
        ...e,
        type: "experience",
        totalAmount: e.totalAmount,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  async _getVendorRecentTransactions(vendorId, limit) {
    return prisma.transaction.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async _getVendorRecentReviews(vendorId, limit) {
    return prisma.vendorReview.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            name: true,
            profile: { select: { profilePicture: true } },
          },
        },
      },
    });
  }

  async _getVendorInventoryAlerts(vendorId) {
    // This would need inventory management
    return {
      total: 0,
      items: [],
      status: "good",
    };
  }

  async _getVendorRevenueData(vendorId, period) {
    const dateRange = this._getDateRange(period);

    const [currentPeriod, previousPeriod] = await Promise.all([
      this._getVendorRevenueStats(vendorId, dateRange),
      this._getVendorRevenueStats(vendorId, {
        start: dateRange.previousStart,
        end: dateRange.previousEnd,
      }),
    ]);

    const growth =
      previousPeriod.total > 0
        ? ((currentPeriod.total - previousPeriod.total) /
            previousPeriod.total) *
          100
        : 0;

    return {
      total: currentPeriod.total,
      growth,
      byType: currentPeriod.byType,
    };
  }

  async _getVendorResponseTime(vendorId) {
    // This would need to calculate average response time to inquiries
    return 0;
  }

  async _getTeamProductivity(vendorId) {
    // This would need a Tasks/Productivity model
    return 0;
  }

  async _getTaskCompletionRate(vendorId) {
    // This would need a Tasks model
    return 0;
  }

  // ==================== REVENUE HELPERS ====================

  async _getRevenueData(period) {
    const dateRange = this._getDateRange(period);

    const [currentPeriod, previousPeriod] = await Promise.all([
      this._getTotalRevenueInRange(dateRange),
      this._getTotalRevenueInRange({
        start: dateRange.previousStart,
        end: dateRange.previousEnd,
      }),
    ]);

    const growth =
      previousPeriod > 0
        ? ((currentPeriod - previousPeriod) / previousPeriod) * 100
        : 0;

    return {
      total: currentPeriod,
      growth,
      byCategory: await this._getRevenueByCategory(dateRange),
    };
  }

  async _getTotalRevenueInRange(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { totalAmount: true },
        }),
      ]);

    return (
      (accommodation._sum.totalCost || 0) +
      (transportation._sum.actualFare || 0) +
      (packages._sum.finalAmount || 0) +
      (experiences._sum.totalAmount || 0)
    );
  }

  async _getRevenueByCategory(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { totalCost: true },
        }),
        prisma.transportationBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { actualFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          _sum: { totalAmount: true },
        }),
      ]);

    return {
      accommodation: accommodation._sum.totalCost || 0,
      transportation: transportation._sum.actualFare || 0,
      packages: packages._sum.finalAmount || 0,
      experiences: experiences._sum.totalAmount || 0,
    };
  }

  async _getRevenueSince(date) {
    return this._getTotalRevenueInRange({ start: date, end: new Date() });
  }

  // ==================== CHART DATA HELPERS ====================

  async _getUserGrowthChart(dateRange) {
    const users = await prisma.user.findMany({
      where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
      select: { createdAt: true },
    });

    // Group by month
    const byMonth = {};
    users.forEach((u) => {
      const month = u.createdAt.toISOString().substring(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    });

    const months = Object.keys(byMonth).sort();

    return {
      labels: months,
      datasets: [
        {
          label: "New Users",
          data: months.map((m) => byMonth[m]),
        },
      ],
    };
  }

  async _getRevenueChart(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.findMany({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          select: { createdAt: true, totalCost: true },
        }),
        prisma.transportationBooking.findMany({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          select: { createdAt: true, actualFare: true },
        }),
        prisma.travelPackageBooking.findMany({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          select: { createdAt: true, finalAmount: true },
        }),
        prisma.experienceBooking.findMany({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
          select: { createdAt: true, totalAmount: true },
        }),
      ]);

    // Group by month
    const byMonth = {};

    accommodation.forEach((b) => {
      const month = b.createdAt.toISOString().substring(0, 7);
      if (!byMonth[month]) byMonth[month] = 0;
      byMonth[month] += b.totalCost || 0;
    });

    transportation.forEach((b) => {
      const month = b.createdAt.toISOString().substring(0, 7);
      if (!byMonth[month]) byMonth[month] = 0;
      byMonth[month] += b.actualFare || 0;
    });

    packages.forEach((b) => {
      const month = b.createdAt.toISOString().substring(0, 7);
      if (!byMonth[month]) byMonth[month] = 0;
      byMonth[month] += b.finalAmount || 0;
    });

    experiences.forEach((b) => {
      const month = b.createdAt.toISOString().substring(0, 7);
      if (!byMonth[month]) byMonth[month] = 0;
      byMonth[month] += b.totalAmount || 0;
    });

    const months = Object.keys(byMonth).sort();

    return {
      labels: months,
      datasets: [
        {
          label: "Revenue",
          data: months.map((m) => byMonth[m]),
        },
      ],
    };
  }

  async _getBookingsChart(dateRange) {
    const bookings = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        'accommodation' as type
      FROM accommodation_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        'transportation' as type
      FROM transportation_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        'package' as type
      FROM travel_package_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        'experience' as type
      FROM experience_bookings
      WHERE created_at BETWEEN ${dateRange.start} AND ${dateRange.end}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    // Group by date and type
    const byDate = {};
    bookings.forEach((b) => {
      const dateStr = b.date.toISOString().split("T")[0];
      if (!byDate[dateStr]) {
        byDate[dateStr] = {
          accommodation: 0,
          transportation: 0,
          package: 0,
          experience: 0,
        };
      }
      byDate[dateStr][b.type] = Number(b.count);
    });

    const dates = Object.keys(byDate).sort();

    return {
      labels: dates,
      datasets: [
        {
          label: "Accommodation",
          data: dates.map((d) => byDate[d].accommodation),
        },
        {
          label: "Transportation",
          data: dates.map((d) => byDate[d].transportation),
        },
        {
          label: "Packages",
          data: dates.map((d) => byDate[d].package),
        },
        {
          label: "Experiences",
          data: dates.map((d) => byDate[d].experience),
        },
      ],
    };
  }

  async _getVendorTypeDistribution() {
    const vendors = await prisma.vendor.findMany({
      select: { vendorType: true },
    });

    const distribution = {};
    vendors.forEach((v) => {
      v.vendorType.forEach((type) => {
        distribution[type] = (distribution[type] || 0) + 1;
      });
    });

    return {
      labels: Object.keys(distribution),
      data: Object.values(distribution),
    };
  }

  async _getVendorSalesData(vendorId, dateRange) {
    return this._getVendorRevenueStats(vendorId, dateRange);
  }

  async _getSystemHealth() {
    // Check database connection
    let dbStatus = "healthy";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      dbStatus = "unhealthy";
    }

    // Check Redis connection (if available)
    let redisStatus = "unknown";
    try {
      if (redisService.client) {
        await redisService.client.ping();
        redisStatus = "healthy";
      }
    } catch (error) {
      redisStatus = "unhealthy";
    }

    // Check OpenFGA (if enabled)
    let openfgaStatus = "unknown";
    try {
      if (
        process.env.OPENFGA_ENABLED === "true" &&
        openfgaService.initialized
      ) {
        await openfgaService.getStoreInfo();
        openfgaStatus = "healthy";
      }
    } catch (error) {
      openfgaStatus = "unhealthy";
    }

    return {
      database: dbStatus,
      redis: redisStatus,
      openfga: openfgaStatus,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  async _getSystemPerformanceMetrics() {
    const [responseTime, errorRate, activeUsers, apiCalls] = await Promise.all([
      this._getAverageResponseTime(),
      this._getErrorRate(),
      prisma.user.count({
        where: { lastLoginAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
      }),
      this._getApiCallCount(),
    ]);

    return {
      responseTime,
      errorRate,
      activeUsers,
      apiCalls,
      timestamp: new Date().toISOString(),
    };
  }

  async _getAverageResponseTime() {
    // This would need to be calculated from logs/metrics
    return 250; // ms
  }

  async _getErrorRate() {
    // This would need to be calculated from logs/metrics
    return 0.5; // percentage
  }

  async _getApiCallCount() {
    // This would need to be calculated from logs/metrics
    return 10000;
  }

  // ==================== PENDING COUNTS HELPERS ====================

  async _getPendingCounts() {
    const [vendors, payouts] = await Promise.all([
      prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
      prisma.payout.count({ where: { status: "PENDING" } }),
    ]);

    return { vendors, payouts };
  }

  async _getVendorPendingCounts(vendorId) {
    const [orders, inventoryAlerts] = await Promise.all([
      this._getVendorPendingOrders(vendorId),
      this._getVendorInventoryAlerts(vendorId).then((a) => a.total),
    ]);

    return { orders, inventoryAlerts };
  }

  async _getBookingsCountSince(date) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { createdAt: { gte: date } },
        }),
        prisma.transportationBooking.count({
          where: { createdAt: { gte: date } },
        }),
        prisma.travelPackageBooking.count({
          where: { createdAt: { gte: date } },
        }),
        prisma.experienceBooking.count({ where: { createdAt: { gte: date } } }),
      ]);

    return accommodation + transportation + packages + experiences;
  }

  async _getUpcomingReviews(limit) {
    // This would need a Reviews model with scheduled reviews
    return [];
  }

  // ==================== DATE RANGE HELPERS ====================

  _getDateRange(period) {
    const now = new Date();
    const start = new Date();
    const end = new Date();

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
        // Custom period handled by from/to query params
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: now,
          previousStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          previousEnd: new Date(now.getFullYear(), now.getMonth(), 0),
        };
    }

    // Calculate previous period for comparison
    const duration = end - start;
    const previousStart = new Date(start.getTime() - duration);
    const previousEnd = new Date(end.getTime() - duration);

    return { start, end, previousStart, previousEnd };
  }

  /**
   * Get vendor upcoming items (bookings, tasks, etc.)
   */
  async _getVendorUpcoming(vendorId, limit, vendorRole) {
    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 7);
    const nextMonth = new Date(now);
    nextMonth.setMonth(now.getMonth() + 1);

    const [
      upcomingBookings,
      pendingTasks,
      scheduledMaintenance,
      teamEvents,
      pendingApprovals,
    ] = await Promise.all([
      // Upcoming bookings for the next 30 days
      this._getVendorUpcomingBookings(vendorId, limit),

      // Pending tasks (for managers/admins)
      vendorRole === "ADMIN" ||
      vendorRole === "MANAGER" ||
      vendorRole === "OWNER"
        ? this._getVendorPendingTasks(vendorId, limit)
        : Promise.resolve([]),

      // Scheduled maintenance (for accommodations/vehicles)
      this._getVendorScheduledMaintenance(vendorId, limit),

      // Team events/meetings (for managers)
      vendorRole === "ADMIN" || vendorRole === "MANAGER"
        ? this._getVendorTeamEvents(vendorId, limit)
        : Promise.resolve([]),

      // Pending approvals (for admins)
      vendorRole === "ADMIN" || vendorRole === "OWNER"
        ? this._getVendorPendingApprovals(vendorId, limit)
        : Promise.resolve([]),
    ]);

    // Combine and sort all upcoming items
    const allItems = [
      ...upcomingBookings,
      ...pendingTasks,
      ...scheduledMaintenance,
      ...teamEvents,
      ...pendingApprovals,
    ];

    // Sort by date and return limited items
    return allItems
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  }

  /**
   * Get vendor upcoming bookings
   */
async _getVendorUpcomingBookings(vendorId, limit = 10) {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(now.getDate() + 30);

  const [accommodation, transportation, packages, experiences] = await Promise.all([
    // 1. Accommodation bookings
    prisma.accommodationBooking.findMany({
      where: {
        accommodation: { vendorId },
        checkInDate: { gte: now, lte: thirtyDaysFromNow },
        bookingStatus: { in: ["CONFIRMED", "PENDING"] },
      },
      take: Math.ceil(limit / 4),
      orderBy: { checkInDate: "asc" },
      include: {
        accommodation: { select: { name: true } },
        travelPlan: {
          select: { title: true, user: { select: { name: true } } },
        },
      },
    }),

    // 2. Transportation bookings
    prisma.transportationBooking.findMany({
      where: {
        provider: { vendorId },
        pickupTime: { gte: now, lte: thirtyDaysFromNow },
        status: { in: ["CONFIRMED", "BOOKED"] },
      },
      take: Math.ceil(limit / 4),
      orderBy: { pickupTime: "asc" },
      include: {
        provider: { select: { name: true } },
        travelPlan: {
          select: { title: true, user: { select: { name: true } } },
        },
      },
    }),

    // 3. Package bookings
    prisma.travelPackageBooking.findMany({
      where: {
        package: { vendorId },
        startDate: { gte: now, lte: thirtyDaysFromNow },
        status: { in: ["CONFIRMED", "PENDING"] },
      },
      take: Math.ceil(limit / 4),
      orderBy: { startDate: "asc" },
      include: {
        package: { select: { name: true } },
        travelPlan: {
          select: { title: true, user: { select: { name: true } } },
        },
      },
    }),

    // 4. Experience bookings – FIXED HERE
    prisma.experienceBooking.findMany({
      where: {
        experience: { vendorId },
        experienceDate: { gte: now, lte: thirtyDaysFromNow },
        status: { in: ["CONFIRMED", "PENDING"] },
      },
      take: Math.ceil(limit / 4),
      orderBy: { experienceDate: "asc" },
      include: {
        experience: { select: { name: true } },          // ← changed title → name
        travelPlan: {
          select: { title: true, user: { select: { name: true } } },
        },
      },
    }),
  ]);

  // Format accommodation bookings
  const formattedAccommodation = accommodation.map((booking) => ({
    id: `acc-booking-${booking.id}`,
    type: "booking",
    category: "accommodation",
    title: `Check-in: ${booking.accommodation.name}`,
    description: `Guest: ${booking.travelPlan?.user?.name || "Unknown"} • ${booking.totalNights || "?"} nights`,
    date: booking.checkInDate,
    status: booking.bookingStatus,
    priority: this._getBookingPriority(booking.checkInDate),
    action: `/vendor/bookings/accommodation/${booking.id}`,
    icon: "hotel",
    color: "blue",
  }));

  // Format transportation bookings
  const formattedTransportation = transportation.map((booking) => ({
    id: `trans-booking-${booking.id}`,
    type: "booking",
    category: "transportation",
    title: `Pickup: ${booking.provider.name}`,
    description: `Customer: ${booking.travelPlan?.user?.name || "Unknown"} • ${booking.numberOfPassengers || 1} passengers`,
    date: booking.pickupTime,
    status: booking.status,
    priority: this._getBookingPriority(booking.pickupTime),
    action: `/vendor/bookings/transportation/${booking.id}`,
    icon: "car",
    color: "green",
  }));

  // Format package bookings – FIXED HERE
  const formattedPackages = packages.map((booking) => ({
    id: `pkg-booking-${booking.id}`,
    type: "booking",
    category: "package",
    title: `Package: ${booking.package.name}`,           // ← changed .title → .name
    description: `Customer: ${booking.travelPlan?.user?.name || "Unknown"} • ${booking.numberOfTravelers || "?"} travelers`,
    date: booking.startDate,
    status: booking.status,
    priority: this._getBookingPriority(booking.startDate),
    action: `/vendor/bookings/package/${booking.id}`,
    icon: "package",
    color: "purple",
  }));

  // Format experience bookings – FIXED HERE
  const formattedExperiences = experiences.map((booking) => ({
    id: `exp-booking-${booking.id}`,
    type: "booking",
    category: "experience",
    title: `Experience: ${booking.experience.name}`,     // ← changed .title → .name
    description: `Customer: ${booking.travelPlan?.user?.name || "Unknown"} • ${booking.numberOfParticipants || "?"} participants`,
    date: booking.experienceDate,
    status: booking.status,
    priority: this._getBookingPriority(booking.experienceDate),
    action: `/vendor/bookings/experience/${booking.id}`,
    icon: "star",
    color: "yellow",
  }));

  // Combine and sort by date
  return [
    ...formattedAccommodation,
    ...formattedTransportation,
    ...formattedPackages,
    ...formattedExperiences,
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
}
  /**
   * Get vendor pending tasks
   */
  async _getVendorPendingTasks(vendorId, limit) {
    // This would need a Tasks model - placeholder implementation
    // You can replace this with your actual tasks/queries

    const now = new Date();

    // Example: Get pending reviews that need responses
    const pendingReviews = await prisma.vendorReview.findMany({
      where: {
        vendorId,
        response: null,
        createdAt: { lte: now },
      },
      take: Math.ceil(limit / 3),
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true } },
      },
    });

    // Example: Get low inventory alerts (if you have inventory)
    // const lowInventory = await this._getLowInventoryItems(vendorId, Math.ceil(limit / 3));

    const formattedReviews = pendingReviews.map((review) => ({
      id: `task-review-${review.id}`,
      type: "task",
      category: "review",
      title: "Pending Review Response",
      description: `${review.user?.name || "A customer"} left a ${review.rating}★ review`,
      date: review.createdAt,
      priority: review.rating <= 3 ? "high" : "medium",
      action: `/vendor/reviews/${review.id}/respond`,
      icon: "chat",
      color: "yellow",
    }));

    return [
      ...formattedReviews,
      // ...lowInventory
    ];
  }

  /**
   * Get vendor scheduled maintenance
   */
  async _getVendorScheduledMaintenance(vendorId, limit) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    // This would need a Maintenance model - placeholder
    // You can implement based on your actual maintenance scheduling

    // For now, return empty array
    return [];
  }

  /**
   * Get vendor team events
   */
  async _getVendorTeamEvents(vendorId, limit) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    // This would need a Calendar/Event model - placeholder
    // You can implement based on your actual event scheduling

    return [];
  }

  /**
   * Get vendor pending approvals
   */
  async _getVendorPendingApprovals(vendorId, limit) {
    const [pendingListings, pendingTeamInvites, pendingPayouts] =
      await Promise.all([
        // Pending listing approvals (if you have a verification process)
        this._getVendorPendingListings(vendorId, Math.ceil(limit / 3)),

        // Pending team member invites
        prisma.vendorTeamMember.findMany({
          where: {
            vendorId,
            isActive: false,
            invitedAt: { not: null },
          },
          take: Math.ceil(limit / 3),
          orderBy: { invitedAt: "asc" },
          include: {
            user: { select: { name: true, email: true } },
          },
        }),

        // Pending payouts
        prisma.payout.findMany({
          where: {
            vendorId,
            status: "PENDING",
          },
          take: Math.ceil(limit / 3),
          orderBy: { requestedAt: "asc" },
        }),
      ]);

    const formattedListings = pendingListings.map((listing) => ({
      id: `approval-listing-${listing.id}`,
      type: "approval",
      category: "listing",
      title: "Listing Pending Approval",
      description: `${listing.name} requires verification`,
      date: listing.createdAt,
      priority: "medium",
      action: `/vendor/listings/${listing.id}/edit`,
      icon: "building",
      color: "blue",
    }));

    const formattedInvites = pendingTeamInvites.map((invite) => ({
      id: `approval-invite-${invite.id}`,
      type: "approval",
      category: "team",
      title: "Team Invite Pending",
      description: `${invite.user?.name || invite.user?.email} hasn't accepted invite yet`,
      date: invite.invitedAt,
      priority: "low",
      action: `/vendor/team`,
      icon: "user-plus",
      color: "green",
    }));

    const formattedPayouts = pendingPayouts.map((payout) => ({
      id: `approval-payout-${payout.id}`,
      type: "approval",
      category: "payout",
      title: "Payout Request",
      description: `$${payout.amount} payout requested`,
      date: payout.requestedAt,
      priority: "high",
      action: `/vendor/payouts/${payout.id}`,
      icon: "dollar-sign",
      color: "purple",
    }));

    return [...formattedListings, ...formattedInvites, ...formattedPayouts];
  }

/**
 * Get vendor pending listings
 * (Currently only shows unverified accommodations + all experiences as placeholder)
 */
async _getVendorPendingListings(vendorId, limit = 10) {
  const [accommodations, experiences] = await Promise.all([
    // Accommodations – only pending verification
    prisma.accommodation.findMany({
      where: {
        vendorId,
        isVerified: false,           // this field exists on Accommodation
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      select: { 
        id: true, 
        name: true, 
        createdAt: true 
      },
    }),

    // Experiences – no isVerified field exists, so we show all (or filter by isActive if desired)
    prisma.vendorExperience.findMany({
      where: {
        vendorId,
        // isVerified: false,        // ← removed (field doesn't exist)
        // Alternative: isActive: true,   // if you only want active ones
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      select: { 
        id: true, 
        name: true,                  // ← changed from title to name
        createdAt: true 
      },
    }),
  ]);

  const formattedAccommodations = accommodations.map((acc) => ({
    id: acc.id,
    name: acc.name,
    type: "accommodation",
    createdAt: acc.createdAt,
    status: "pending_verification",  // optional – just for clarity
  }));

  const formattedExperiences = experiences.map((exp) => ({
    id: exp.id,
    name: exp.name,                  // ← fixed: use name
    type: "experience",
    createdAt: exp.createdAt,
    status: "active",                // or "pending" if you add verification later
  }));

  return [...formattedAccommodations, ...formattedExperiences].slice(0, limit);
}
  /**
   * Get booking priority based on how soon it is
   */
  _getBookingPriority(bookingDate) {
    const now = new Date();
    const daysUntil = Math.ceil(
      (new Date(bookingDate) - now) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil <= 2) return "high";
    if (daysUntil <= 7) return "medium";
    return "low";
  }

  /**
   * Get low inventory items (if you have inventory management)
   */
  async _getLowInventoryItems(vendorId, limit) {
    // This would need an Inventory model
    // Placeholder - implement based on your actual inventory system
    return [];
  }

  // ==================== USER/VENDOR STATISTICS HELPERS ====================

  async _getUserStatsByPeriod(dateRange) {
    const [total, newUsers, activeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
      }),
      prisma.user.count({ where: { lastLoginAt: { gte: dateRange.start } } }),
    ]);

    return { total, new: newUsers, active: activeUsers };
  }

  async _getVendorStatsByPeriod(dateRange) {
    const [total, newVendors, verifiedVendors] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({
        where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
      }),
      prisma.vendor.count({ where: { verificationStatus: "VERIFIED" } }),
    ]);

    return { total, new: newVendors, verified: verifiedVendors };
  }

  async _getBookingStatsByPeriod(dateRange) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
        }),
        prisma.transportationBooking.count({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
        }),
        prisma.travelPackageBooking.count({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
        }),
        prisma.experienceBooking.count({
          where: { createdAt: { gte: dateRange.start, lte: dateRange.end } },
        }),
      ]);

    return {
      total: accommodation + transportation + packages + experiences,
      byType: { accommodation, transportation, packages, experiences },
    };
  }

  async _getRevenueStatsByPeriod(dateRange) {
    return this._getTotalRevenueInRange(dateRange);
  }

  async _getPlatformStats() {
    const [totalUsers, totalVendors, totalBookings] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      this._getTotalBookingsCount(),
    ]);

    return { totalUsers, totalVendors, totalBookings };
  }
}

module.exports = new DashboardController();
