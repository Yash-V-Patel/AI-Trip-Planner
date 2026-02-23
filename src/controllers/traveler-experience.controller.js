const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class TravelerExperienceController {
  constructor() {
    // Bind methods
    this.addCustomExperience = this.addCustomExperience.bind(this);
    this.bookVendorExperience = this.bookVendorExperience.bind(this);
    this.getTravelPlanExperiences = this.getTravelPlanExperiences.bind(this);
    this.updateCustomExperience = this.updateCustomExperience.bind(this);
    this.deleteCustomExperience = this.deleteCustomExperience.bind(this);
    this.updateBooking = this.updateBooking.bind(this);
    this.cancelBooking = this.cancelBooking.bind(this);
    this.getExperienceDetails = this.getExperienceDetails.bind(this);
    this.addExperienceReview = this.addExperienceReview.bind(this);
  }

  /**
   * Check if user has permission for travel plan
   */
  async checkTravelPlanPermission(userId, travelPlanId, requiredPermission = 'edit') {
    try {
      if (requiredPermission === 'edit') {
        return await openfgaService.canEditTravelPlan?.(userId, travelPlanId) || false;
      }
      return await openfgaService.canViewTravelPlan?.(userId, travelPlanId) || false;
    } catch (error) {
      console.error("Error checking travel plan permission:", error);
      return false;
    }
  }

  /**
   * Add a custom experience to travel plan (any user can do this)
   * POST /api/travel-plans/:travelPlanId/experiences/custom
   */
  async addCustomExperience(req, res, next) {
    try {
      const { travelPlanId } = req.params;

      // Check if user has permission to edit this travel plan
      const canEdit = await this.checkTravelPlanPermission(req.user.id, travelPlanId, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to add experiences to this travel plan'
        });
      }

      const experience = await prisma.travelExperience.create({
        data: {
          ...req.body,
          travelPlanId
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createTravelExperienceRelations) {
        await openfgaService.createTravelExperienceRelations(
          req.user.id,
          experience.id,
          travelPlanId
        );
      }

      // Invalidate cache
      await redisService.client?.del(`travelplan:${travelPlanId}`);

      res.status(201).json({
        success: true,
        data: experience,
        message: 'Custom experience added successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Book a vendor experience (any user can book)
   * POST /api/travel-plans/:travelPlanId/experiences/book
   */
  async bookVendorExperience(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const bookingData = req.body;

      // Check if user has permission to edit this travel plan
      const canEdit = await this.checkTravelPlanPermission(req.user.id, travelPlanId, 'edit');
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to add bookings to this travel plan'
        });
      }

      // Verify experience exists and is active
      const experience = await prisma.vendorExperience.findUnique({
        where: { id: bookingData.experienceId }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }

      if (!experience.isActive) {
        return res.status(400).json({
          success: false,
          message: 'This experience is currently unavailable'
        });
      }

      // Check availability
      const existingBookings = await prisma.experienceBooking.count({
        where: {
          experienceId: bookingData.experienceId,
          experienceDate: new Date(bookingData.experienceDate),
          status: { in: ['PENDING', 'CONFIRMED'] }
        }
      });

      if (existingBookings >= experience.maxParticipants) {
        return res.status(400).json({
          success: false,
          message: 'No spots available for this date'
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
          travelPlanId
        },
        include: {
          experience: true
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createExperienceBookingRelations) {
        await openfgaService.createExperienceBookingRelations(
          req.user.id,
          booking.id,
          travelPlanId,
          bookingData.experienceId
        );
      }

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${travelPlanId}`),
        redisService.client?.del(`experience:${bookingData.experienceId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: 'Experience booked successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all experiences for a travel plan
   * GET /api/travel-plans/:travelPlanId/experiences
   */
  async getTravelPlanExperiences(req, res, next) {
    try {
      const { travelPlanId } = req.params;

      // Check if user can view this travel plan
      const canView = await this.checkTravelPlanPermission(req.user.id, travelPlanId, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view these experiences'
        });
      }

      const [customExperiences, vendorBookings] = await Promise.all([
        // Custom experiences from TravelExperience model
        prisma.travelExperience.findMany({
          where: { travelPlanId },
          orderBy: { date: 'asc' }
        }),
        // Vendor experience bookings
        prisma.experienceBooking.findMany({
          where: { travelPlanId },
          include: {
            experience: {
              include: {
                vendor: {
                  select: {
                    businessName: true
                  }
                }
              }
            }
          },
          orderBy: { experienceDate: 'asc' }
        })
      ]);

      res.json({
        success: true,
        data: {
          custom: customExperiences,
          booked: vendorBookings
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update custom experience
   * PUT /api/travel-plans/experiences/custom/:experienceId
   */
  async updateCustomExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      // Check permission via OpenFGA
      const canEdit = await openfgaService.canEditTravelExperience?.(
        req.user.id,
        experienceId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this experience'
        });
      }

      const experience = await prisma.travelExperience.findUnique({
        where: { id: experienceId },
        include: { travelPlan: true }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }

      const updated = await prisma.travelExperience.update({
        where: { id: experienceId },
        data: req.body
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${experience.travelPlanId}`);

      res.json({
        success: true,
        data: updated,
        message: 'Experience updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete custom experience
   * DELETE /api/travel-plans/experiences/custom/:experienceId
   */
  async deleteCustomExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      // Check permission via OpenFGA
      const canDelete = await openfgaService.canDeleteTravelExperience?.(
        req.user.id,
        experienceId
      ) || false;

      if (!canDelete && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this experience'
        });
      }

      const experience = await prisma.travelExperience.findUnique({
        where: { id: experienceId },
        include: { travelPlan: true }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }

      await prisma.travelExperience.delete({
        where: { id: experienceId }
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${experience.travelPlanId}`);

      res.json({
        success: true,
        message: 'Experience deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update vendor experience booking
   * PUT /api/travel-plans/experiences/booking/:bookingId
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission via OpenFGA
      const canEdit = await openfgaService.canEditExperienceBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this booking'
        });
      }

      const booking = await prisma.experienceBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.status}`
        });
      }

      const updated = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: req.body,
        include: {
          experience: true
        }
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: updated,
        message: 'Booking updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel vendor experience booking
   * DELETE /api/travel-plans/experiences/booking/:bookingId
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission via OpenFGA
      const canCancel = await openfgaService.canCancelExperienceBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to cancel this booking'
        });
      }

      const booking = await prisma.experienceBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      const cancelled = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate cache
      await redisService.client?.del(`travelplan:${booking.travelPlanId}`);

      res.json({
        success: true,
        data: cancelled,
        message: 'Booking cancelled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get experience details (public)
   * GET /api/experiences/vendor/:experienceId
   */
  async getExperienceDetails(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.vendorExperience.findUnique({
        where: { id: experienceId },
        include: {
          vendor: {
            select: {
              businessName: true,
              overallRating: true,
              totalReviews: true
            }
          },
          reviews: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  name: true,
                  profile: { select: { profilePicture: true } }
                }
              }
            }
          }
        }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }

      res.json({
        success: true,
        data: experience
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add a review for a booked experience
   * POST /api/experiences/booking/:bookingId/review
   */
  async addExperienceReview(req, res, next) {
    try {
      const { bookingId } = req.params;
      const { rating, comment } = req.body;

      const booking = await prisma.experienceBooking.findUnique({
        where: { id: bookingId },
        include: {
          experience: true,
          travelPlan: true
        }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Check if user owns this booking
      if (booking.travelPlan.userId !== req.user.id && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You can only review your own bookings'
        });
      }

      // Check if booking is completed
      if (booking.status !== 'COMPLETED') {
        return res.status(400).json({
          success: false,
          message: 'You can only review completed experiences'
        });
      }

      // Create review
      const review = await prisma.vendorReview.create({
        data: {
          vendorId: booking.experience.vendorId,
          userId: req.user.id,
          rating,
          comment,
          bookingType: 'EXPERIENCE',
          bookingId: booking.id,
          isVerifiedPurchase: true
        }
      });

      // Update vendor rating
      const vendorReviews = await prisma.vendorReview.aggregate({
        where: { vendorId: booking.experience.vendorId },
        _avg: { rating: true },
        _count: true
      });

      await prisma.vendor.update({
        where: { id: booking.experience.vendorId },
        data: {
          overallRating: vendorReviews._avg.rating || 0,
          totalReviews: vendorReviews._count
        }
      });

      res.json({
        success: true,
        data: review,
        message: 'Review added successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TravelerExperienceController();