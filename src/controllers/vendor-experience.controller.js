const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class VendorExperienceController {
  constructor() {
    // Bind methods
    this.createExperience = this.createExperience.bind(this);
    this.getMyExperiences = this.getMyExperiences.bind(this);
    this.getExperienceById = this.getExperienceById.bind(this);
    this.updateExperience = this.updateExperience.bind(this);
    this.deleteExperience = this.deleteExperience.bind(this);
    this.getExperiencesByCity = this.getExperiencesByCity.bind(this);
    this.searchExperiences = this.searchExperiences.bind(this);
    this.checkAvailability = this.checkAvailability.bind(this);
    this.getExperienceStats = this.getExperienceStats.bind(this);
  }

  /**
   * Check if user can manage vendor experiences
   */
  async canManageExperience(user, experienceId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      if (!experienceId) {
        // Creating new experience - check if user is a vendor with experience permission
        const vendor = await prisma.vendor.findUnique({
          where: { userId: user?.id },
          select: { id: true, verificationStatus: true, isActive: true }
        });

        if (!vendor) return false;
        if (vendor.verificationStatus !== 'VERIFIED') return false;
        if (!vendor.isActive) return false;

        // Check OpenFGA permission
        const canSellExperiences = await openfgaService.checkPermission?.(
          user?.id,
          "can_sell_experiences",
          `vendor:${vendor.id}`
        ) || false;

        return canSellExperiences;
      }

      // For existing experiences
      const experience = await prisma.vendorExperience.findUnique({
        where: { id: experienceId },
        select: { vendorId: true }
      });

      if (!experience) return false;

      // Check if user owns this experience
      const vendor = await prisma.vendor.findUnique({
        where: { userId: user?.id }
      });

      if (vendor && experience.vendorId === vendor.id) {
        return true;
      }

      // Check OpenFGA permissions
      switch (action) {
        case "delete":
          return await openfgaService.canDeleteVendorExperience?.(user?.id, experienceId) || false;
        case "update":
          return await openfgaService.canUpdateVendorExperience?.(user?.id, experienceId) || false;
        case "edit":
          return await openfgaService.canEditVendorExperience?.(user?.id, experienceId) || false;
        case "view":
          return await openfgaService.canViewVendorExperience?.(user?.id, experienceId) || false;
        default:
          return false;
      }
    } catch (error) {
      console.error("Error in canManageExperience:", error);
      return false;
    }
  }

  /**
   * Create a new vendor experience
   * POST /api/vendor/experiences
   */
  async createExperience(req, res, next) {
    try {
      const canManage = await this.canManageExperience(req.user);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'Only approved vendors with experience permissions can create experiences'
        });
      }

      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id }
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      const experienceData = {
        ...req.body,
        vendorId: vendor.id
      };

      const experience = await prisma.vendorExperience.create({
        data: experienceData
      });

      // Set up OpenFGA relations
      if (openfgaService.createVendorExperienceRelations) {
        await openfgaService.createVendorExperienceRelations(req.user.id, experience.id);
      }

      res.status(201).json({
        success: true,
        data: experience,
        message: 'Experience created successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor's own experiences
   * GET /api/vendor/experiences
   */
  async getMyExperiences(req, res, next) {
    try {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id }
      });

      if (!vendor) {
        return res.json({ success: true, data: [] });
      }

      const experiences = await prisma.vendorExperience.findMany({
        where: { vendorId: vendor.id },
        include: {
          _count: {
            select: { bookings: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        data: experiences
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get experience by ID (public)
   * GET /api/experiences/:experienceId
   */
  async getExperienceById(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.vendorExperience.findUnique({
        where: { id: experienceId },
        include: {
          vendor: {
            select: {
              businessName: true,
              overallRating: true,
              isVerified: true
            }
          },
          reviews: {
            take: 10,
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

      if (!experience.isActive && !req.user?.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'This experience is currently unavailable'
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
   * Update experience
   * PUT /api/vendor/experiences/:experienceId
   */
  async updateExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const canManage = await this.canManageExperience(req.user, experienceId, 'update');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own experiences'
        });
      }

      const experience = await prisma.vendorExperience.update({
        where: { id: experienceId },
        data: req.body
      });

      res.json({
        success: true,
        data: experience,
        message: 'Experience updated successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }
      next(error);
    }
  }

  /**
   * Delete experience
   * DELETE /api/vendor/experiences/:experienceId
   */
  async deleteExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const canManage = await this.canManageExperience(req.user, experienceId, 'delete');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own experiences'
        });
      }

      // Check for future bookings
      const futureBookings = await prisma.experienceBooking.count({
        where: {
          experienceId,
          experienceDate: { gt: new Date() },
          status: { in: ['PENDING', 'CONFIRMED'] }
        }
      });

      if (futureBookings > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete experience with future bookings. Deactivate it instead.'
        });
      }

      await prisma.vendorExperience.delete({
        where: { id: experienceId }
      });

      res.json({
        success: true,
        message: 'Experience deleted successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }
      next(error);
    }
  }

  /**
   * Search experiences (public)
   * GET /api/experiences/search
   */
  async searchExperiences(req, res, next) {
    try {
      const {
        city,
        category,
        date,
        minPrice,
        maxPrice,
        page = 1,
        limit = 20
      } = req.query;

      const where = {
        isActive: true
      };

      if (city) where.city = { contains: city, mode: 'insensitive' };
      if (category) where.category = category;
      if (minPrice) where.pricePerPerson = { gte: parseFloat(minPrice) };
      if (maxPrice) where.pricePerPerson = { ...where.pricePerPerson, lte: parseFloat(maxPrice) };

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [experiences, total] = await Promise.all([
        prisma.vendorExperience.findMany({
          where,
          include: {
            vendor: {
              select: {
                businessName: true,
                overallRating: true
              }
            },
            _count: {
              select: { reviews: true }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy: { createdAt: 'desc' }
        }),
        prisma.vendorExperience.count({ where })
      ]);

      res.json({
        success: true,
        data: experiences,
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
   * Get experiences by city (public)
   * GET /api/experiences/city/:city
   */
  async getExperiencesByCity(req, res, next) {
    try {
      const { city } = req.params;

      const experiences = await prisma.vendorExperience.findMany({
        where: {
          city: { contains: city, mode: 'insensitive' },
          isActive: true
        },
        include: {
          vendor: {
            select: {
              businessName: true,
              overallRating: true
            }
          }
        },
        orderBy: { rating: 'desc' }
      });

      res.json({
        success: true,
        data: experiences
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check availability for a date
   * GET /api/experiences/:experienceId/availability
   */
  async checkAvailability(req, res, next) {
    try {
      const { experienceId } = req.params;
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({
          success: false,
          message: 'Date is required'
        });
      }

      const checkDate = new Date(date);

      const experience = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          message: 'Experience not found'
        });
      }

      // Check if date is available (not in blackout dates)
      const blackoutDates = experience.blackoutDates ? JSON.parse(experience.blackoutDates) : {};
      const dateString = checkDate.toISOString().split('T')[0];
      
      if (blackoutDates[dateString]) {
        return res.json({
          success: true,
          data: {
            available: false,
            reason: 'Blackout date'
          }
        });
      }

      // Check existing bookings
      const existingBookings = await prisma.experienceBooking.count({
        where: {
          experienceId,
          experienceDate: checkDate,
          status: { in: ['PENDING', 'CONFIRMED'] }
        }
      });

      const available = existingBookings < experience.maxParticipants;

      res.json({
        success: true,
        data: {
          available,
          remainingSpots: experience.maxParticipants - existingBookings,
          totalSpots: experience.maxParticipants
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get experience statistics (vendor only)
   * GET /api/vendor/experiences/:experienceId/stats
   */
  async getExperienceStats(req, res, next) {
    try {
      const { experienceId } = req.params;

      const canView = await this.canManageExperience(req.user, experienceId, 'view');
      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'You can only view stats for your own experiences'
        });
      }

      const [totalBookings, completedBookings, cancelledBookings, revenue] = await Promise.all([
        prisma.experienceBooking.count({ where: { experienceId } }),
        prisma.experienceBooking.count({ where: { experienceId, status: 'COMPLETED' } }),
        prisma.experienceBooking.count({ where: { experienceId, status: 'CANCELLED' } }),
        prisma.experienceBooking.aggregate({
          where: { experienceId, status: 'COMPLETED' },
          _sum: { totalAmount: true }
        })
      ]);

      // Get monthly bookings
      const monthlyBookings = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', experience_date) as month,
          COUNT(*) as count
        FROM experience_bookings
        WHERE experience_id = ${experienceId}
        GROUP BY DATE_TRUNC('month', experience_date)
        ORDER BY month DESC
        LIMIT 6
      `;

      res.json({
        success: true,
        data: {
          totalBookings,
          completedBookings,
          cancelledBookings,
          totalRevenue: revenue._sum.totalAmount || 0,
          monthlyBookings
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new VendorExperienceController();