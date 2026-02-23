const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class TravelPlanController {
  constructor() {
    // Bind all methods
    this.createTravelPlan = this.createTravelPlan.bind(this);
    this.getTravelPlans = this.getTravelPlans.bind(this);
    this.getTravelPlanById = this.getTravelPlanById.bind(this);
    this.updateTravelPlan = this.updateTravelPlan.bind(this);
    this.deleteTravelPlan = this.deleteTravelPlan.bind(this);
    this.shareTravelPlan = this.shareTravelPlan.bind(this);
    this.revokeAccess = this.revokeAccess.bind(this);
    this.getSharedUsers = this.getSharedUsers.bind(this);
    this.generateItinerary = this.generateItinerary.bind(this);
    this.getRecommendations = this.getRecommendations.bind(this);
    this.duplicateTravelPlan = this.duplicateTravelPlan.bind(this);
    this.getTravelPlanStats = this.getTravelPlanStats.bind(this);
    this.exportTravelPlan = this.exportTravelPlan.bind(this);
    this.addToFavorites = this.addToFavorites.bind(this);
    this.removeFromFavorites = this.removeFromFavorites.bind(this);
    this.getFavorites = this.getFavorites.bind(this);
    
    // Booking methods for different services
    this.addAccommodationBooking = this.addAccommodationBooking.bind(this);
    this.updateAccommodationBooking = this.updateAccommodationBooking.bind(this);
    this.cancelAccommodationBooking = this.cancelAccommodationBooking.bind(this);
    
    this.addTransportationBooking = this.addTransportationBooking.bind(this);
    this.updateTransportationBooking = this.updateTransportationBooking.bind(this);
    this.cancelTransportationBooking = this.cancelTransportationBooking.bind(this);
    
    this.addPackageBooking = this.addPackageBooking.bind(this);
    this.updatePackageBooking = this.updatePackageBooking.bind(this);
    this.cancelPackageBooking = this.cancelPackageBooking.bind(this);
    
    this.addExperienceBooking = this.addExperienceBooking.bind(this);
    this.updateExperienceBooking = this.updateExperienceBooking.bind(this);
    this.cancelExperienceBooking = this.cancelExperienceBooking.bind(this);
    
    this.addShoppingVisit = this.addShoppingVisit.bind(this);
    this.updateShoppingVisit = this.updateShoppingVisit.bind(this);
    this.cancelShoppingVisit = this.cancelShoppingVisit.bind(this);
    
    this.addTravelExperience = this.addTravelExperience.bind(this);
    this.updateTravelExperience = this.updateTravelExperience.bind(this);
    this.deleteTravelExperience = this.deleteTravelExperience.bind(this);
    
    // Budget management
    this.updateBudget = this.updateBudget.bind(this);
    this.getBudgetBreakdown = this.getBudgetBreakdown.bind(this);
    this.getSpendingByCategory = this.getSpendingByCategory.bind(this);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Check if user has permission for travel plan operations
   */
  async checkPermission(userId, planId, requiredPermission) {
    try {
      // SuperAdmin always has access
      if (this.req?.user?.isSuperAdmin) return true;

      switch (requiredPermission) {
        case "edit":
          return await openfgaService.canEditTravelPlan?.(userId, planId) || false;
        case "view":
          return await openfgaService.canViewTravelPlan?.(userId, planId) || false;
        case "suggest":
          return await openfgaService.canSuggestTravelPlan?.(userId, planId) || false;
        case "share":
          return await openfgaService.canShareTravelPlan?.(userId, planId) || false;
        case "delete":
          return await openfgaService.canDeleteTravelPlan?.(userId, planId) || false;
        default:
          return false;
      }
    } catch (error) {
      console.error("Error checking travel plan permission:", error);
      return false;
    }
  }

/**
 * Calculate total cost of all bookings in a travel plan
 */
async calculateTotalCost(planId) {
  const [accommodations, transportations, packages, experiences] = await Promise.all([
    prisma.accommodationBooking.aggregate({
      where: { travelPlanId: planId },
      _sum: { totalCost: true }
    }),
    prisma.transportationBooking.aggregate({
      where: { travelPlanId: planId },
      _sum: { actualFare: true, estimatedFare: true }
    }),
    prisma.travelPackageBooking.aggregate({
      where: { travelPlanId: planId },
      _sum: { finalAmount: true }
    }),
    // Fix: This should be for vendor experiences (ExperienceBooking)
    prisma.experienceBooking.aggregate({
      where: { travelPlanId: planId },
      _sum: { totalAmount: true }
    })
  ]);

  return {
    accommodations: accommodations._sum.totalCost || 0,
    transportations: transportations._sum.actualFare || transportations._sum.estimatedFare || 0,
    packages: packages._sum.finalAmount || 0,
    experiences: experiences._sum.totalAmount || 0,
    total: (accommodations._sum.totalCost || 0) +
           (transportations._sum.actualFare || transportations._sum.estimatedFare || 0) +
           (packages._sum.finalAmount || 0) +
           (experiences._sum.totalAmount || 0)
  };
}
  // ==================== CORE TRAVEL PLAN METHODS ====================

  /**
   * Create a new travel plan
   * POST /api/travel-plans
   */
  async createTravelPlan(req, res, next) {
    try {
      const planData = req.body;

      // Validate dates
      const startDate = new Date(planData.startDate);
      const endDate = new Date(planData.endDate);
      
      if (endDate <= startDate) {
        return res.status(400).json({
          success: false,
          message: "End date must be after start date"
        });
      }

      const travelPlan = await prisma.travelPlan.create({
        data: {
          ...planData,
          userId: req.user.id
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createTravelPlanRelations(req.user.id, travelPlan.id);

      // Invalidate user's travel plans cache
      await redisService.client?.del(`user:${req.user.id}:travelplans`);

      res.status(201).json({
        success: true,
        data: travelPlan,
        message: "Travel plan created successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all travel plans for current user
   * GET /api/travel-plans
   */
  async getTravelPlans(req, res, next) {
    try {
      const { 
        status, 
        destination, 
        fromDate, 
        toDate,
        page = 1, 
        limit = 10,
        sortBy = 'startDate',
        sortOrder = 'asc'
      } = req.query;

      // Build filter
      const where = { userId: req.user.id };
      if (status) where.status = status;
      if (destination) where.destination = { contains: destination, mode: 'insensitive' };
      if (fromDate) where.startDate = { gte: new Date(fromDate) };
      if (toDate) where.endDate = { lte: new Date(toDate) };

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      const [plans, total] = await Promise.all([
        prisma.travelPlan.findMany({
          where,
          include: {
            _count: {
              select: {
                accommodations: true,
                transportServices: true,
                travelPackageBookings: true,
                experiences: true,
                shoppingVisits: true
              }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy
        }),
        prisma.travelPlan.count({ where })
      ]);

      // Get budget info for each plan
      const plansWithCost = await Promise.all(
        plans.map(async (plan) => {
          const costs = await this.calculateTotalCost(plan.id);
          return {
            ...plan,
            currentSpent: costs.total,
            budgetRemaining: (plan.budget || 0) - costs.total
          };
        })
      );

      // Cache user's travel plans
      await redisService.client?.setex(
        `user:${req.user.id}:travelplans`,
        300,
        JSON.stringify(plansWithCost)
      );

      res.json({
        success: true,
        data: plansWithCost,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      next(error);
    }
  }

/**
 * Get travel plan by ID
 * GET /api/travel-plans/:id
 */
async getTravelPlanById(req, res, next) {
  try {
    const { id } = req.params;

    // Check permission
    const canView = await this.checkPermission(req.user.id, id, 'view');
    if (!canView && !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this travel plan"
      });
    }

    // Try cache first
    const cacheKey = `travelplan:${id}`;
    let cached = await redisService.client?.get(cacheKey);
    if (cached && !req.query.skipCache) {
      return res.json({
        success: true,
        data: JSON.parse(cached),
        cached: true
      });
    }

    const travelPlan = await prisma.travelPlan.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profile: {
              select: {
                profilePicture: true
              }
            }
          }
        },
        accommodations: {
          include: {
            accommodation: true,
            rooms: true
          },
          orderBy: {
            checkInDate: 'asc'
          }
        },
        transportServices: {
          include: {
            provider: true,
            vehicle: true
          },
          orderBy: {
            pickupTime: 'asc'
          }
        },
        travelPackageBookings: {
          include: {
            package: true
          },
          orderBy: {
            startDate: 'asc'
          }
        },
        experiences: {
          // This is for TravelExperience (custom experiences)
          orderBy: {
            date: 'asc'  // Changed from experienceDate to date
          }
        },
        shoppingVisits: {
          include: {
            store: true
          },
          orderBy: {
            plannedDate: 'asc'
          }
        },
        _count: {
          select: {
            accommodations: true,
            transportServices: true,
            travelPackageBookings: true,
            experiences: true,
            shoppingVisits: true
          }
        }
      }
    });

    if (!travelPlan) {
      return res.status(404).json({
        success: false,
        message: "Travel plan not found"
      });
    }

    // Calculate costs
    const costs = await this.calculateTotalCost(id);
    
    const enrichedPlan = {
      ...travelPlan,
      currentSpent: costs.total,
      budgetBreakdown: costs,
      budgetRemaining: (travelPlan.budget || 0) - costs.total,
      isOwner: travelPlan.userId === req.user.id
    };

    // Cache for 10 minutes
    await redisService.client?.setex(cacheKey, 600, JSON.stringify(enrichedPlan));

    res.json({
      success: true,
      data: enrichedPlan
    });
  } catch (error) {
    next(error);
  }
}

  /**
   * Update travel plan
   * PUT /api/travel-plans/:id
   */
  async updateTravelPlan(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this travel plan"
        });
      }

      const updateData = req.body;

      // Validate dates if both are provided
      if (updateData.startDate && updateData.endDate) {
        const startDate = new Date(updateData.startDate);
        const endDate = new Date(updateData.endDate);
        if (endDate <= startDate) {
          return res.status(400).json({
            success: false,
            message: "End date must be after start date"
          });
        }
      }

      const travelPlan = await prisma.travelPlan.update({
        where: { id },
        data: updateData
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`user:${req.user.id}:travelplans`)
      ]);

      res.json({
        success: true,
        data: travelPlan,
        message: "Travel plan updated successfully"
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: "Travel plan not found"
        });
      }
      next(error);
    }
  }

  /**
   * Delete travel plan
   * DELETE /api/travel-plans/:id
   */
  async deleteTravelPlan(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canDelete = await this.checkPermission(req.user.id, id, 'delete');
      if (!canDelete && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this travel plan"
        });
      }

      // Check for active bookings
      const activeBookings = await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            travelPlanId: id,
            bookingStatus: { in: ['CONFIRMED', 'CHECKED_IN'] }
          }
        }),
        prisma.transportationBooking.count({
          where: {
            travelPlanId: id,
            status: { in: ['CONFIRMED', 'ON_THE_WAY'] }
          }
        }),
        prisma.travelPackageBooking.count({
          where: {
            travelPlanId: id,
            status: { in: ['CONFIRMED'] }
          }
        }),
        prisma.experienceBooking.count({
          where: {
            travelPlanId: id,
            status: { in: ['CONFIRMED'] }
          }
        })
      ]);

      const totalActive = activeBookings.reduce((a, b) => a + b, 0);
      
      if (totalActive > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete travel plan with active bookings. Cancel bookings first."
        });
      }

      await prisma.travelPlan.delete({
        where: { id }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`user:${req.user.id}:travelplans`)
      ]);

      res.json({
        success: true,
        message: "Travel plan deleted successfully"
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: "Travel plan not found"
        });
      }
      next(error);
    }
  }

  /**
   * Duplicate a travel plan
   * POST /api/travel-plans/:id/duplicate
   */
  async duplicateTravelPlan(req, res, next) {
    try {
      const { id } = req.params;
      const { title, startDate } = req.body;

      // Check permission to view original
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      // Get original plan
      const original = await prisma.travelPlan.findUnique({
        where: { id }
      });

      if (!original) {
        return res.status(404).json({
          success: false,
          message: "Original travel plan not found"
        });
      }

      // Calculate new dates based on original duration
      const originalStart = new Date(original.startDate);
      const originalEnd = new Date(original.endDate);
      const durationDays = Math.ceil((originalEnd - originalStart) / (1000 * 60 * 60 * 24));

      const newStartDate = startDate ? new Date(startDate) : new Date();
      const newEndDate = new Date(newStartDate);
      newEndDate.setDate(newEndDate.getDate() + durationDays);

      // Create duplicate
      const duplicate = await prisma.travelPlan.create({
        data: {
          title: title || `${original.title} (Copy)`,
          destination: original.destination,
          description: original.description,
          startDate: newStartDate,
          endDate: newEndDate,
          budget: original.budget,
          travelers: original.travelers,
          interests: original.interests,
          userId: req.user.id,
          status: 'PLANNING'
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createTravelPlanRelations(req.user.id, duplicate.id);

      res.status(201).json({
        success: true,
        data: duplicate,
        message: "Travel plan duplicated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHARING METHODS ====================

  /**
   * Share travel plan with another user
   * POST /api/travel-plans/:id/share
   */
  async shareTravelPlan(req, res, next) {
    try {
      const { id } = req.params;
      const { email, permission } = req.body;

      // Check permission to share
      const canShare = await this.checkPermission(req.user.id, id, 'share');
      if (!canShare && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to share this travel plan"
        });
      }

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Check if already shared
      const existing = await openfgaService.checkPermission(
        user.id,
        permission,
        `travelplan:${id}`
      );

      if (existing) {
        return res.status(400).json({
          success: false,
          message: `User already has ${permission} access`
        });
      }

      // Share the plan
      await openfgaService.shareTravelPlan(id, user.id, permission);

      // Create notification (optional)
      // await notificationService.sendShareNotification(user.id, req.user.name, permission);

      res.json({
        success: true,
        message: `Travel plan shared with ${email} as ${permission}`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke access from a user
   * DELETE /api/travel-plans/:id/share/:email
   */
  async revokeAccess(req, res, next) {
    try {
      const { id, email } = req.params;

      // Check permission to share
      const canShare = await this.checkPermission(req.user.id, id, 'share');
      if (!canShare && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to revoke access"
        });
      }

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Get all permissions for this user on this plan
      const permissions = ['viewer', 'editor', 'suggester'];
      
      await Promise.all(
        permissions.map(permission =>
          openfgaService.revokeTravelPlanAccess(id, user.id, permission)
        )
      );

      res.json({
        success: true,
        message: `Access revoked for ${email}`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get users with access to this plan
   * GET /api/travel-plans/:id/shared-users
   */
  async getSharedUsers(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission to view
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      // This would typically query OpenFGA for shared users
      // For now, return a placeholder
      // You'd need to implement readTuples with specific filters

      res.json({
        success: true,
        data: [] // Implement actual user fetching
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ACCOMMODATION BOOKINGS ====================

  /**
   * Add accommodation booking to travel plan
   * POST /api/travel-plans/:id/accommodations
   */
  async addAccommodationBooking(req, res, next) {
    try {
      const { id } = req.params;
      const bookingData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan"
        });
      }

      // Validate dates
      const checkIn = new Date(bookingData.checkInDate);
      const checkOut = new Date(bookingData.checkOutDate);
      
      if (checkOut <= checkIn) {
        return res.status(400).json({
          success: false,
          message: "Check-out date must be after check-in date"
        });
      }

      // Calculate total nights
      const totalNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

      // Verify accommodation exists
      const accommodation = await prisma.accommodation.findUnique({
        where: { id: bookingData.accommodationId }
      });

      if (!accommodation) {
        return res.status(404).json({
          success: false,
          message: "Accommodation not found"
        });
      }

      if (!accommodation.isActive) {
        return res.status(400).json({
          success: false,
          message: "This accommodation is currently unavailable"
        });
      }

      // Create booking
      const booking = await prisma.accommodationBooking.create({
        data: {
          ...bookingData,
          totalNights,
          travelPlanId: id
        },
        include: {
          accommodation: true,
          rooms: true
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createAccommodationBookingRelations(
        req.user.id,
        booking.id,
        id
      );

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`accommodation:${bookingData.accommodationId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Accommodation booking added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update accommodation booking
   * PUT /api/travel-plans/bookings/accommodation/:bookingId
   */
  async updateAccommodationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditAccommodationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking"
        });
      }

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      // Don't allow updates to cancelled or completed bookings
      if (['CANCELLED', 'CHECKED_OUT', 'NO_SHOW'].includes(booking.bookingStatus)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.bookingStatus}`
        });
      }

      const updatedBooking = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: updateData,
        include: {
          accommodation: true,
          rooms: true
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`)
      ]);

      res.json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel accommodation booking
   * DELETE /api/travel-plans/bookings/accommodation/:bookingId
   */
  async cancelAccommodationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelAccommodationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking"
        });
      }

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const cancelledBooking = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: {
          bookingStatus: 'CANCELLED',
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`)
      ]);

      res.json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== TRANSPORTATION BOOKINGS ====================

  /**
   * Add transportation booking to travel plan
   * POST /api/travel-plans/:id/transportation
   */
  async addTransportationBooking(req, res, next) {
    try {
      const { id } = req.params;
      const bookingData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan"
        });
      }

      // Validate times
      const pickupTime = new Date(bookingData.pickupTime);
      const estimatedArrival = bookingData.estimatedArrival ? new Date(bookingData.estimatedArrival) : null;

      if (estimatedArrival && estimatedArrival <= pickupTime) {
        return res.status(400).json({
          success: false,
          message: "Estimated arrival must be after pickup time"
        });
      }

      // Verify provider exists
      if (bookingData.providerId) {
        const provider = await prisma.transportationProvider.findUnique({
          where: { id: bookingData.providerId }
        });

        if (!provider) {
          return res.status(404).json({
            success: false,
            message: "Transportation provider not found"
          });
        }

        if (!provider.isAvailable) {
          return res.status(400).json({
            success: false,
            message: "This provider is currently unavailable"
          });
        }
      }

      const booking = await prisma.transportationBooking.create({
        data: {
          ...bookingData,
          travelPlanId: id
        },
        include: {
          provider: true,
          vehicle: true
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createTransportationBookingRelations(
        req.user.id,
        booking.id,
        id
      );

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`transportationprovider:${bookingData.providerId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Transportation booking added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update transportation booking
   * PUT /api/travel-plans/bookings/transportation/:bookingId
   */
  async updateTransportationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditTransportationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking"
        });
      }

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.status}`
        });
      }

      const updatedBooking = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: updateData,
        include: {
          provider: true,
          vehicle: true
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`transportationprovider:${booking.providerId}`)
      ]);

      res.json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel transportation booking
   * DELETE /api/travel-plans/bookings/transportation/:bookingId
   */
  async cancelTransportationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelTransportationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking"
        });
      }

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const cancelledBooking = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          isPaid: false,
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`transportationprovider:${booking.providerId}`)
      ]);

      res.json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PACKAGE BOOKINGS ====================

  /**
   * Add package booking to travel plan
   * POST /api/travel-plans/:id/packages
   */
  async addPackageBooking(req, res, next) {
    try {
      const { id } = req.params;
      const bookingData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan"
        });
      }

      // Validate dates
      const startDate = new Date(bookingData.startDate);
      const endDate = new Date(bookingData.endDate);
      
      if (endDate <= startDate) {
        return res.status(400).json({
          success: false,
          message: "End date must be after start date"
        });
      }

      // Verify package exists
      const travelPackage = await prisma.travelPackage.findUnique({
        where: { id: bookingData.packageId }
      });

      if (!travelPackage) {
        return res.status(404).json({
          success: false,
          message: "Travel package not found"
        });
      }

      if (!travelPackage.isActive) {
        return res.status(400).json({
          success: false,
          message: "This package is currently unavailable"
        });
      }

      // Calculate final price (apply discount if any)
      const finalAmount = travelPackage.discount 
        ? travelPackage.basePrice - (travelPackage.basePrice * travelPackage.discount / 100)
        : travelPackage.basePrice;

      const booking = await prisma.travelPackageBooking.create({
        data: {
          ...bookingData,
          basePrice: travelPackage.basePrice,
          finalAmount: finalAmount * bookingData.numberOfTravelers,
          travelPlanId: id
        },
        include: {
          package: true
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createTravelPackageBookingRelations(
        req.user.id,
        booking.id,
        id,
        bookingData.packageId
      );

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`travelpackage:${bookingData.packageId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Package booking added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update package booking
   * PUT /api/travel-plans/bookings/package/:bookingId
   */
  async updatePackageBooking(req, res, next) {
    try {
      const { bookingId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditTravelPackageBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking"
        });
      }

      const booking = await prisma.travelPackageBooking.findUnique({
        where: { id: bookingId },
        include: { 
          travelPlan: true,
          package: true
        }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.status}`
        });
      }

      const updatedBooking = await prisma.travelPackageBooking.update({
        where: { id: bookingId },
        data: updateData,
        include: {
          package: true
        }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel package booking
   * DELETE /api/travel-plans/bookings/package/:bookingId
   */
  async cancelPackageBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelTravelPackageBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking"
        });
      }

      const booking = await prisma.travelPackageBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const cancelledBooking = await prisma.travelPackageBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== EXPERIENCE BOOKINGS ====================

  /**
   * Add experience booking to travel plan
   * POST /api/travel-plans/:id/experiences
   */
  async addExperienceBooking(req, res, next) {
    try {
      const { id } = req.params;
      const bookingData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan"
        });
      }

      // Verify experience exists
      const experience = await prisma.vendorExperience.findUnique({
        where: { id: bookingData.experienceId }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: "Experience not found"
        });
      }

      if (!experience.isActive) {
        return res.status(400).json({
          success: false,
          message: "This experience is currently unavailable"
        });
      }

      // Calculate total amount
      const totalAmount = (bookingData.numberOfParticipants * experience.pricePerPerson) +
                         (bookingData.numberOfChildren * (experience.childPrice || 0));

      const booking = await prisma.experienceBooking.create({
        data: {
          ...bookingData,
          unitPrice: experience.pricePerPerson,
          childPrice: experience.childPrice,
          totalAmount,
          travelPlanId: id
        },
        include: {
          experience: true
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createExperienceBookingRelations(
        req.user.id,
        booking.id,
        id,
        bookingData.experienceId
      );

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`vendorexperience:${bookingData.experienceId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Experience booking added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update experience booking
   * PUT /api/travel-plans/bookings/experience/:bookingId
   */
  async updateExperienceBooking(req, res, next) {
    try {
      const { bookingId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditExperienceBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking"
        });
      }

      const booking = await prisma.experienceBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.status}`
        });
      }

      const updatedBooking = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: updateData,
        include: {
          experience: true
        }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel experience booking
   * DELETE /api/travel-plans/bookings/experience/:bookingId
   */
  async cancelExperienceBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelExperienceBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking"
        });
      }

      const booking = await prisma.experienceBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const cancelledBooking = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHOPPING VISITS ====================

  /**
   * Add shopping visit to travel plan
   * POST /api/travel-plans/:id/shopping
   */
  async addShoppingVisit(req, res, next) {
    try {
      const { id } = req.params;
      const visitData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add shopping visits to this travel plan"
        });
      }

      // Verify store exists
      const store = await prisma.retailStore.findUnique({
        where: { id: visitData.storeId }
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found"
        });
      }

      if (!store.isActive) {
        return res.status(400).json({
          success: false,
          message: "This store is currently closed"
        });
      }

      const visit = await prisma.shoppingVisit.create({
        data: {
          ...visitData,
          travelPlanId: id
        },
        include: {
          store: true
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createShoppingVisitRelations(
        req.user.id,
        visit.id,
        id
      );

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`retailstore:${visitData.storeId}`)
      ]);

      res.status(201).json({
        success: true,
        data: visit,
        message: "Shopping visit added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update shopping visit
   * PUT /api/travel-plans/shopping/:visitId
   */
  async updateShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditShoppingVisit?.(
        req.user.id,
        visitId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this shopping visit"
        });
      }

      const visit = await prisma.shoppingVisit.findUnique({
        where: { id: visitId },
        include: { travelPlan: true }
      });

      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Shopping visit not found"
        });
      }

      if (visit.status === 'VISITED' || visit.status === 'CANCELLED') {
        return res.status(400).json({
          success: false,
          message: `Cannot update visit with status: ${visit.status}`
        });
      }

      const updatedVisit = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data: updateData,
        include: {
          store: true
        }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${visit.travelPlanId}`);

      res.json({
        success: true,
        data: updatedVisit,
        message: "Shopping visit updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel shopping visit
   * DELETE /api/travel-plans/shopping/:visitId
   */
  async cancelShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelShoppingVisit?.(
        req.user.id,
        visitId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this shopping visit"
        });
      }

      const visit = await prisma.shoppingVisit.findUnique({
        where: { id: visitId },
        include: { travelPlan: true }
      });

      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Shopping visit not found"
        });
      }

      const cancelledVisit = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data: { status: 'CANCELLED' }
      });

      // Invalidate caches
      await redisService.client?.del(`travelplan:${visit.travelPlanId}`);

      res.json({
        success: true,
        data: cancelledVisit,
        message: "Shopping visit cancelled successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== TRAVEL EXPERIENCES (Custom) ====================

  /**
   * Add custom travel experience
   * POST /api/travel-plans/:id/experiences/custom
   */
  async addTravelExperience(req, res, next) {
    try {
      const { id } = req.params;
      const experienceData = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add experiences to this travel plan"
        });
      }

      const experience = await prisma.travelExperience.create({
        data: {
          ...experienceData,
          travelPlanId: id
        }
      });

      // Set up OpenFGA relations
      await openfgaService.createTravelExperienceRelations(
        req.user.id,
        experience.id,
        id
      );

      // Invalidate cache
      await redisService.client?.del(`travelplan:${id}`);

      res.status(201).json({
        success: true,
        data: experience,
        message: "Travel experience added successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update custom travel experience
   * PUT /api/travel-plans/experiences/custom/:experienceId
   */
  async updateTravelExperience(req, res, next) {
    try {
      const { experienceId } = req.params;
      const updateData = req.body;

      // Check permission
      const canEdit = await openfgaService.canEditTravelExperience?.(
        req.user.id,
        experienceId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this experience"
        });
      }

      const experience = await prisma.travelExperience.findUnique({
        where: { id: experienceId },
        include: { travelPlan: true }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: "Experience not found"
        });
      }

      const updatedExperience = await prisma.travelExperience.update({
        where: { id: experienceId },
        data: updateData
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${experience.travelPlanId}`);

      res.json({
        success: true,
        data: updatedExperience,
        message: "Experience updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete custom travel experience
   * DELETE /api/travel-plans/experiences/custom/:experienceId
   */
  async deleteTravelExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      // Check permission
      const canDelete = await openfgaService.canDeleteTravelExperience?.(
        req.user.id,
        experienceId
      ) || false;

      if (!canDelete && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this experience"
        });
      }

      const experience = await prisma.travelExperience.findUnique({
        where: { id: experienceId },
        include: { travelPlan: true }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: "Experience not found"
        });
      }

      await prisma.travelExperience.delete({
        where: { id: experienceId }
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${experience.travelPlanId}`);

      res.json({
        success: true,
        message: "Experience deleted successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== BUDGET MANAGEMENT ====================

  /**
   * Update travel plan budget
   * PATCH /api/travel-plans/:id/budget
   */
  async updateBudget(req, res, next) {
    try {
      const { id } = req.params;
      const { budget } = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this travel plan"
        });
      }

      const travelPlan = await prisma.travelPlan.update({
        where: { id },
        data: { budget }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${id}`),
        redisService.client?.del(`user:${req.user.id}:travelplans`)
      ]);

      res.json({
        success: true,
        data: travelPlan,
        message: "Budget updated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get budget breakdown
   * GET /api/travel-plans/:id/budget/breakdown
   */
  async getBudgetBreakdown(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      const costs = await this.calculateTotalCost(id);
      
      const travelPlan = await prisma.travelPlan.findUnique({
        where: { id },
        select: { budget: true }
      });

      res.json({
        success: true,
        data: {
          budget: travelPlan?.budget || 0,
          spent: costs.total,
          remaining: (travelPlan?.budget || 0) - costs.total,
          breakdown: costs,
          percentageUsed: travelPlan?.budget ? (costs.total / travelPlan.budget) * 100 : 0
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get spending by category
   * GET /api/travel-plans/:id/budget/by-category
   */
  async getSpendingByCategory(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      const [accommodations, transportations, packages, experiences] = await Promise.all([
        prisma.accommodationBooking.groupBy({
          by: ['accommodationId'],
          where: { travelPlanId: id },
          _sum: { totalCost: true }
        }),
        prisma.transportationBooking.groupBy({
          by: ['serviceType'],
          where: { travelPlanId: id },
          _sum: { actualFare: true, estimatedFare: true }
        }),
        prisma.travelPackageBooking.aggregate({
          where: { travelPlanId: id },
          _sum: { finalAmount: true }
        }),
        prisma.experienceBooking.aggregate({
          where: { travelPlanId: id },
          _sum: { totalAmount: true }
        })
      ]);

      res.json({
        success: true,
        data: {
          accommodations: accommodations.reduce((sum, item) => sum + (item._sum.totalCost || 0), 0),
          transportations: {
            total: transportations.reduce((sum, item) => sum + (item._sum.actualFare || item._sum.estimatedFare || 0), 0),
            byType: transportations
          },
          packages: packages._sum.finalAmount || 0,
          experiences: experiences._sum.totalAmount || 0
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== AI FEATURES ====================

  /**
   * Generate AI itinerary
   * POST /api/travel-plans/:id/generate-itinerary
   */
  async generateItinerary(req, res, next) {
    try {
      const { id } = req.params;
      const { preferences } = req.body;

      // Check permission
      const canEdit = await this.checkPermission(req.user.id, id, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to modify this travel plan"
        });
      }

      const travelPlan = await prisma.travelPlan.findUnique({
        where: { id },
        include: {
          accommodations: {
            include: { accommodation: true }
          },
          transportServices: {
            include: { provider: true }
          },
          experiences: true,
          shoppingVisits: {
            include: { store: true }
          }
        }
      });

      // This would integrate with an AI service
      // For now, return a placeholder
      const itinerary = {
        days: [],
        recommendations: [],
        tips: []
      };

      // Update the travel plan with generated itinerary
      await prisma.travelPlan.update({
        where: { id },
        data: {
          itinerary: itinerary,
          recommendations: req.body.recommendations
        }
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${id}`);

      res.json({
        success: true,
        data: itinerary,
        message: "Itinerary generated successfully"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get AI recommendations
   * GET /api/travel-plans/:id/recommendations
   */
  async getRecommendations(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      const travelPlan = await prisma.travelPlan.findUnique({
        where: { id },
        select: {
          destination: true,
          startDate: true,
          endDate: true,
          travelers: true,
          interests: true,
          recommendations: true
        }
      });

      // This would integrate with an AI service
      // For now, return stored recommendations
      res.json({
        success: true,
        data: travelPlan?.recommendations || {}
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== STATISTICS ====================

  /**
   * Get travel plan statistics
   * GET /api/travel-plans/:id/stats
   */
  async getTravelPlanStats(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this travel plan"
        });
      }

      const [
        totalBookings,
        confirmedBookings,
        pendingBookings,
        cancelledBookings,
        totalSpent,
        upcomingActivities
      ] = await Promise.all([
        // Total bookings count
        prisma.$transaction([
          prisma.accommodationBooking.count({ where: { travelPlanId: id } }),
          prisma.transportationBooking.count({ where: { travelPlanId: id } }),
          prisma.travelPackageBooking.count({ where: { travelPlanId: id } }),
          prisma.experienceBooking.count({ where: { travelPlanId: id } }),
          prisma.shoppingVisit.count({ where: { travelPlanId: id } })
        ]).then(results => results.reduce((a, b) => a + b, 0)),

        // Confirmed bookings
        prisma.$transaction([
          prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: 'CONFIRMED' } }),
          prisma.transportationBooking.count({ where: { travelPlanId: id, status: 'CONFIRMED' } }),
          prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: 'CONFIRMED' } }),
          prisma.experienceBooking.count({ where: { travelPlanId: id, status: 'CONFIRMED' } })
        ]).then(results => results.reduce((a, b) => a + b, 0)),

        // Pending bookings
        prisma.$transaction([
          prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: 'PENDING' } }),
          prisma.transportationBooking.count({ where: { travelPlanId: id, status: 'BOOKED' } }),
          prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: 'PENDING' } }),
          prisma.experienceBooking.count({ where: { travelPlanId: id, status: 'PENDING' } })
        ]).then(results => results.reduce((a, b) => a + b, 0)),

        // Cancelled bookings
        prisma.$transaction([
          prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: 'CANCELLED' } }),
          prisma.transportationBooking.count({ where: { travelPlanId: id, status: 'CANCELLED' } }),
          prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: 'CANCELLED' } }),
          prisma.experienceBooking.count({ where: { travelPlanId: id, status: 'CANCELLED' } }),
          prisma.shoppingVisit.count({ where: { travelPlanId: id, status: 'CANCELLED' } })
        ]).then(results => results.reduce((a, b) => a + b, 0)),

        // Total spent
        this.calculateTotalCost(id).then(costs => costs.total),

        // Upcoming activities
        prisma.$transaction([
          prisma.accommodationBooking.count({ where: { travelPlanId: id, checkInDate: { gt: new Date() } } }),
          prisma.transportationBooking.count({ where: { travelPlanId: id, pickupTime: { gt: new Date() } } }),
          prisma.travelPackageBooking.count({ where: { travelPlanId: id, startDate: { gt: new Date() } } }),
          prisma.experienceBooking.count({ where: { travelPlanId: id, experienceDate: { gt: new Date() } } }),
          prisma.shoppingVisit.count({ where: { travelPlanId: id, plannedDate: { gt: new Date() } } })
        ]).then(results => results.reduce((a, b) => a + b, 0))
      ]);

      res.json({
        success: true,
        data: {
          totalBookings,
          confirmedBookings,
          pendingBookings,
          cancelledBookings,
          totalSpent,
          upcomingActivities,
          completionRate: totalBookings > 0 ? (confirmedBookings / totalBookings) * 100 : 0
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Export travel plan (PDF/JSON)
   * GET /api/travel-plans/:id/export
   */
  async exportTravelPlan(req, res, next) {
    try {
      const { id } = req.params;
      const { format = 'json' } = req.query;

      // Check permission
      const canView = await this.checkPermission(req.user.id, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to export this travel plan"
        });
      }

      const travelPlan = await prisma.travelPlan.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          },
          accommodations: {
            include: {
              accommodation: true
            }
          },
          transportServices: {
            include: {
              provider: true
            }
          },
          travelPackageBookings: {
            include: {
              package: true
            }
          },
          experiences: true,
          shoppingVisits: {
            include: {
              store: true
            }
          }
        }
      });

      if (!travelPlan) {
        return res.status(404).json({
          success: false,
          message: "Travel plan not found"
        });
      }

      const costs = await this.calculateTotalCost(id);

      const exportData = {
        metadata: {
          exportedAt: new Date().toISOString(),
          version: '1.0'
        },
        travelPlan: {
          ...travelPlan,
          currentSpent: costs.total,
          budgetBreakdown: costs
        }
      };

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=travel-plan-${id}.json`);
        return res.json(exportData);
      } else if (format === 'pdf') {
        // Implement PDF generation
        res.status(400).json({
          success: false,
          message: "PDF export not implemented yet"
        });
      }
    } catch (error) {
      next(error);
    }
  }

  // ==================== FAVORITES ====================

  /**
   * Add travel plan to favorites
   * POST /api/travel-plans/:id/favorite
   */
  async addToFavorites(req, res, next) {
    try {
      const { id } = req.params;

      // Check if user owns the plan
      const travelPlan = await prisma.travelPlan.findUnique({
        where: { id }
      });

      if (!travelPlan) {
        return res.status(404).json({
          success: false,
          message: "Travel plan not found"
        });
      }

      // This would require a UserFavorites model
      // For now, return success
      
      res.json({
        success: true,
        message: "Added to favorites"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove travel plan from favorites
   * DELETE /api/travel-plans/:id/favorite
   */
  async removeFromFavorites(req, res, next) {
    try {
      const { id } = req.params;

      res.json({
        success: true,
        message: "Removed from favorites"
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's favorite travel plans
   * GET /api/travel-plans/favorites
   */
  async getFavorites(req, res, next) {
    try {
      res.json({
        success: true,
        data: []
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TravelPlanController();