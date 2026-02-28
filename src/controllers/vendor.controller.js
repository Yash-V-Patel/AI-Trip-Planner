const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class VendorController {
  constructor() {
    // Bind all methods
    this.registerVendor = this.registerVendor.bind(this);
    this.getVendorProfile = this.getVendorProfile.bind(this);
    this.updateVendorProfile = this.updateVendorProfile.bind(this);
    this.uploadDocument = this.uploadDocument.bind(this);
    this.getDocuments = this.getDocuments.bind(this);
    this.deleteDocument = this.deleteDocument.bind(this);
    this.getDashboard = this.getDashboard.bind(this);
    this.getAnalytics = this.getAnalytics.bind(this);
    this.getTransactions = this.getTransactions.bind(this);
    this.requestPayout = this.requestPayout.bind(this);
    this.getPayouts = this.getPayouts.bind(this);
    this.getReviews = this.getReviews.bind(this);
    this.replyToReview = this.replyToReview.bind(this);

    // Team Management
    this.getTeamMembers = this.getTeamMembers.bind(this);
    this.addTeamMember = this.addTeamMember.bind(this);
    this.updateTeamMember = this.updateTeamMember.bind(this);
    this.removeTeamMember = this.removeTeamMember.bind(this);

    // Admin Methods
    this.getAllVendors = this.getAllVendors.bind(this);
    this.getVendorById = this.getVendorById.bind(this);
    this.verifyVendor = this.verifyVendor.bind(this);
    this.suspendVendor = this.suspendVendor.bind(this);
    this.activateVendor = this.activateVendor.bind(this);
    this.getPendingVerifications = this.getPendingVerifications.bind(this);
    // this.approveVendorType = this.approveVendorType.bind(this);
    this.updateCommission = this.updateCommission.bind(this);
    this.processPayout = this.processPayout.bind(this);
  }

  // ==================== VENDOR REGISTRATION ====================

  /**
   * Register as a vendor
   * POST /api/vendor/register
   */
  async registerVendor(req, res, next) {
    try {
      const userId = req.user.id;
      const vendorData = req.body;

      // Check if already a vendor
      const existingVendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (existingVendor) {
        return res.status(400).json({
          success: false,
          message: "You are already registered as a vendor",
        });
      }

      // Check for pending application
      const existingApplication = await prisma.vendorApplication.findUnique({
        where: { userId },
      });

      if (existingApplication && existingApplication.status === "PENDING") {
        return res.status(400).json({
          success: false,
          message: "You already have a pending application",
        });
      }

      // Create vendor profile
      const vendor = await prisma.vendor.create({
        data: {
          userId,
          businessName: vendorData.businessName,
          businessRegNumber: vendorData.businessRegNumber,
          taxId: vendorData.taxId,
          vendorType: vendorData.vendorType || [],
          businessAddress: vendorData.businessAddress,
          businessPhone: vendorData.businessPhone,
          businessEmail: vendorData.businessEmail,
          website: vendorData.website,
          description: vendorData.description,
          logo: vendorData.logo,
          coverImage: vendorData.coverImage,
          verificationStatus: "PENDING",
        },
      });

      // Create application record
      await prisma.vendorApplication.create({
        data: {
          userId,
          businessName: vendorData.businessName,
          businessAddress: vendorData.businessAddress,
          businessPhone: vendorData.businessPhone,
          businessEmail: vendorData.businessEmail,
          taxId: vendorData.taxId,
          vendorTypes: vendorData.vendorType || [],
          documents: vendorData.documents || [],
          additionalInfo: vendorData.additionalInfo,
          status: "PENDING",
        },
      });

      // Set up OpenFGA base vendor relations
      await openfgaService.writeTuples([
        {
          user: `user:${userId}`,
          relation: "is_vendor",
          object: `vendor:${vendor.id}`,
        },
      ]);

      res.status(201).json({
        success: true,
        data: vendor,
        message: "Vendor registration submitted for verification",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor profile
   * GET /api/vendor/profile
   */
  async getVendorProfile(req, res, next) {
    try {
      const userId = req.user.id;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        include: {
          documents: {
            select: {
              id: true,
              documentType: true,
              documentUrl: true,
              isVerified: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              accommodations: true,
              transportationProviders: true,
              travelPackages: true,
              experiences: true,
              teamMembers: true,
            },
          },
        },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      res.json({
        success: true,
        data: vendor,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update vendor profile
   * PUT /api/vendor/profile
   */
  async updateVendorProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const updateData = req.body;

      const vendor = await prisma.vendor.update({
        where: { userId },
        data: {
          businessName: updateData.businessName,
          businessAddress: updateData.businessAddress,
          businessPhone: updateData.businessPhone,
          businessEmail: updateData.businessEmail,
          website: updateData.website,
          description: updateData.description,
          logo: updateData.logo,
          coverImage: updateData.coverImage,
          facebookUrl: updateData.facebookUrl,
          instagramUrl: updateData.instagramUrl,
          twitterUrl: updateData.twitterUrl,
          linkedInUrl: updateData.linkedInUrl,
        },
      });

      // Invalidate cache
      await redisService.client?.del(`vendor:${vendor.id}`);

      res.json({
        success: true,
        data: vendor,
        message: "Vendor profile updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== DOCUMENT MANAGEMENT ====================

  /**
   * Upload document
   * POST /api/vendor/documents
   */
  async uploadDocument(req, res, next) {
    try {
      const userId = req.user.id;
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const documentData = req.body;

      const document = await prisma.vendorDocument.create({
        data: {
          vendorId: vendor.id,
          documentType: documentData.documentType,
          documentUrl: documentData.documentUrl,
          documentNumber: documentData.documentNumber,
          issueDate: documentData.issueDate
            ? new Date(documentData.issueDate)
            : null,
          expiryDate: documentData.expiryDate
            ? new Date(documentData.expiryDate)
            : null,
          issuingCountry: documentData.issuingCountry,
          fileSize: documentData.fileSize,
          mimeType: documentData.mimeType,
        },
      });

      // Update vendor status if needed
      if (vendor.verificationStatus === "PENDING") {
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: { verificationStatus: "DOCUMENTS_SUBMITTED" },
        });
      }

      res.status(201).json({
        success: true,
        data: document,
        message: "Document uploaded successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all documents
   * GET /api/vendor/documents
   */
  async getDocuments(req, res, next) {
    try {
      const userId = req.user.id;
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const documents = await prisma.vendorDocument.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({
        success: true,
        data: documents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete document
   * DELETE /api/vendor/documents/:documentId
   */
  async deleteDocument(req, res, next) {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;

      const document = await prisma.vendorDocument.findFirst({
        where: {
          id: documentId,
          vendor: { userId },
        },
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      await prisma.vendorDocument.delete({
        where: { id: documentId },
      });

      res.json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== TEAM MANAGEMENT ====================

  /**
   * Get team members
   * GET /api/vendor/team
   */
  async getTeamMembers(req, res, next) {
    try {
      const userId = req.user.id;
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const teamMembers = await prisma.vendorTeamMember.findMany({
        where: { vendorId: vendor.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profile: {
                select: {
                  profilePicture: true,
                },
              },
            },
          },
        },
      });

      res.json({
        success: true,
        data: teamMembers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add team member
   * POST /api/vendor/team
   */
  async addTeamMember(req, res, next) {
    try {
      const userId = req.user.id;
      const { email, role, permissions } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      // Find user by email
      const teamUser = await prisma.user.findUnique({
        where: { email },
      });

      if (!teamUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if already a team member
      const existingMember = await prisma.vendorTeamMember.findUnique({
        where: {
          vendorId_userId: {
            vendorId: vendor.id,
            userId: teamUser.id,
          },
        },
      });

      if (existingMember) {
        return res.status(400).json({
          success: false,
          message: "User is already a team member",
        });
      }

      // Create team member
      const teamMember = await prisma.vendorTeamMember.create({
        data: {
          vendorId: vendor.id,
          userId: teamUser.id,
          role,
          permissions: permissions || {},
          invitedBy: userId,
          invitedAt: new Date(),
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Set up OpenFGA relations based on role
      const tuples = [];

      if (role === "ADMIN") {
        tuples.push({
          user: `user:${teamUser.id}`,
          relation: "is_admin",
          object: `vendor_team_member:${teamMember.id}`,
        });
      } else if (role === "MANAGER") {
        tuples.push({
          user: `user:${teamUser.id}`,
          relation: "is_manager",
          object: `vendor_team_member:${teamMember.id}`,
        });
      } else if (role === "EDITOR") {
        tuples.push({
          user: `user:${teamUser.id}`,
          relation: "is_editor",
          object: `vendor_team_member:${teamMember.id}`,
        });
      } else if (role === "VIEWER") {
        tuples.push({
          user: `user:${teamUser.id}`,
          relation: "is_viewer",
          object: `vendor_team_member:${teamMember.id}`,
        });
      }

      if (tuples.length > 0) {
        await openfgaService.writeTuples(tuples);
      }

      res.status(201).json({
        success: true,
        data: teamMember,
        message: "Team member added successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update team member
   * PUT /api/vendor/team/:memberId
   */
  async updateTeamMember(req, res, next) {
    try {
      const { memberId } = req.params;
      const userId = req.user.id;
      const { role, permissions, isActive } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const teamMember = await prisma.vendorTeamMember.findFirst({
        where: {
          id: memberId,
          vendorId: vendor.id,
        },
      });

      if (!teamMember) {
        return res.status(404).json({
          success: false,
          message: "Team member not found",
        });
      }

      const updatedMember = await prisma.vendorTeamMember.update({
        where: { id: memberId },
        data: {
          role: role || teamMember.role,
          permissions: permissions || teamMember.permissions,
          isActive: isActive !== undefined ? isActive : teamMember.isActive,
        },
      });

      // Update OpenFGA relations
      if (role && role !== teamMember.role) {
        // Remove old role
        await openfgaService.deleteTuples([
          {
            user: `user:${teamMember.userId}`,
            relation: `is_${teamMember.role.toLowerCase()}`,
            object: `vendor_team_member:${memberId}`,
          },
        ]);

        // Add new role
        await openfgaService.writeTuples([
          {
            user: `user:${teamMember.userId}`,
            relation: `is_${role.toLowerCase()}`,
            object: `vendor_team_member:${memberId}`,
          },
        ]);
      }

      res.json({
        success: true,
        data: updatedMember,
        message: "Team member updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove team member
   * DELETE /api/vendor/team/:memberId
   */
  async removeTeamMember(req, res, next) {
    try {
      const { memberId } = req.params;
      const userId = req.user.id;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const teamMember = await prisma.vendorTeamMember.findFirst({
        where: {
          id: memberId,
          vendorId: vendor.id,
        },
      });

      if (!teamMember) {
        return res.status(404).json({
          success: false,
          message: "Team member not found",
        });
      }

      await prisma.vendorTeamMember.delete({
        where: { id: memberId },
      });

      // Remove OpenFGA relations
      await openfgaService.deleteTuples([
        {
          user: `user:${teamMember.userId}`,
          relation: `is_${teamMember.role.toLowerCase()}`,
          object: `vendor_team_member:${memberId}`,
        },
      ]);

      res.json({
        success: true,
        message: "Team member removed successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== DASHBOARD & ANALYTICS ====================

  /**
   * Get vendor dashboard
   * GET /api/vendor/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const userId = req.user.id;
      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      // Fix: Add await and correct vendorId
      const accommodationsData = await prisma.accommodation.findMany({
        where: {
          vendorId: vendor.id, // Use vendor.id, not userId
        },
        include: {
          _count: {
            select: {
              rooms: true,
              bookings: true,
            },
          },
          rooms: {
            where: { isAvailable: true },
            select: {
              id: true,
              roomType: true,
              basePrice: true,
              isAvailable: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Create a detailed matrix for accommodations
      const accommodationsMatrix = accommodationsData.map((acc) => ({
        id: acc.id,
        name: acc.name,
        city: acc.city,
        country: acc.country,
        starRating: acc.starRating,
        priceCategory: acc.priceCategory,
        isActive: acc.isActive,
        isVerified: acc.isVerified,
        totalRooms: acc._count.rooms,
        availableRooms: acc.rooms.length,
        totalBookings: acc._count.bookings,
        occupancyRate:
          acc._count.rooms > 0
            ? (
                ((acc._count.rooms - acc.rooms.length) / acc._count.rooms) *
                100
              ).toFixed(2)
            : 0,
        createdAt: acc.createdAt,
        // Room types breakdown
        roomTypes: acc.rooms.reduce((types, room) => {
          types[room.roomType] = (types[room.roomType] || 0) + 1;
          return types;
        }, {}),
        // Price range
        priceRange: {
          min: Math.min(...acc.rooms.map((r) => r.basePrice)),
          max: Math.max(...acc.rooms.map((r) => r.basePrice)),
          average: (
            acc.rooms.reduce((sum, r) => sum + r.basePrice, 0) /
            acc.rooms.length
          ).toFixed(2),
        },
      }));

      console.log(
        "Accommodations Matrix:",
        JSON.stringify(accommodationsMatrix, null, 2),
      );

      // Get counts for all listings
      const [
        accommodations,
        transportation,
        packages,
        experiences,
        totalBookings,
        recentTransactions,
        pendingVerification,
      ] = await Promise.all([
        prisma.accommodation.count({ where: { vendorId: vendor.id } }),
        prisma.transportationProvider.count({ where: { vendorId: vendor.id } }),
        prisma.travelPackage.count({ where: { vendorId: vendor.id } }),
        prisma.vendorExperience.count({ where: { vendorId: vendor.id } }),
        this.getTotalBookings(vendor.id),
        prisma.transaction.findMany({
          where: { vendorId: vendor.id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        vendor.verificationStatus !== "VERIFIED",
      ]);

      // Calculate accommodation statistics
      const accommodationStats = {
        total: accommodations,
        active: accommodationsData.filter((a) => a.isActive).length,
        inactive: accommodationsData.filter((a) => !a.isActive).length,
        verified: accommodationsData.filter((a) => a.isVerified).length,
        unverified: accommodationsData.filter((a) => !a.isVerified).length,
        totalRooms: accommodationsData.reduce(
          (sum, a) => sum + a._count.rooms,
          0,
        ),
        availableRooms: accommodationsData.reduce(
          (sum, a) => sum + a.rooms.length,
          0,
        ),
        totalBookings: accommodationsData.reduce(
          (sum, a) => sum + a._count.bookings,
          0,
        ),
        averageOccupancy:
          accommodationsData.length > 0
            ? (
                accommodationsData.reduce(
                  (sum, a) =>
                    sum +
                    (a._count.rooms > 0
                      ? ((a._count.rooms - a.rooms.length) / a._count.rooms) *
                        100
                      : 0),
                  0,
                ) / accommodationsData.length
              ).toFixed(2)
            : 0,
        byCity: accommodationsData.reduce((cities, a) => {
          cities[a.city] = (cities[a.city] || 0) + 1;
          return cities;
        }, {}),
        byStarRating: accommodationsData.reduce((ratings, a) => {
          const rating = a.starRating || "Unrated";
          ratings[rating] = (ratings[rating] || 0) + 1;
          return ratings;
        }, {}),
        byPriceCategory: accommodationsData.reduce((categories, a) => {
          categories[a.priceCategory] = (categories[a.priceCategory] || 0) + 1;
          return categories;
        }, {}),
      };

      res.json({
        success: true,
        data: {
          stats: {
            totalListings:
              accommodations + transportation + packages + experiences,
            accommodations,
            transportation,
            packages,
            experiences,
            totalBookings,
            balance: vendor.balance,
            lifetimeEarnings: vendor.lifetimeEarnings,
            pendingVerification,
          },
          accommodationDetails: {
            matrix: accommodationsMatrix,
            statistics: accommodationStats,
          },
          recentTransactions,
          verificationStatus: vendor.verificationStatus,
          isActive: vendor.isActive,
        },
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Get vendor analytics
   * GET /api/vendor/analytics
   */
  async getAnalytics(req, res, next) {
    try {
      const userId = req.user.id;
      const { from, to, interval = "day" } = req.query;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const startDate = from
        ? new Date(from)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(to) : new Date();

      // Get bookings by type
      const [
        accommodationBookings,
        transportationBookings,
        packageBookings,
        experienceBookings,
      ] = await Promise.all([
        prisma.accommodationBooking.count({
          where: {
            accommodation: { vendorId: vendor.id },
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.transportationBooking.count({
          where: {
            provider: { vendorId: vendor.id },
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.travelPackageBooking.count({
          where: {
            package: { vendorId: vendor.id },
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.experienceBooking.count({
          where: {
            experience: { vendorId: vendor.id },
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
      ]);

      // Get revenue
      const transactions = await prisma.transaction.aggregate({
        where: {
          vendorId: vendor.id,
          status: "COMPLETED",
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          amount: true,
          netAmount: true,
          fee: true,
        },
      });

      // Get daily stats
      const dailyStats = await prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as bookings,
          SUM(amount) as revenue,
          SUM(fee) as fees
        FROM transactions
        WHERE vendor_id = ${vendor.id}
          AND created_at BETWEEN ${startDate} AND ${endDate}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;

      res.json({
        success: true,
        data: {
          period: { from: startDate, to: endDate },
          bookings: {
            accommodations: accommodationBookings,
            transportation: transportationBookings,
            packages: packageBookings,
            experiences: experienceBookings,
            total:
              accommodationBookings +
              transportationBookings +
              packageBookings +
              experienceBookings,
          },
          revenue: {
            gross: transactions._sum.amount || 0,
            net: transactions._sum.netAmount || 0,
            fees: transactions._sum.fee || 0,
          },
          daily: dailyStats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get transactions
   * GET /api/vendor/transactions
   */
  async getTransactions(req, res, next) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status } = req.query;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const where = { vendorId: vendor.id };
      if (status) where.status = status;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: parseInt(limit),
        }),
        prisma.transaction.count({ where }),
      ]);

      res.json({
        success: true,
        data: transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PAYOUT MANAGEMENT ====================

  /**
   * Request payout
   * POST /api/vendor/payouts/request
   */
  async requestPayout(req, res, next) {
    try {
      const userId = req.user.id;
      const { amount, payoutMethod, payoutDetails } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      if (vendor.balance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. Available: ${vendor.balance}`,
        });
      }

      if (amount < vendor.minimumPayout) {
        return res.status(400).json({
          success: false,
          message: `Minimum payout amount is ${vendor.minimumPayout}`,
        });
      }

      // Get eligible transactions
      const transactions = await prisma.transaction.findMany({
        where: {
          vendorId: vendor.id,
          status: "COMPLETED",
          payoutId: null,
        },
      });

      const totalEligible = transactions.reduce(
        (sum, t) => sum + t.netAmount,
        0,
      );

      if (amount > totalEligible) {
        return res.status(400).json({
          success: false,
          message: `Requested amount exceeds eligible earnings`,
        });
      }

      // Create payout request
      const payout = await prisma.payout.create({
        data: {
          vendorId: vendor.id,
          amount,
          netAmount: amount, // Will subtract fee later
          payoutMethod,
          payoutDetails: payoutDetails || vendor.payoutDetails,
          transactionIds: transactions.map((t) => t.id),
          status: "PENDING",
          requestedAt: new Date(),
        },
      });

      // Update vendor balance (deduct pending amount)
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          balance: { decrement: amount },
        },
      });

      res.status(201).json({
        success: true,
        data: payout,
        message: "Payout requested successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get payouts
   * GET /api/vendor/payouts
   */
  async getPayouts(req, res, next) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status } = req.query;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const where = { vendorId: vendor.id };
      if (status) where.status = status;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [payouts, total] = await Promise.all([
        prisma.payout.findMany({
          where,
          orderBy: { requestedAt: "desc" },
          skip,
          take: parseInt(limit),
        }),
        prisma.payout.count({ where }),
      ]);

      res.json({
        success: true,
        data: payouts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REVIEWS ====================

  /**
   * Get vendor reviews
   * GET /api/vendor/reviews
   */
  async getReviews(req, res, next) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [reviews, total] = await Promise.all([
        prisma.vendorReview.findMany({
          where: { vendorId: vendor.id, isHidden: false },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profile: {
                  select: { profilePicture: true },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: parseInt(limit),
        }),
        prisma.vendorReview.count({
          where: { vendorId: vendor.id, isHidden: false },
        }),
      ]);

      // Calculate ratings distribution
      const ratings = await prisma.vendorReview.groupBy({
        by: ["rating"],
        where: { vendorId: vendor.id },
        _count: true,
      });

      const distribution = {};
      ratings.forEach((r) => {
        distribution[r.rating] = r._count;
      });

      res.json({
        success: true,
        data: {
          reviews,
          stats: {
            total,
            averageRating: vendor.overallRating,
            distribution,
          },
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reply to review
   * POST /api/vendor/reviews/:reviewId/reply
   */
  async replyToReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const userId = req.user.id;
      const { response } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      const review = await prisma.vendorReview.findFirst({
        where: {
          id: reviewId,
          vendorId: vendor.id,
        },
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      const updatedReview = await prisma.vendorReview.update({
        where: { id: reviewId },
        data: {
          response,
          responseAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updatedReview,
        message: "Reply posted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ADMIN METHODS ====================

  /**
   * Get all vendors (admin)
   * GET /api/admin/vendors
   */
  async getAllVendors(req, res, next) {
    try {
      const {
        type,
        status,
        verified,
        isActive,
        search,
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const where = {};

      if (type) where.vendorType = { has: type };
      if (status) where.verificationStatus = status;
      if (verified !== undefined) where.isVerified = verified === "true";
      if (isActive !== undefined) where.isActive = isActive === "true";

      if (search) {
        where.OR = [
          { businessName: { contains: search, mode: "insensitive" } },
          { businessEmail: { contains: search, mode: "insensitive" } },
          { businessPhone: { contains: search } },
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      const [vendors, total] = await Promise.all([
        prisma.vendor.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
            _count: {
              select: {
                accommodations: true,
                transportationProviders: true,
                travelPackages: true,
                experiences: true,
              },
            },
          },
          skip,
          take: parseInt(limit),
          orderBy,
        }),
        prisma.vendor.count({ where }),
      ]);

      res.json({
        success: true,
        data: vendors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor by ID (admin)
   * GET /api/admin/vendors/:vendorId
   */
  async getVendorById(req, res, next) {
    try {
      const { vendorId } = req.params;

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              createdAt: true,
            },
          },
          documents: true,
          teamMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              accommodations: true,
              transportationProviders: true,
              travelPackages: true,
              experiences: true,
              transactions: true,
              reviews: true,
            },
          },
        },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor not found",
        });
      }

      res.json({
        success: true,
        data: vendor,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify vendor (admin)
   * POST /api/admin/vendors/:vendorId/verify
   */
  async verifyVendor(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { approvedTypes, notes } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        include: { user: true },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor not found",
        });
      }

      // Update vendor
      const updatedVendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: {
          verificationStatus: "VERIFIED",
          verifiedAt: new Date(),
          verifiedBy: req.user.id,
          verificationNotes: notes,
          isActive: true,
        },
      });

      // Update application
      await prisma.vendorApplication.update({
        where: { userId: vendor.userId },
        data: {
          status: "APPROVED",
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          approvedTypes,
        },
      });

      // Grant permissions in OpenFGA
      const tuples = [];

      // ALWAYS add the base is_vendor relation
      tuples.push({
        user: `user:${vendor.userId}`,
        relation: "is_vendor",
        object: `vendor:${vendorId}`,
      });

      // Add specific permissions based on approved types
      if (approvedTypes.includes("ACCOMMODATION_PROVIDER")) {
        tuples.push({
          user: `user:${vendor.userId}`,
          relation: "can_sell_accommodations",
          object: `vendor:${vendorId}`,
        });
      }

      if (approvedTypes.includes("EXPERIENCE_PROVIDER")) {
        tuples.push({
          user: `user:${vendor.userId}`,
          relation: "can_sell_experiences",
          object: `vendor:${vendorId}`,
        });
      }

      if (approvedTypes.includes("TRANSPORTATION_PROVIDER")) {
        tuples.push({
          user: `user:${vendor.userId}`,
          relation: "can_sell_transportation",
          object: `vendor:${vendorId}`,
        });
      }

      if (approvedTypes.includes("TRAVEL_AGENCY")) {
        tuples.push({
          user: `user:${vendor.userId}`,
          relation: "can_sell_packages",
          object: `vendor:${vendorId}`,
        });
      }

      if (approvedTypes.includes("SHOPPING_VENDOR")) {
        tuples.push({
          user: `user:${vendor.userId}`,
          relation: "can_sell_shopping",
          object: `vendor:${vendorId}`,
        });
      }

      // Write all tuples to OpenFGA
      if (tuples.length > 0 && openfgaService.writeTuples) {
        console.log("Writing OpenFGA tuples:", tuples);
        await openfgaService.writeTuples(tuples);
      }

      res.json({
        success: true,
        data: updatedVendor,
        message: "Vendor verified successfully",
      });
    } catch (error) {
      console.error("Error in verifyVendor:", error);
      next(error);
    }
  }
  /**
   * Get pending verifications (admin)
   * GET /api/admin/vendors/pending
   */
  async getPendingVerifications(req, res, next) {
    try {
      const vendors = await prisma.vendor.findMany({
        where: {
          verificationStatus: {
            in: ["PENDING", "DOCUMENTS_SUBMITTED", "UNDER_REVIEW"],
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          documents: {
            where: { isVerified: false },
          },
          _count: {
            select: {
              documents: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      res.json({
        success: true,
        data: vendors,
        count: vendors.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Suspend vendor (admin)
   * POST /api/admin/vendors/:vendorId/suspend
   */
  async suspendVendor(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { reason, duration } = req.body;

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: {
          isActive: false,
          suspensionReason: reason,
          suspendedUntil: duration ? new Date(Date.now() + duration) : null,
        },
      });

      res.json({
        success: true,
        data: vendor,
        message: "Vendor suspended successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate vendor (admin)
   * POST /api/admin/vendors/:vendorId/activate
   */
  async activateVendor(req, res, next) {
    try {
      const { vendorId } = req.params;

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: {
          isActive: true,
          suspensionReason: null,
          suspendedUntil: null,
        },
      });

      res.json({
        success: true,
        data: vendor,
        message: "Vendor activated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update commission (admin)
   * PUT /api/admin/vendors/:vendorId/commission
   */
  async updateCommission(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { commissionRate } = req.body;

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: { commissionRate },
      });

      res.json({
        success: true,
        data: vendor,
        message: "Commission rate updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

async checkVendorStatus(req, res) {
  try {
    // 1. Check if req.user exists (It does, based on your log)
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // 2. Use 'id' instead of 'userId' to match the req object structure
    const userId = req.user.id; 

    const vendor = await prisma.vendor.findUnique({
      where: {
        userId: userId, // This refers to the column in your DB
        // verificationStatus: "VERIFIED",
        isActive: true,
      },
    });

    if (vendor) {
      return res.status(200).json({ success: true, data: vendor });
    }

    return res.status(200).json({
      success: true,
      data: { userId: userId, message: "Vendor Application is still in progress!" }
    });
  } catch (error) {
    console.error("Error checking vendor status:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

  /**
   * Process payout (admin)
   * POST /api/admin/payouts/:payoutId/process
   */
  async processPayout(req, res, next) {
    try {
      const { payoutId } = req.params;
      const { status, processorResponse, failureReason } = req.body;

      const payout = await prisma.payout.findUnique({
        where: { id: payoutId },
        include: { vendor: true },
      });

      if (!payout) {
        return res.status(404).json({
          success: false,
          message: "Payout not found",
        });
      }

      const updatedPayout = await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status,
          processorResponse,
          failureReason,
          processedAt: status === "COMPLETED" ? new Date() : null,
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });

      if (status === "COMPLETED") {
        // Update transaction statuses
        await prisma.transaction.updateMany({
          where: { id: { in: payout.transactionIds } },
          data: { status: "COMPLETED" },
        });
      }

      res.json({
        success: true,
        data: updatedPayout,
        message: `Payout ${status.toLowerCase()} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== HELPER METHODS ====================

  async getTotalBookings(vendorId) {
    const [accommodation, transportation, packages, experiences] =
      await Promise.all([
        prisma.accommodationBooking.count({
          where: { accommodation: { vendorId } },
        }),
        prisma.transportationBooking.count({
          where: { provider: { vendorId } },
        }),
        prisma.travelPackageBooking.count({
          where: { package: { vendorId } },
        }),
        prisma.experienceBooking.count({
          where: { experience: { vendorId } },
        }),
      ]);

    return accommodation + transportation + packages + experiences;
  }
}

module.exports = new VendorController();
