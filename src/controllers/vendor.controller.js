"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt", "businessName", "verificationStatus", "balance",
]);

// Maps DB role strings → OpenFGA relation strings
// FIX 1: Removed OWNER — TeamMemberRole enum only defines ADMIN | MANAGER | EDITOR | VIEWER
const ROLE_TO_RELATION = {
  ADMIN:   "is_admin",
  MANAGER: "is_manager",
  EDITOR:  "is_editor",
  VIEWER:  "is_viewer",
};

// Maps vendor type strings → OpenFGA selling capability strings
const TYPE_TO_CAPABILITY = {
  ACCOMMODATION_PROVIDER:  "can_sell_accommodations",
  EXPERIENCE_PROVIDER:     "can_sell_experiences",
  TRANSPORTATION_PROVIDER: "can_sell_transportation",
  TRAVEL_AGENCY:           "can_sell_packages",
  SHOPPING_VENDOR:         "can_sell_shopping",
};

const PAYOUT_VALID_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const notFound   = (res, msg = "Resource not found")  => res.status(404).json({ success: false, message: msg });
const forbidden  = (res, msg = "Unauthorized access")  => res.status(403).json({ success: false, message: msg });
const badRequest = (res, msg)                          => res.status(400).json({ success: false, message: msg });

/** Parse positive integer query param with a fallback. */
const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Build skip/take/page/limit from query params. */
const parsePagination = (query, defaultLimit = DEFAULT_LIMIT) => {
  const page  = parseIntParam(query.page,  DEFAULT_PAGE);
  const limit = parseIntParam(query.limit, defaultLimit);
  return { page, limit, skip: (page - 1) * limit };
};

/** Standard pagination metadata object. */
const buildPaginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
});

/** Safe Math helpers — return undefined for empty arrays (avoids ±Infinity). */
const safeMin = (arr) => (arr.length ? Math.min(...arr) : undefined);
const safeMax = (arr) => (arr.length ? Math.max(...arr) : undefined);
const safeAvg = (arr) =>
  arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class VendorController {
  // ==================== VENDOR REGISTRATION ====================

  /**
   * POST /api/vendor/register
   */
  async registerVendor(req, res, next) {
    try {
      const { id: userId } = req.user;
      const vendorData = req.body;

      // Check existing vendor and pending application concurrently
      const [existingVendor, existingApplication] = await Promise.all([
        prisma.vendor.findUnique({ where: { userId }, select: { id: true } }),
        prisma.vendorApplication.findUnique({
          where: { userId },
          select: { id: true, status: true },
        }),
      ]);

      if (existingVendor) {
        return badRequest(res, "You are already registered as a vendor");
      }

      if (existingApplication?.status === "PENDING") {
        return badRequest(res, "You already have a pending application");
      }

      // Atomically create vendor + application together
      const { vendor } = await prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.create({
          data: {
            userId,
            businessName:      vendorData.businessName,
            businessRegNumber: vendorData.businessRegNumber,
            taxId:             vendorData.taxId,
            vendorType:        vendorData.vendorType ?? [],
            businessAddress:   vendorData.businessAddress,
            businessPhone:     vendorData.businessPhone,
            businessEmail:     vendorData.businessEmail,
            website:           vendorData.website,
            description:       vendorData.description,
            logo:              vendorData.logo,
            coverImage:        vendorData.coverImage,
            verificationStatus: "PENDING",
          },
        });

        // FIX 3: VendorApplication only has: userId, taxId, vendorTypes, documents,
        //        additionalInfo, status — removed businessName/Address/Phone/Email
        //        which do not exist on that model.
        await tx.vendorApplication.create({
          data: {
            userId,
            taxId:          vendorData.taxId,
            vendorTypes:    vendorData.vendorType ?? [],
            documents:      vendorData.documents ?? [],
            additionalInfo: vendorData.additionalInfo,
            status:         "PENDING",
          },
        });

        return { vendor };
      });

      // Non-critical — set up OpenFGA owner relation
      Promise.allSettled([
        openfgaService.assignVendorOwner(userId, vendor.id),
      ]);

      return res.status(201).json({
        success: true,
        data: vendor,
        message: "Vendor registration submitted for verification",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/profile
   */
  async getVendorProfile(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        include: {
          documents: {
            select: {
              id: true, documentType: true, documentUrl: true,
              isVerified: true, createdAt: true,
            },
          },
          _count: {
            select: {
              accommodations: true, transportationProviders: true,
              travelPackages: true, experiences: true, teamMembers: true,
            },
          },
        },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      return res.json({ success: true, data: vendor });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/vendor/profile
   */
  async updateVendorProfile(req, res, next) {
    try {
      const { id: userId } = req.user;
      const {
        businessName, businessAddress, businessPhone, businessEmail,
        website, description, logo, coverImage,
        facebookUrl, instagramUrl, twitterUrl, linkedInUrl,
      } = req.body;

      const vendor = await prisma.vendor.update({
        where: { userId },
        data: {
          ...(businessName    !== undefined && { businessName }),
          ...(businessAddress !== undefined && { businessAddress }),
          ...(businessPhone   !== undefined && { businessPhone }),
          ...(businessEmail   !== undefined && { businessEmail }),
          ...(website         !== undefined && { website }),
          ...(description     !== undefined && { description }),
          ...(logo            !== undefined && { logo }),
          ...(coverImage      !== undefined && { coverImage }),
          ...(facebookUrl     !== undefined && { facebookUrl }),
          ...(instagramUrl    !== undefined && { instagramUrl }),
          ...(twitterUrl      !== undefined && { twitterUrl }),
          ...(linkedInUrl     !== undefined && { linkedInUrl }),
        },
      });

      // Fire-and-forget cache invalidation
      redisService.client?.del(`vendor:${vendor.id}`).catch(() => {});

      return res.json({
        success: true,
        data: vendor,
        message: "Vendor profile updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/status
   *
   * FIX 2: Replaced findUnique with findFirst — findUnique only accepts
   *        @unique-constrained fields in `where`, and isActive is not unique.
   */
  async checkVendorStatus(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findFirst({
        where: { userId, isActive: true },
      });

      return res.json({
        success: true,
        data: vendor ?? { userId, message: "Vendor application is still in progress" },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== DOCUMENT MANAGEMENT ====================

  /**
   * POST /api/vendor/documents
   */
  async uploadDocument(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const {
        documentType, documentUrl, documentNumber,
        issueDate, expiryDate, issuingCountry, fileSize, mimeType,
      } = req.body;

      // Create document + conditionally advance verification status — atomically
      const document = await prisma.$transaction(async (tx) => {
        const doc = await tx.vendorDocument.create({
          data: {
            vendorId: vendor.id,
            documentType,
            documentUrl,
            documentNumber,
            issueDate:  issueDate  ? new Date(issueDate)  : null,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            issuingCountry,
            fileSize,
            mimeType,
          },
        });

        if (vendor.verificationStatus === "PENDING") {
          await tx.vendor.update({
            where: { id: vendor.id },
            data: { verificationStatus: "DOCUMENTS_SUBMITTED" },
          });
        }

        return doc;
      });

      return res.status(201).json({
        success: true,
        data: document,
        message: "Document uploaded successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/documents
   */
  async getDocuments(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const documents = await prisma.vendorDocument.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
      });

      return res.json({ success: true, data: documents });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/vendor/documents/:documentId
   */
  async deleteDocument(req, res, next) {
    try {
      const { documentId } = req.params;
      const { id: userId } = req.user;

      // Single query verifies ownership + existence together
      const document = await prisma.vendorDocument.findFirst({
        where: { id: documentId, vendor: { userId } },
        select: { id: true },
      });

      if (!document) return notFound(res, "Document not found");

      await prisma.vendorDocument.delete({ where: { id: documentId } });

      return res.json({ success: true, message: "Document deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== TEAM MANAGEMENT ====================

  /**
   * GET /api/vendor/team
   */
  async getTeamMembers(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const teamMembers = await prisma.vendorTeamMember.findMany({
        where: { vendorId: vendor.id },
        include: {
          user: {
            select: {
              id: true, name: true, email: true,
              profile: { select: { profilePicture: true } },
            },
          },
        },
      });

      return res.json({ success: true, data: teamMembers });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/vendor/team
   */
  async addTeamMember(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { email, role, permissions } = req.body;

      // FIX 1: ROLE_TO_RELATION no longer includes OWNER, so this validation
      //        now correctly rejects it alongside any other invalid role string.
      const relation = ROLE_TO_RELATION[role?.toUpperCase()];
      if (!relation) {
        return badRequest(
          res,
          `Invalid role. Must be one of: ${Object.keys(ROLE_TO_RELATION).join(", ")}`
        );
      }

      // Fetch vendor and target user concurrently
      const [vendor, teamUser] = await Promise.all([
        prisma.vendor.findUnique({ where: { userId }, select: { id: true } }),
        prisma.user.findUnique({ where: { email }, select: { id: true } }),
      ]);

      if (!vendor)   return notFound(res, "Vendor profile not found");
      if (!teamUser) return notFound(res, "User not found");

      if (teamUser.id === userId) {
        return badRequest(res, "Cannot add yourself as a team member");
      }

      const existingMember = await prisma.vendorTeamMember.findUnique({
        where: { vendorId_userId: { vendorId: vendor.id, userId: teamUser.id } },
        select: { id: true },
      });

      if (existingMember) {
        return res.status(409).json({ success: false, message: "User is already a team member" });
      }

      const teamMember = await prisma.vendorTeamMember.create({
        data: {
          vendorId:    vendor.id,
          userId:      teamUser.id,
          role:        role.toUpperCase(),
          permissions: permissions ?? {},
          invitedBy:   userId,
          invitedAt:   new Date(),
          isActive:    true,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      // Set up OpenFGA team-member relations (non-critical)
      Promise.allSettled([
        openfgaService.createTeamMemberRelations(teamMember.id, vendor.id),
        openfgaService.writeTuples([{
          user:     `user:${teamUser.id}`,
          relation,
          object:   `vendor_team_member:${teamMember.id}`,
        }]),
      ]);

      return res.status(201).json({
        success: true,
        data: teamMember,
        message: "Team member added successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/vendor/team/:memberId
   */
  async updateTeamMember(req, res, next) {
    try {
      const { memberId } = req.params;
      const { id: userId } = req.user;
      const { role, permissions, isActive } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const teamMember = await prisma.vendorTeamMember.findFirst({
        where: { id: memberId, vendorId: vendor.id },
      });

      if (!teamMember) return notFound(res, "Team member not found");

      const newRole = role?.toUpperCase();
      // FIX 1: ROLE_TO_RELATION no longer includes OWNER so this guard is consistent
      if (newRole && !ROLE_TO_RELATION[newRole]) {
        return badRequest(
          res,
          `Invalid role. Must be one of: ${Object.keys(ROLE_TO_RELATION).join(", ")}`
        );
      }

      const updatedMember = await prisma.vendorTeamMember.update({
        where: { id: memberId },
        data: {
          ...(newRole      && { role: newRole }),
          ...(permissions  !== undefined && { permissions }),
          ...(isActive     !== undefined && { isActive }),
        },
      });

      // Swap OpenFGA role if changed (non-critical)
      if (newRole && newRole !== teamMember.role) {
        Promise.allSettled([
          openfgaService.updateTeamMemberRole(
            memberId, teamMember.userId, teamMember.role, newRole
          ),
        ]);
      }

      return res.json({
        success: true,
        data: updatedMember,
        message: "Team member updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/vendor/team/:memberId
   */
  async removeTeamMember(req, res, next) {
    try {
      const { memberId } = req.params;
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const teamMember = await prisma.vendorTeamMember.findFirst({
        where: { id: memberId, vendorId: vendor.id },
        select: { id: true, userId: true, role: true },
      });

      if (!teamMember) return notFound(res, "Team member not found");

      await prisma.vendorTeamMember.delete({ where: { id: memberId } });

      // Clean up OpenFGA (fire-and-forget)
      Promise.allSettled([
        openfgaService.removeTeamMember(memberId, teamMember.userId, teamMember.role),
      ]);

      return res.json({ success: true, message: "Team member removed successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== DASHBOARD & ANALYTICS ====================

  /**
   * GET /api/vendor/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const { id: userId } = req.user;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: {
          id: true, balance: true, lifetimeEarnings: true,
          verificationStatus: true, isActive: true,
        },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      // Fan out all independent queries in one batch
      const [
        accommodationsData,
        transportationCount,
        packagesCount,
        experiencesCount,
        recentTransactions,
        totalBookings,
      ] = await Promise.all([
        prisma.accommodation.findMany({
          where: { vendorId: vendor.id },
          include: {
            _count: { select: { rooms: true, bookings: true } },
            rooms: {
              where: { isAvailable: true },
              select: { id: true, roomType: true, basePrice: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.transportationProvider.count({ where: { vendorId: vendor.id } }),
        prisma.travelPackage.count({ where: { vendorId: vendor.id } }),
        prisma.vendorExperience.count({ where: { vendorId: vendor.id } }),
        prisma.transaction.findMany({
          where: { vendorId: vendor.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true, amount: true, netAmount: true,
            fee: true, status: true, createdAt: true,
          },
        }),
        this._getTotalBookings(vendor.id),
      ]);

      const accommodationsCount = accommodationsData.length;

      // Per-accommodation matrix — safe price range for empty room arrays
      const accommodationsMatrix = accommodationsData.map((acc) => {
        const prices = acc.rooms.map((r) => r.basePrice);
        const occupancyRate =
          acc._count.rooms > 0
            ? (((acc._count.rooms - acc.rooms.length) / acc._count.rooms) * 100).toFixed(2)
            : "0.00";

        return {
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
          occupancyRate,
          createdAt: acc.createdAt,
          roomTypes: acc.rooms.reduce((map, room) => {
            map[room.roomType] = (map[room.roomType] || 0) + 1;
            return map;
          }, {}),
          priceRange: prices.length
            ? {
                min: safeMin(prices),
                max: safeMax(prices),
                average: safeAvg(prices)?.toFixed(2),
              }
            : null,
        };
      });

      // Aggregate-level statistics
      const accommodationStats = {
        total:        accommodationsCount,
        active:       accommodationsData.filter((a) =>  a.isActive).length,
        inactive:     accommodationsData.filter((a) => !a.isActive).length,
        verified:     accommodationsData.filter((a) =>  a.isVerified).length,
        unverified:   accommodationsData.filter((a) => !a.isVerified).length,
        totalRooms:   accommodationsData.reduce((s, a) => s + a._count.rooms, 0),
        availableRooms: accommodationsData.reduce((s, a) => s + a.rooms.length, 0),
        totalBookings:  accommodationsData.reduce((s, a) => s + a._count.bookings, 0),
        averageOccupancy:
          accommodationsCount > 0
            ? (
                accommodationsData.reduce(
                  (s, a) =>
                    s + (a._count.rooms > 0
                      ? ((a._count.rooms - a.rooms.length) / a._count.rooms) * 100
                      : 0),
                  0
                ) / accommodationsCount
              ).toFixed(2)
            : "0.00",
        byCity: accommodationsData.reduce((map, a) => {
          map[a.city] = (map[a.city] || 0) + 1;
          return map;
        }, {}),
        byStarRating: accommodationsData.reduce((map, a) => {
          const key = a.starRating ?? "Unrated";
          map[key] = (map[key] || 0) + 1;
          return map;
        }, {}),
        byPriceCategory: accommodationsData.reduce((map, a) => {
          map[a.priceCategory] = (map[a.priceCategory] || 0) + 1;
          return map;
        }, {}),
      };

      return res.json({
        success: true,
        data: {
          stats: {
            totalListings:
              accommodationsCount + transportationCount + packagesCount + experiencesCount,
            accommodations: accommodationsCount,
            transportation: transportationCount,
            packages:       packagesCount,
            experiences:    experiencesCount,
            totalBookings,
            balance:           vendor.balance,
            lifetimeEarnings:  vendor.lifetimeEarnings,
            pendingVerification: vendor.verificationStatus !== "VERIFIED",
          },
          accommodationDetails: {
            matrix:     accommodationsMatrix,
            statistics: accommodationStats,
          },
          recentTransactions,
          verificationStatus: vendor.verificationStatus,
          isActive:           vendor.isActive,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/analytics
   */
  async getAnalytics(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { from, to } = req.query;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate   = to   ? new Date(to)   : new Date();

      if (isNaN(startDate) || isNaN(endDate)) {
        return badRequest(res, "Invalid date range");
      }

      const dateFilter = { gte: startDate, lte: endDate };

      const [
        accommodationBookings,
        transportationBookings,
        packageBookings,
        experienceBookings,
        revenueAgg,
        dailyStats,
      ] = await Promise.all([
        prisma.accommodationBooking.count({
          where: { accommodation: { vendorId: vendor.id }, createdAt: dateFilter },
        }),
        prisma.transportationBooking.count({
          where: { provider: { vendorId: vendor.id }, createdAt: dateFilter },
        }),
        prisma.travelPackageBooking.count({
          where: { package: { vendorId: vendor.id }, createdAt: dateFilter },
        }),
        prisma.experienceBooking.count({
          where: { experience: { vendorId: vendor.id }, createdAt: dateFilter },
        }),
        prisma.transaction.aggregate({
          where: { vendorId: vendor.id, status: "COMPLETED", createdAt: dateFilter },
          _sum: { amount: true, netAmount: true, fee: true },
        }),
        prisma.$queryRaw`
          SELECT
            DATE(created_at) AS date,
            COUNT(*)         AS bookings,
            SUM(amount)      AS revenue,
            SUM(fee)         AS fees
          FROM transactions
          WHERE vendor_id    = ${vendor.id}
            AND created_at BETWEEN ${startDate} AND ${endDate}
          GROUP BY DATE(created_at)
          ORDER BY date DESC
        `,
      ]);

      return res.json({
        success: true,
        data: {
          period: { from: startDate, to: endDate },
          bookings: {
            accommodations:  accommodationBookings,
            transportation:  transportationBookings,
            packages:        packageBookings,
            experiences:     experienceBookings,
            total:
              accommodationBookings + transportationBookings +
              packageBookings + experienceBookings,
          },
          revenue: {
            gross: revenueAgg._sum.amount    ?? 0,
            net:   revenueAgg._sum.netAmount ?? 0,
            fees:  revenueAgg._sum.fee       ?? 0,
          },
          daily: dailyStats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== TRANSACTIONS & PAYOUTS ====================

  /**
   * GET /api/vendor/transactions
   */
  async getTransactions(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const where = {
        vendorId: vendor.id,
        ...(status && { status }),
      };

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.transaction.count({ where }),
      ]);

      return res.json({
        success: true,
        data: transactions,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/vendor/payouts/request
   *
   * FIX 4: Payout model has no `transactionIds` field — the Transaction→Payout
   *        relationship is owned by Transaction.payoutId (FK on the transactions
   *        table). Create the payout first, then link transactions via updateMany.
   */
  async requestPayout(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { amount, payoutMethod, payoutDetails } = req.body;

      if (!amount || amount <= 0) {
        return badRequest(res, "Invalid payout amount");
      }

      const vendor = await prisma.vendor.findUnique({ where: { userId } });

      if (!vendor) return notFound(res, "Vendor profile not found");

      if (vendor.balance < amount) {
        return badRequest(res, `Insufficient balance. Available: ${vendor.balance}`);
      }

      if (amount < vendor.minimumPayout) {
        return badRequest(res, `Minimum payout amount is ${vendor.minimumPayout}`);
      }

      const eligibleTransactions = await prisma.transaction.findMany({
        where: { vendorId: vendor.id, status: "COMPLETED", payoutId: null },
        select: { id: true, netAmount: true },
      });

      const totalEligible = eligibleTransactions.reduce((s, t) => s + t.netAmount, 0);

      if (amount > totalEligible) {
        return badRequest(res, "Requested amount exceeds eligible earnings");
      }

      // Atomically create payout → link transactions → deduct balance
      const payout = await prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            vendorId:      vendor.id,
            amount,
            netAmount:     amount,
            payoutMethod,
            payoutDetails: payoutDetails ?? vendor.payoutDetails,
            status:        "PENDING",
            requestedAt:   new Date(),
          },
        });

        // Link eligible transactions to this payout via the FK on Transaction
        await tx.transaction.updateMany({
          where: { id: { in: eligibleTransactions.map((t) => t.id) } },
          data:  { payoutId: payout.id },
        });

        await tx.vendor.update({
          where: { id: vendor.id },
          data:  { balance: { decrement: amount } },
        });

        return payout;
      });

      return res.status(201).json({
        success: true,
        data: payout,
        message: "Payout requested successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/payouts
   */
  async getPayouts(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const where = {
        vendorId: vendor.id,
        ...(status && { status }),
      };

      const [payouts, total] = await Promise.all([
        prisma.payout.findMany({
          where,
          orderBy: { requestedAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.payout.count({ where }),
      ]);

      return res.json({
        success: true,
        data: payouts,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REVIEWS ====================

  /**
   * GET /api/vendor/reviews
   */
  async getReviews(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { page, limit, skip } = parsePagination(req.query, 10);

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true, overallRating: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const baseWhere = { vendorId: vendor.id, isHidden: false };

      const [reviews, total, ratingGroups] = await Promise.all([
        prisma.vendorReview.findMany({
          where: baseWhere,
          include: {
            user: {
              select: {
                id: true, name: true,
                profile: { select: { profilePicture: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.vendorReview.count({ where: baseWhere }),
        prisma.vendorReview.groupBy({
          by:    ["rating"],
          where: { vendorId: vendor.id },
          _count: true,
        }),
      ]);

      const distribution = Object.fromEntries(
        ratingGroups.map((r) => [r.rating, r._count])
      );

      return res.json({
        success: true,
        data: {
          reviews,
          stats: { total, averageRating: vendor.overallRating, distribution },
        },
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/vendor/reviews/:reviewId/reply
   */
  async replyToReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const { id: userId } = req.user;
      const { response } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!vendor) return notFound(res, "Vendor profile not found");

      const review = await prisma.vendorReview.findFirst({
        where: { id: reviewId, vendorId: vendor.id },
        select: { id: true },
      });

      if (!review) return notFound(res, "Review not found");

      const updatedReview = await prisma.vendorReview.update({
        where: { id: reviewId },
        data:  { response, responseAt: new Date() },
      });

      return res.json({
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
   * GET /api/admin/vendors
   */
  async getAllVendors(req, res, next) {
    try {
      const {
        type, status, verified, isActive, search,
        sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      // Whitelist sortBy to prevent injection attacks
      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const where = {
        ...(type     && { vendorType: { has: type } }),
        ...(status   && { verificationStatus: status }),
        ...(verified  !== undefined && { isVerified: verified  === "true" }),
        ...(isActive  !== undefined && { isActive:   isActive  === "true" }),
        ...(search && {
          OR: [
            { businessName:  { contains: search, mode: "insensitive" } },
            { businessEmail: { contains: search, mode: "insensitive" } },
            { businessPhone: { contains: search } },
          ],
        }),
      };

      const [vendors, total] = await Promise.all([
        prisma.vendor.findMany({
          where,
          include: {
            user: { select: { id: true, email: true, name: true } },
            _count: {
              select: {
                accommodations: true, transportationProviders: true,
                travelPackages: true, experiences: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.vendor.count({ where }),
      ]);

      return res.json({
        success: true,
        data: vendors,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/vendors/:vendorId
   */
  async getVendorById(req, res, next) {
    try {
      const { vendorId } = req.params;

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        include: {
          user: {
            select: { id: true, email: true, name: true, phone: true, createdAt: true },
          },
          documents: true,
          teamMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
          _count: {
            select: {
              accommodations: true, transportationProviders: true,
              travelPackages: true, experiences: true,
              transactions: true, reviews: true,
            },
          },
        },
      });

      if (!vendor) return notFound(res, "Vendor not found");

      return res.json({ success: true, data: vendor });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/vendors/pending
   */
  async getPendingVerifications(req, res, next) {
    try {
      const vendors = await prisma.vendor.findMany({
        where: {
          verificationStatus: { in: ["PENDING", "DOCUMENTS_SUBMITTED", "UNDER_REVIEW"] },
        },
        include: {
          user:      { select: { id: true, email: true, name: true } },
          documents: { where: { isVerified: false } },
          _count:    { select: { documents: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      return res.json({ success: true, data: vendors, count: vendors.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/vendors/:vendorId/verify
   *
   * FIX 6: Removed `approvedTypes` from vendorApplication.update —
   *        VendorApplication model has no such field.
   */
  async verifyVendor(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { approvedTypes = [], notes } = req.body;

      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, userId: true },
      });

      if (!vendor) return notFound(res, "Vendor not found");

      // Atomically verify vendor + approve application
      const updatedVendor = await prisma.$transaction(async (tx) => {
        const updated = await tx.vendor.update({
          where: { id: vendorId },
          data: {
            verificationStatus: "VERIFIED",
            verifiedAt:         new Date(),
            verifiedBy:         req.user.id,
            verificationNotes:  notes,
            isActive:           true,
          },
        });

        // FIX 6: VendorApplication has no approvedTypes field — only update
        //        fields that actually exist on the model.
        await tx.vendorApplication.update({
          where: { userId: vendor.userId },
          data: {
            status:      "APPROVED",
            reviewedBy:  req.user.id,
            reviewedAt:  new Date(),
          },
        });

        return updated;
      });

      // Grant OpenFGA permissions — use capability map, filter unknown types
      const capabilityGrants = approvedTypes
        .filter((t) => TYPE_TO_CAPABILITY[t])
        .map((t) =>
          openfgaService.grantVendorSellingCapability(
            vendor.userId, vendorId, TYPE_TO_CAPABILITY[t]
          )
        );

      Promise.allSettled([
        openfgaService.assignVendorOwner(vendor.userId, vendorId),
        ...capabilityGrants,
      ]);

      return res.json({
        success: true,
        data: updatedVendor,
        message: "Vendor verified successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/vendors/:vendorId/suspend
   */
  async suspendVendor(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { reason, duration } = req.body;

      const existing = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true },
      });

      if (!existing) return notFound(res, "Vendor not found");

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: {
          isActive:         false,
          suspensionReason: reason,
          suspendedUntil:   duration ? new Date(Date.now() + duration) : null,
        },
      });

      return res.json({
        success: true,
        data: vendor,
        message: "Vendor suspended successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/vendors/:vendorId/activate
   */
  async activateVendor(req, res, next) {
    try {
      const { vendorId } = req.params;

      const existing = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true },
      });

      if (!existing) return notFound(res, "Vendor not found");

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data: { isActive: true, suspensionReason: null, suspendedUntil: null },
      });

      return res.json({
        success: true,
        data: vendor,
        message: "Vendor activated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/admin/vendors/:vendorId/commission
   */
  async updateCommission(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { commissionRate } = req.body;

      if (commissionRate == null || commissionRate < 0 || commissionRate > 100) {
        return badRequest(res, "Commission rate must be between 0 and 100");
      }

      const existing = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true },
      });

      if (!existing) return notFound(res, "Vendor not found");

      const vendor = await prisma.vendor.update({
        where: { id: vendorId },
        data:  { commissionRate },
      });

      return res.json({
        success: true,
        data: vendor,
        message: "Commission rate updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/payouts/:payoutId/process
   *
   * FIX 5: Payout has no `transactionIds` field — transactions are fetched via
   *        the `transactions` relation. Also removed `status: "PAID_OUT"` since
   *        that value does not exist in the TransactionStatus enum; the payoutId
   *        FK is sufficient to indicate a transaction has been paid out.
   */
  async processPayout(req, res, next) {
    try {
      const { payoutId } = req.params;
      const { status, processorResponse, failureReason } = req.body;

      if (!PAYOUT_VALID_STATUSES.includes(status)) {
        return badRequest(res, `Status must be one of: ${PAYOUT_VALID_STATUSES.join(", ")}`);
      }

      // FIX 5a: Include the transactions relation instead of the non-existent transactionIds field
      const payout = await prisma.payout.findUnique({
        where: { id: payoutId },
        select: {
          id: true,
          amount: true,
          vendorId: true,
          transactions: { select: { id: true } },
        },
      });

      if (!payout) return notFound(res, "Payout not found");

      const isCompleted = status === "COMPLETED";

      const updatedPayout = await prisma.$transaction(async (tx) => {
        const updated = await tx.payout.update({
          where: { id: payoutId },
          data: {
            status,
            processorResponse,
            failureReason:  isCompleted ? null : failureReason,
            processedAt:    isCompleted ? new Date() : null,
            completedAt:    isCompleted ? new Date() : null,
          },
        });

        if (!isCompleted) {
          // Restore vendor balance on failure or cancellation and unlink transactions
          await tx.vendor.update({
            where: { id: payout.vendorId },
            data:  { balance: { increment: payout.amount } },
          });

          // FIX 5b: Use payout.transactions (relation) instead of payout.transactionIds
          //         and clear the payoutId so they become eligible again
          if (payout.transactions.length) {
            await tx.transaction.updateMany({
              where: { id: { in: payout.transactions.map((t) => t.id) } },
              data:  { payoutId: null },
            });
          }
        }

        return updated;
      });

      return res.json({
        success: true,
        data: updatedPayout,
        message: `Payout ${status.toLowerCase()} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PRIVATE HELPERS ====================

  async _getTotalBookings(vendorId) {
    const [accommodation, transportation, packages, experiences] = await Promise.all([
      prisma.accommodationBooking.count({ where: { accommodation: { vendorId } } }),
      prisma.transportationBooking.count({ where: { provider:      { vendorId } } }),
      prisma.travelPackageBooking.count({ where: { package:        { vendorId } } }),
      prisma.experienceBooking.count({   where: { experience:      { vendorId } } }),
    ]);
    return accommodation + transportation + packages + experiences;
  }
}

module.exports = new VendorController();