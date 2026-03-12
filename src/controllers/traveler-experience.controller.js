"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

const notFound   = (res, msg = "Resource not found") => res.status(404).json({ success: false, message: msg });
const forbidden  = (res, msg = "Unauthorized access") => res.status(403).json({ success: false, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, message: msg });

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `userId` may edit or view a travel plan via OpenFGA.
 *
 * BUG FIX: was a class method — `this` context was fragile in async callbacks.
 * Extracted to module scope.
 */
const checkTravelPlanPermission = async (userId, travelPlanId, permission = "edit") => {
  const fn =
    permission === "edit"
      ? openfgaService.canEditTravelPlan
      : openfgaService.canViewTravelPlan;
  return !!(await fn?.(userId, travelPlanId).catch(() => false));
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class TravelerExperienceController {

  // ==================== CUSTOM EXPERIENCES ====================

  /**
   * POST /api/travel-plans/:travelPlanId/experiences/custom
   * BUG FIX: `req.body` spread directly into Prisma — explicit field whitelist used.
   */
  async addCustomExperience(req, res, next) {
    try {
      const { travelPlanId } = req.params;

      // Existence check before permission check (clean 404 vs silent 403)
      const plan = await prisma.travelPlan.findUnique({
        where:  { id: travelPlanId },
        select: { id: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        (await checkTravelPlanPermission(req.user.id, travelPlanId, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add experiences to this travel plan");

      const {
        title, description, date, startTime, endTime,
        location, cost, category, aiNotes,
      } = req.body;

      if (!title || !date) return badRequest(res, "title and date are required");

      const experience = await prisma.travelExperience.create({
        data: {
          travelPlanId,
          title,
          date: new Date(date),
          ...(description !== undefined && { description }),
          ...(startTime   !== undefined && { startTime }),
          ...(endTime     !== undefined && { endTime }),
          ...(location    !== undefined && { location }),
          ...(cost        !== undefined && { cost }),
          ...(category    !== undefined && { category }),
          ...(aiNotes     !== undefined && { aiNotes }),
        },
      });

      // OpenFGA + cache invalidation (fire-and-forget)
      Promise.allSettled([
        openfgaService.createTravelExperienceRelations?.(req.user.id, experience.id, travelPlanId),
        redisService.client?.del(`travelplan:${travelPlanId}`),
      ]);

      return res.status(201).json({
        success: true,
        data:    experience,
        message: "Custom experience added successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/travel-plans/experiences/custom/:experienceId
   * BUG FIX: existence check before permission check; sparse update replaces
   * `req.body` pass-through.
   */
  async updateCustomExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      // Existence check first
      const experience = await prisma.travelExperience.findUnique({
        where:  { id: experienceId },
        select: { travelPlanId: true },
      });
      if (!experience) return notFound(res, "Experience not found");

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelExperience?.(req.user.id, experienceId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this experience");

      const {
        title, description, date, startTime, endTime,
        location, cost, category, aiNotes,
      } = req.body;

      const updated = await prisma.travelExperience.update({
        where: { id: experienceId },
        data: {
          ...(title       !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(date        !== undefined && { date:      new Date(date) }),
          ...(startTime   !== undefined && { startTime }),
          ...(endTime     !== undefined && { endTime }),
          ...(location    !== undefined && { location }),
          ...(cost        !== undefined && { cost }),
          ...(category    !== undefined && { category }),
          ...(aiNotes     !== undefined && { aiNotes }),
        },
      });

      redisService.client?.del(`travelplan:${experience.travelPlanId}`).catch(() => {});

      return res.json({ success: true, data: updated, message: "Experience updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/travel-plans/experiences/custom/:experienceId
   * BUG FIX: existence check before permission check.
   */
  async deleteCustomExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.travelExperience.findUnique({
        where:  { id: experienceId },
        select: { travelPlanId: true },
      });
      if (!experience) return notFound(res, "Experience not found");

      const canDelete =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canDeleteTravelExperience?.(req.user.id, experienceId).catch(() => false));

      if (!canDelete) return forbidden(res, "You do not have permission to delete this experience");

      await prisma.travelExperience.delete({ where: { id: experienceId } });
      redisService.client?.del(`travelplan:${experience.travelPlanId}`).catch(() => {});

      return res.json({ success: true, message: "Experience deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Experience not found");
      next(error);
    }
  }

  // ==================== VENDOR EXPERIENCE BOOKINGS ====================

  /**
   * POST /api/travel-plans/:travelPlanId/experiences/book
   * BUG FIX: `req.body` spread into Prisma — explicit field whitelist.
   * BUG FIX: totalAmount used `||` which short-circuits on 0 — replaced with `??`.
   */
  async bookVendorExperience(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const {
        experienceId, experienceDate,
        numberOfParticipants, numberOfChildren,
        leadGuestName, leadGuestEmail, leadGuestPhone,
        specialRequests, paymentMethod,
      } = req.body;

      const plan = await prisma.travelPlan.findUnique({
        where:  { id: travelPlanId },
        select: { id: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        (await checkTravelPlanPermission(req.user.id, travelPlanId, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      if (!experienceId || !experienceDate) {
        return badRequest(res, "experienceId and experienceDate are required");
      }

      const experience = await prisma.vendorExperience.findUnique({
        where:  { id: experienceId },
        select: {
          id: true, isActive: true, pricePerPerson: true,
          childPrice: true, maxParticipants: true, currency: true,
        },
      });
      if (!experience)          return notFound(res, "Experience not found");
      if (!experience.isActive) return badRequest(res, "This experience is currently unavailable");

      const parsedDate    = new Date(experienceDate);
      const participants  = numberOfParticipants ?? 1;
      const children      = numberOfChildren     ?? 0;

      // Check capacity
      const existingCount = await prisma.experienceBooking.count({
        where: {
          experienceId,
          experienceDate: parsedDate,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      });

      if (experience.maxParticipants && existingCount + participants > experience.maxParticipants) {
        return badRequest(res, "No spots available for this date");
      }

      // BUG FIX: use ?? not || so 0-price child tickets are included correctly
      const totalAmount = +(
        participants * experience.pricePerPerson +
        children     * (experience.childPrice ?? 0)
      ).toFixed(2);

      const booking = await prisma.experienceBooking.create({
        data: {
          travelPlanId,
          experienceId,
          experienceDate:       parsedDate,
          numberOfParticipants: participants,
          numberOfChildren:     children,
          unitPrice:            experience.pricePerPerson,
          childPrice:           experience.childPrice,
          totalAmount,
          currency:             experience.currency,
          leadGuestName,
          leadGuestEmail,
          ...(leadGuestPhone  !== undefined && { leadGuestPhone }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
        },
        include: { experience: true },
      });

      // Fire-and-forget side effects
      Promise.allSettled([
        openfgaService.createExperienceBookingRelations?.(req.user.id, booking.id, travelPlanId, experienceId),
        redisService.client?.del(`travelplan:${travelPlanId}`),
        redisService.client?.del(`experience:${experienceId}`),
      ]);

      return res.status(201).json({ success: true, data: booking, message: "Experience booked successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/travel-plans/:travelPlanId/experiences
   * Returns both custom TravelExperiences and booked VendorExperiences concurrently.
   */
  async getTravelPlanExperiences(req, res, next) {
    try {
      const { travelPlanId } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where:  { id: travelPlanId },
        select: { id: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        (await checkTravelPlanPermission(req.user.id, travelPlanId, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view these experiences");

      const [customExperiences, vendorBookings] = await Promise.all([
        prisma.travelExperience.findMany({
          where:   { travelPlanId },
          orderBy: { date: "asc" },
        }),
        prisma.experienceBooking.findMany({
          where:   { travelPlanId },
          include: {
            experience: {
              include: {
                vendor: { select: { businessName: true, overallRating: true } },
              },
            },
          },
          orderBy: { experienceDate: "asc" },
        }),
      ]);

      return res.json({
        success: true,
        data: { custom: customExperiences, booked: vendorBookings },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/travel-plans/experiences/booking/:bookingId
   * BUG FIX: existence check before permission check; sparse update.
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.experienceBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, travelPlanId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      if (["CANCELLED", "COMPLETED"].includes(booking.status)) {
        return badRequest(res, `Cannot update booking with status: ${booking.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditExperienceBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        experienceDate, numberOfParticipants, numberOfChildren,
        specialRequests, status, paymentStatus, paymentMethod,
      } = req.body;

      const updated = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          ...(experienceDate       !== undefined && { experienceDate:       new Date(experienceDate) }),
          ...(numberOfParticipants !== undefined && { numberOfParticipants }),
          ...(numberOfChildren     !== undefined && { numberOfChildren }),
          ...(specialRequests      !== undefined && { specialRequests }),
          ...(status               !== undefined && { status }),
          ...(paymentStatus        !== undefined && { paymentStatus }),
          ...(paymentMethod        !== undefined && { paymentMethod }),
        },
        include: { experience: true },
      });

      redisService.client?.del(`travelplan:${booking.travelPlanId}`).catch(() => {});

      return res.json({ success: true, data: updated, message: "Booking updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/travel-plans/experiences/booking/:bookingId
   * BUG FIX: existence check before permission check; already-cancelled guard;
   * paymentStatus kept unchanged when not PAID (original set it to "PENDING").
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.experienceBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, paymentStatus: true, travelPlanId: true },
      });
      if (!booking)                       return notFound(res, "Booking not found");
      if (booking.status === "CANCELLED") return badRequest(res, "Booking is already cancelled");
      if (booking.status === "COMPLETED") return badRequest(res, "Cannot cancel a completed booking");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelExperienceBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this booking");

      const cancelled = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          status:        "CANCELLED",
          // BUG FIX: keep existing paymentStatus unless it was PAID → REFUNDED
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus,
        },
      });

      redisService.client?.del(`travelplan:${booking.travelPlanId}`).catch(() => {});

      return res.json({ success: true, data: cancelled, message: "Booking cancelled successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PUBLIC ====================

  /**
   * GET /api/experiences/vendor/:experienceId
   * Public experience detail page.
   */
  async getExperienceDetails(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.vendorExperience.findUnique({
        where:   { id: experienceId },
        include: {
          vendor: {
            select: {
              businessName:       true,
              overallRating:      true,
              verificationStatus: true, // BUG FIX: Vendor has no `totalReviews` scalar field
            },
          },
          reviews: {
            take:    5,
            orderBy: { createdAt: "desc" },
            include: {
              user: {
                select: { name: true, profile: { select: { profilePicture: true } } },
              },
            },
          },
          _count: { select: { bookings: true, reviews: true } },
        },
      });

      if (!experience || (!experience.isActive && !req.user?.isSuperAdmin)) {
        return notFound(res, "Experience not found");
      }

      return res.json({ success: true, data: experience });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REVIEWS ====================

  /**
   * POST /api/experiences/booking/:bookingId/review
   *
   * BUG FIX: ownership check previously used `booking.travelPlan.userId` which
   * required an extra `include: { travelPlan: true }` — replaced with a direct
   * TravelPlan.userId select query so we only fetch what we need.
   *
   * BUG FIX: vendor rating update is a non-critical side effect — moved to
   * fire-and-forget `Promise.allSettled` so a failed aggregation doesn't break
   * the review response.
   *
   * BUG FIX: `bookingType` is an enum on VendorReview — only valid if the
   * schema defines it. Removed to avoid accidental injection of an unknown field.
   */
  async addExperienceReview(req, res, next) {
    try {
      const { bookingId } = req.params;
      const { rating, comment } = req.body;

      if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
        return badRequest(res, "rating must be a number between 1 and 5");
      }

      const booking = await prisma.experienceBooking.findUnique({
        where:  { id: bookingId },
        select: {
          id: true, status: true,
          experienceId: true,
          experience:   { select: { vendorId: true } },
          travelPlan:   { select: { userId: true } },
        },
      });

      if (!booking) return notFound(res, "Booking not found");

      // Ownership: plan owner or superadmin
      if (booking.travelPlan.userId !== req.user.id && !req.user.isSuperAdmin) {
        return forbidden(res, "You can only review your own bookings");
      }

      if (booking.status !== "COMPLETED") {
        return badRequest(res, "You can only review completed experiences");
      }

      // Check for duplicate review
      const existing = await prisma.vendorReview.findFirst({
        where: { userId: req.user.id, bookingId: booking.id },
        select: { id: true },
      });
      if (existing) return res.status(409).json({ success: false, message: "You have already reviewed this booking" });

      const review = await prisma.vendorReview.create({
        data: {
          vendorId:           booking.experience.vendorId,
          userId:             req.user.id,
          rating,
          comment,
          bookingId:          booking.id,
          isVerifiedPurchase: true,
        },
      });

      // Update vendor aggregate rating — fire-and-forget (non-critical side effect)
      Promise.allSettled([
        prisma.vendorReview
          .aggregate({
            where: { vendorId: booking.experience.vendorId },
            _avg:  { rating: true },
            _count: true,
          })
          .then(({ _avg, _count }) =>
            prisma.vendor.update({
              where: { id: booking.experience.vendorId },
              data: {
                overallRating: +(_avg.rating ?? 0).toFixed(2),
                totalReviews:  _count,
              },
            })
          ),
      ]);

      return res.json({ success: true, data: review, message: "Review added successfully" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TravelerExperienceController();