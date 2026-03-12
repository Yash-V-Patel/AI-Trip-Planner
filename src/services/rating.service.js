"use strict";

/**
 * rating.service.js
 *
 * Centralised service for recomputing all cached rating/totalReviews fields
 * whenever a VendorReview is created, updated (including hidden/shown), or
 * deleted.
 *
 * ─── WHY CACHED FIELDS? ────────────────────────────────────────────────────
 *
 * Running a live AVG() aggregate on every list/detail request is expensive at
 * scale.  Instead we keep three denormalised columns always up-to-date:
 *
 *   VendorExperience.averageRating  / .totalReviews
 *   TravelPackage.averageRating     / .totalReviews
 *   Vendor.overallRating            / .totalReviews
 *
 * All three are Float/Int with a default of 0, so existing rows are safe
 * before migration.
 *
 * ─── DEFINITION ────────────────────────────────────────────────────────────
 *
 *   averageRating  = AVG(VendorReview.rating)
 *                    WHERE isHidden = false
 *                    AND   the FK column matches the parent ID
 *                    Rounded to 2 decimal places.
 *                    Returns 0.00 when there are no qualifying reviews.
 *
 *   totalReviews   = COUNT(*)  (same filter — only visible reviews)
 *
 * ─── WHEN TO CALL ──────────────────────────────────────────────────────────
 *
 *   Call the appropriate function after every operation that can change the
 *   visible review set for a listing:
 *
 *   ┌──────────────────────────────────┬─────────────────────────────────┐
 *   │ Event                            │ Call                            │
 *   ├──────────────────────────────────┼─────────────────────────────────┤
 *   │ VendorReview created             │ recomputeRatingsForReview(r)    │
 *   │ VendorReview.rating changed      │ recomputeRatingsForReview(r)    │
 *   │ VendorReview.isHidden toggled    │ recomputeRatingsForReview(r)    │
 *   │ VendorReview deleted             │ recomputeRatingsForReview(r)*   │
 *   └──────────────────────────────────┴─────────────────────────────────┘
 *
 *   * Pass the review object BEFORE deletion so the FK fields are still present.
 *
 * ─── INTEGRATION POINTS ────────────────────────────────────────────────────
 *
 *   traveler_experience_controller.js  → addExperienceReview (create)
 *   traveler_experience_controller.js  → updateReview        (rating change)
 *   traveler_experience_controller.js  → deleteReview        (before delete)
 *   vendor_controller.js              → respondToReview      (no rating change — skip)
 *   vendor_controller.js              → hideReview           (isHidden toggle)
 *   Any future review endpoint        → same pattern
 *
 * ─── FIRE-AND-FORGET vs AWAIT ──────────────────────────────────────────────
 *
 *   Use  recomputeRatingsForReview(review)  with  await  if you want the HTTP
 *   response to reflect the freshest value.
 *
 *   Use  recomputeRatingsForReviewAsync(review)  (fire-and-forget) when you
 *   want the response to be fast and can tolerate a brief stale cache window
 *   (typically < 100 ms on a local DB).
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Round to 2 decimal places, clamp to [0, 5].
 * VendorReview.rating is an Int 1-5 so AVG can never exceed 5, but clamping
 * guards against bad data.
 */
const roundRating = (raw) => Math.min(5, Math.max(0, Math.round((raw ?? 0) * 100) / 100));

// ─── per-listing recompute ────────────────────────────────────────────────────

/**
 * Recompute TravelPackage.averageRating and TravelPackage.totalReviews.
 *
 * Only counts non-hidden reviews linked directly to this package.
 * Safe to call if the packageId doesn't exist (Prisma will no-op the update).
 *
 * @param {string} packageId
 */
async function recomputePackageRating(packageId) {
  if (!packageId) return;

  const agg = await prisma.vendorReview.aggregate({
    where:   { travelPackageId: packageId, isHidden: false },
    _avg:    { rating: true },
    _count:  { rating: true },
  });

  await prisma.travelPackage.update({
    where: { id: packageId },
    data: {
      averageRating: roundRating(agg._avg.rating),
      totalReviews:  agg._count.rating,
    },
  });
}

/**
 * Recompute VendorExperience.averageRating and VendorExperience.totalReviews.
 *
 * Only counts non-hidden reviews linked directly to this experience.
 *
 * @param {string} experienceId
 */
async function recomputeExperienceRating(experienceId) {
  if (!experienceId) return;

  const agg = await prisma.vendorReview.aggregate({
    where:  { vendorExperienceId: experienceId, isHidden: false },
    _avg:   { rating: true },
    _count: { rating: true },
  });

  await prisma.vendorExperience.update({
    where: { id: experienceId },
    data: {
      averageRating: roundRating(agg._avg.rating),
      totalReviews:  agg._count.rating,
    },
  });
}

/**
 * Recompute Vendor.overallRating and Vendor.totalReviews.
 *
 * overallRating = average across ALL non-hidden reviews for this vendor,
 *                 regardless of which listing type they belong to.
 * totalReviews  = count of all non-hidden reviews for this vendor.
 *
 * This gives a single vendor-level quality score visible on search cards and
 * the vendor profile page.
 *
 * @param {string} vendorId
 */
async function recomputeVendorRating(vendorId) {
  if (!vendorId) return;

  const agg = await prisma.vendorReview.aggregate({
    where:  { vendorId, isHidden: false },
    _avg:   { rating: true },
    _count: { rating: true },
  });

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      overallRating: roundRating(agg._avg.rating),
      totalReviews:  agg._count.rating,
    },
  });
}

// ─── main entry point ─────────────────────────────────────────────────────────

/**
 * Master recompute function — call this after ANY review create/update/delete.
 *
 * Determines which listings are affected from the review object and fires
 * all necessary recomputes in parallel.
 *
 * Usage — create/update:
 *   const review = await prisma.vendorReview.create({ data: { ... } });
 *   await ratingService.recomputeRatingsForReview(review);
 *
 * Usage — delete (pass the review BEFORE deleting it):
 *   const review = await prisma.vendorReview.findUnique({ where: { id } });
 *   await prisma.vendorReview.delete({ where: { id } });
 *   await ratingService.recomputeRatingsForReview(review);
 *
 * @param {{ vendorId: string, travelPackageId?: string|null, vendorExperienceId?: string|null }} review
 */
async function recomputeRatingsForReview(review) {
  if (!review?.vendorId) return;

  const tasks = [
    recomputeVendorRating(review.vendorId),
  ];

  if (review.travelPackageId) {
    tasks.push(recomputePackageRating(review.travelPackageId));
  }

  if (review.vendorExperienceId) {
    tasks.push(recomputeExperienceRating(review.vendorExperienceId));
  }

  // Run all recomputes concurrently — each is a read + one write, no conflicts
  await Promise.all(tasks);
}

/**
 * Fire-and-forget wrapper around recomputeRatingsForReview.
 * Use when you want the HTTP response to be fast and a brief stale window is
 * acceptable (usually < 100 ms).
 *
 * Errors are silently swallowed so they can't crash the parent request.
 *
 * @param {{ vendorId: string, travelPackageId?: string|null, vendorExperienceId?: string|null }} review
 */
function recomputeRatingsForReviewAsync(review) {
  recomputeRatingsForReview(review).catch((err) => {
    console.error("[RatingService] background recompute failed:", err?.message ?? err);
  });
}

// ─── bulk backfill (run once after migration) ─────────────────────────────────

/**
 * Backfill all cached rating fields for every vendor, package, and experience.
 *
 * Run this ONCE immediately after applying the migration that adds the new
 * columns.  All existing rows will have averageRating = 0, totalReviews = 0
 * until this runs.
 *
 * Usage (from a one-off script or a migration seed):
 *   const { backfillAllRatings } = require('./services/rating.service');
 *   await backfillAllRatings();
 *
 * Safe to re-run — it is idempotent.
 */
async function backfillAllRatings() {
  console.log("[RatingService] Starting full backfill…");

  // ── Vendors ──
  const vendors = await prisma.vendor.findMany({ select: { id: true } });
  for (const v of vendors) {
    await recomputeVendorRating(v.id);
  }
  console.log(`[RatingService] Recomputed ${vendors.length} vendor ratings`);

  // ── Travel Packages ──
  const packages = await prisma.travelPackage.findMany({ select: { id: true } });
  for (const p of packages) {
    await recomputePackageRating(p.id);
  }
  console.log(`[RatingService] Recomputed ${packages.length} package ratings`);

  // ── Vendor Experiences ──
  const experiences = await prisma.vendorExperience.findMany({ select: { id: true } });
  for (const e of experiences) {
    await recomputeExperienceRating(e.id);
  }
  console.log(`[RatingService] Recomputed ${experiences.length} experience ratings`);

  console.log("[RatingService] Backfill complete ✓");
}

// ─── exports ──────────────────────────────────────────────────────────────────

module.exports = {
  recomputeRatingsForReview,
  recomputeRatingsForReviewAsync,
  recomputePackageRating,
  recomputeExperienceRating,
  recomputeVendorRating,
  backfillAllRatings,
};
