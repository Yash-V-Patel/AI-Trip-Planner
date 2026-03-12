"use strict";

/**
 * ai_agent.controller.js  (fixed)
 *
 * All bugs from audit report resolved:
 *   - collaborators include removed (OpenFGA-only, no DB relation)
 *   - packageBookings → travelPackageBookings
 *   - shareTravelPlan → openfgaService (no TravelPlanCollaborator model)
 *   - Accommodation: type → accommodationType everywhere
 *   - AccommodationRoom: name→roomNumber, type→roomType, pricePerNight→basePrice, amenities→roomAmenities
 *   - AccommodationService: type → category
 *   - bookAccommodation: added required fields (guestName, guestEmail, pricePerNight, totalCost, roomType)
 *   - TransportationProvider: type → providerType everywhere
 *   - TransportationVehicle: type → vehicleType everywhere
 *   - bookTransportation: added serviceType (required), fixed snapshotVehicleNumber → vehicleNumber
 *   - VendorExperience: maxGroupSize → maxParticipants, duration → durationHours
 *   - bookExperience: added unitPrice / leadGuestName / leadGuestEmail
 *   - TravelPackage: price → basePrice, rating → averageRating, inclusions → includes
 *   - bookTravelPackage: added basePrice / leadGuestName / leadGuestEmail
 *   - addShoppingVisit: plannedDate null fallback → new Date()
 *   - TravelStyle z.enum: corrected to match schema enum values
 *   - searchRetailStores: category z.enum replaced with storeType (RetailStoreType enum)
 *   - All spurious userId fields removed from booking data objects
 *     (userId is NOT on any booking model yet — see schema notes below)
 */

const { ChatXAI } = require("@langchain/xai");
const { tool }    = require("@langchain/core/tools");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { z }              = require("zod");
const { PrismaClient }   = require("@prisma/client");
const redisService       = require("../services/redis.service");
const openfgaService     = require("../services/openfga.service");

const prisma = new PrismaClient();

// ─── constants ────────────────────────────────────────────────────────────────
const SESSION_TTL_SECONDS  = 60 * 60 * 24;
const MAX_HISTORY_MESSAGES = 40;
const MAX_AGENT_ITERATIONS = 10;
const SESSION_KEY         = (userId, sessionId) => `ai_agent:session:${userId}:${sessionId}`;
const SESSIONS_INDEX_KEY  = (userId) => `ai_agent:sessions:${userId}`;

// ─── helpers ──────────────────────────────────────────────────────────────────
const notFound   = (res, msg = "Not found")   => res.status(404).json({ success: false, message: msg });
const badRequest = (res, msg = "Bad request") => res.status(400).json({ success: false, message: msg });

// ─── LLM instantiation ────────────────────────────────────────────────────────
let _llm = null;
const getLLM = () => {
  if (!_llm) {
    _llm = new ChatXAI({
      model:       process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning",
      apiKey:      process.env.XAI_API_KEY,
      temperature: 0.3,
      maxTokens:   600,
    });
  }
  return _llm;
};

// ─── system prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are TripAI, a friendly and knowledgeable travel assistant for an AI-Trip-planner platform.

You help users with:
1. **Planning trips** — creating and organizing travel plans with destinations, dates, and budgets
2. **Finding & booking accommodations** — hotels, hostels, apartments, resorts
3. **Arranging transportation** — cars, buses, boats, private transfers
4. **Discovering experiences** — tours, activities, adventures, cultural events
5. **Travel packages** — all-inclusive packages that bundle multiple services
6. **Shopping** — local retail stores and markets to visit during trips
7. **Becoming a vendor** — guiding users who want to list their own services

GUIDELINES:
- Always be concise, warm, and proactive — anticipate what the user needs next
- When a user mentions a destination, proactively offer to search accommodations, transport, and experiences
- When creating a travel plan, always confirm destination, dates, and rough budget first
- After a booking, summarize what was added and suggest what to plan next
- If a search returns no results, suggest broadening the criteria
- Never invent data — only use information returned by your tools
- For vendor-related questions, walk the user through the application process step-by-step
- Format responses with markdown for readability (bold for labels, bullet lists for options)
- If the user wants to update or delete something, confirm before calling the tool

PLATFORM CONTEXT:
- Travel plans are the central container — all bookings live inside a plan
- Users can collaborate on plans (viewer / suggester / editor roles)
- Vendors must be verified before their listings appear publicly
- Bookings are not charged through this assistant — they create records the user can confirm and pay for in the app`;

// ─────────────────────────────────────────────────────────────────────────────
//  TOOL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

function buildTools(userId, isSuperAdmin) {

  // ── Travel Plan tools ───────────────────────────────────────────────────────

  const getUserTravelPlans = tool(
    async ({ limit, status }) => {
      const where = { userId };
      if (status) where.status = status;

      const plans = await prisma.travelPlan.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id:          true,
          title:       true,
          destination: true,
          startDate:   true,
          endDate:     true,
          status:      true,
          budget:      true,
          createdAt:   true,
          _count: {
            select: {
              accommodations:        true,
              transportServices:     true,
              experienceBookings:    true,
              travelPackageBookings: true,
            },
          },
        },
      });

      if (!plans.length) return { found: false, message: "No travel plans found." };
      return { found: true, count: plans.length, plans };
    },
    {
      name:        "getUserTravelPlans",
      description: "Retrieve the current user's travel plans. Use this to list existing plans before creating a new one.",
      schema: z.object({
        limit:  z.number().optional().default(10),
        status: z.enum(["PLANNING", "ONGOING", "COMPLETED", "CANCELLED"]).optional(),
      }),
    },
  );

  const getTravelPlanDetails = tool(
    async ({ travelPlanId }) => {
      const plan = await prisma.travelPlan.findFirst({
        where: { id: travelPlanId, userId },
        include: {
          accommodations:    { include: { accommodation: { select: { id: true, name: true, city: true } } } },
          // FIX: providerType (not type)
          transportServices: { include: { provider: { select: { id: true, name: true, providerType: true } } } },
          experiences:       true,
          experienceBookings: { include: { experience: { select: { id: true, name: true, location: true } } } },
          // FIX: travelPackageBookings (not packageBookings)
          travelPackageBookings: { include: { package: { select: { id: true, name: true } } } },
          shoppingVisits:    { include: { store: { select: { id: true, name: true, city: true } } } },
          // REMOVED: collaborators — sharing is OpenFGA-only, no collaborators relation on TravelPlan
        },
      });

      if (!plan) return { found: false, message: "Travel plan not found or you don't have access." };
      return { found: true, plan };
    },
    {
      name:        "getTravelPlanDetails",
      description: "Get full details of a specific travel plan including all bookings.",
      schema: z.object({ travelPlanId: z.string() }),
    },
  );

  const createTravelPlan = tool(
    async ({ title, destination, startDate, endDate, budget, description, currency, numberOfTravelers, travelStyle }) => {
      const plan = await prisma.travelPlan.create({
        data: {
          userId,
          title,
          destination,
          startDate:         startDate ? new Date(startDate) : null,
          endDate:           endDate   ? new Date(endDate)   : null,
          budget:            budget    ? parseFloat(budget)  : null,
          description:       description || null,
          currency:          currency || "USD",
          numberOfTravelers: numberOfTravelers || 1,
          ...(travelStyle ? { travelStyle } : {}),
          status: "PLANNING",
        },
        select: {
          id: true, title: true, destination: true,
          startDate: true, endDate: true, budget: true, status: true,
        },
      });

      return { success: true, message: `Travel plan "${title}" created successfully!`, plan };
    },
    {
      name:        "createTravelPlan",
      description: "Create a new travel plan for the user. Always confirm destination and dates with the user before calling this.",
      schema: z.object({
        title:             z.string(),
        destination:       z.string(),
        startDate:         z.string().optional().describe("YYYY-MM-DD"),
        endDate:           z.string().optional().describe("YYYY-MM-DD"),
        budget:            z.string().optional(),
        description:       z.string().optional(),
        currency:          z.string().optional().default("USD"),
        numberOfTravelers: z.number().optional().default(1),
        // FIX: correct TravelStyle enum values from schema
        travelStyle: z.enum([
          "LUXURY", "BUDGET", "ADVENTURE", "RELAXATION",
          "CULTURAL", "BUSINESS", "FAMILY_FRIENDLY", "BACKPACKING",
        ]).optional(),
      }),
    },
  );

  const updateTravelPlan = tool(
    async ({ travelPlanId, ...updates }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found or you don't have permission to edit it." };

      const data = {};
      if (updates.title)             data.title             = updates.title;
      if (updates.destination)       data.destination       = updates.destination;
      if (updates.startDate)         data.startDate         = new Date(updates.startDate);
      if (updates.endDate)           data.endDate           = new Date(updates.endDate);
      if (updates.budget !== undefined) data.budget         = parseFloat(updates.budget);
      if (updates.description)       data.description       = updates.description;
      if (updates.status)            data.status            = updates.status;
      if (updates.numberOfTravelers) data.numberOfTravelers = updates.numberOfTravelers;

      const updated = await prisma.travelPlan.update({
        where:  { id: travelPlanId },
        data,
        select: { id: true, title: true, destination: true, startDate: true, endDate: true, budget: true, status: true },
      });
      return { success: true, message: "Travel plan updated.", plan: updated };
    },
    {
      name:        "updateTravelPlan",
      description: "Update an existing travel plan's details.",
      schema: z.object({
        travelPlanId:      z.string(),
        title:             z.string().optional(),
        destination:       z.string().optional(),
        startDate:         z.string().optional(),
        endDate:           z.string().optional(),
        budget:            z.string().optional(),
        description:       z.string().optional(),
        status:            z.enum(["PLANNING", "ONGOING", "COMPLETED", "CANCELLED"]).optional(),
        numberOfTravelers: z.number().optional(),
      }),
    },
  );

  const deleteTravelPlan = tool(
    async ({ travelPlanId }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true, title: true } });
      if (!plan) return { success: false, message: "Travel plan not found or you don't have permission." };

      await prisma.travelPlan.delete({ where: { id: travelPlanId } });
      return { success: true, message: `Travel plan "${plan.title}" has been deleted.` };
    },
    {
      name:        "deleteTravelPlan",
      description: "Permanently delete a travel plan and all its bookings. ONLY call after explicit user confirmation.",
      schema: z.object({ travelPlanId: z.string() }),
    },
  );

  const shareTravelPlan = tool(
    async ({ travelPlanId, collaboratorEmail, role }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found or you don't have permission to share it." };

      const collaborator = await prisma.user.findUnique({ where: { email: collaboratorEmail }, select: { id: true, name: true } });
      if (!collaborator) return { success: false, message: `No user found with email ${collaboratorEmail}.` };

      // FIX: sharing is OpenFGA-only — TravelPlanCollaborator model does not exist in the schema
      const relationMap = { VIEWER: "viewer", SUGGESTER: "suggester", EDITOR: "editor" };
      await openfgaService.shareTravelPlan(travelPlanId, collaborator.id, relationMap[role]);

      return { success: true, message: `Shared with ${collaborator.name || collaboratorEmail} as ${role}.` };
    },
    {
      name:        "shareTravelPlan",
      description: "Share a travel plan with another user by their email address.",
      schema: z.object({
        travelPlanId:      z.string(),
        collaboratorEmail: z.string().email(),
        role:              z.enum(["VIEWER", "SUGGESTER", "EDITOR"]),
      }),
    },
  );

  // ── Accommodation tools ─────────────────────────────────────────────────────

  const searchAccommodations = tool(
    async ({ city, country, priceCategory, type, limit }) => {
      const where = { isActive: true };
      if (city)          where.city              = { contains: city,    mode: "insensitive" };
      if (country)       where.country           = { contains: country, mode: "insensitive" };
      if (priceCategory) where.priceCategory     = priceCategory;
      // FIX: accommodationType (not type)
      if (type)          where.accommodationType = type;

      const accommodations = await prisma.accommodation.findMany({
        where,
        take: limit,
        orderBy: { starRating: "desc" },
        select: {
          id:                true,
          name:              true,
          // FIX: accommodationType (not type)
          accommodationType: true,
          city:              true,
          country:           true,
          address:           true,
          starRating:        true,
          priceCategory:     true,
          description:       true,
          amenities:         true,
          checkInTime:       true,
          checkOutTime:      true,
          isVerified:        true,
          vendor:            { select: { businessName: true, overallRating: true } },
          _count:            { select: { rooms: true } },
        },
      });

      if (!accommodations.length) return { found: false, message: `No accommodations found in ${city || country || "that location"}.` };
      return { found: true, count: accommodations.length, accommodations };
    },
    {
      name:        "searchAccommodations",
      description: "Search for hotels, hostels, apartments, and other accommodations by location.",
      schema: z.object({
        city:          z.string().optional(),
        country:       z.string().optional(),
        priceCategory: z.enum(["BUDGET", "MIDRANGE", "LUXURY", "BOUTIQUE"]).optional(),
        // FIX: correct AccommodationType enum values from schema
        type: z.enum([
          "HOTEL", "RESORT", "MOTEL", "HOSTEL",
          "BED_BREAKFAST", "VACATION_RENTAL", "APARTMENT", "GUEST_HOUSE",
        ]).optional(),
        limit: z.number().optional().default(8),
      }),
    },
  );

  const getAccommodationDetails = tool(
    async ({ accommodationId }) => {
      const acc = await prisma.accommodation.findFirst({
        where: { id: accommodationId, isActive: true },
        include: {
          rooms: {
            where: { isAvailable: true },
            select: {
              id:            true,
              // FIX: correct AccommodationRoom field names
              roomNumber:    true,
              roomType:      true,
              basePrice:     true,
              maxOccupancy:  true,
              roomAmenities: true,
            },
          },
          services: {
            select: {
              id:          true,
              name:        true,
              // FIX: category (ServiceCategory enum), not type
              category:    true,
              price:       true,
              isIncluded:  true,
              description: true,
            },
          },
          vendor: { select: { businessName: true, overallRating: true, totalReviews: true } },
        },
      });

      if (!acc) return { found: false, message: "Accommodation not found." };
      return { found: true, accommodation: acc };
    },
    {
      name:        "getAccommodationDetails",
      description: "Get full details of an accommodation including available rooms and services.",
      schema: z.object({ accommodationId: z.string() }),
    },
  );

  const bookAccommodation = tool(
    async ({ travelPlanId, accommodationId, roomIds, checkInDate, checkOutDate, numberOfGuests, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const acc = await prisma.accommodation.findFirst({ where: { id: accommodationId, isActive: true }, select: { id: true, name: true } });
      if (!acc) return { success: false, message: "Accommodation not found or not available." };

      // Fetch user for guest details (guestName / guestEmail are required fields)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

      // Derive pricePerNight and roomType from the first selected room
      let pricePerNight = 0;
      let roomType      = "SINGLE";
      if (roomIds?.length) {
        const room = await prisma.accommodationRoom.findFirst({
          where:  { id: roomIds[0] },
          select: { basePrice: true, roomType: true },
        });
        if (room) { pricePerNight = room.basePrice; roomType = room.roomType; }
      }

      const checkIn   = new Date(checkInDate);
      const checkOut  = new Date(checkOutDate);
      const nights    = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
      const totalCost = +(pricePerNight * nights).toFixed(2);

      const booking = await prisma.accommodationBooking.create({
        data: {
          travelPlanId,
          accommodationId,
          checkInDate:     checkIn,
          checkOutDate:    checkOut,
          bookingStatus:   "PENDING",
          // Required fields derived from user + room data
          guestName:       user?.name  || "Guest",
          guestEmail:      user?.email || "",
          pricePerNight,
          totalCost,
          roomType,
          totalGuests:     numberOfGuests || 1,
          specialRequests: specialRequests || null,
          ...(roomIds?.length ? { rooms: { connect: roomIds.map((id) => ({ id })) } } : {}),
        },
        select: { id: true, checkInDate: true, checkOutDate: true, bookingStatus: true },
      });

      return { success: true, message: `"${acc.name}" booked for ${nights} night(s)!`, booking };
    },
    {
      name:        "bookAccommodation",
      description: "Add an accommodation booking to a travel plan. Call getAccommodationDetails first to get room IDs.",
      schema: z.object({
        travelPlanId:    z.string(),
        accommodationId: z.string(),
        roomIds:         z.array(z.string()).optional().describe("Specific room IDs from getAccommodationDetails"),
        checkInDate:     z.string().describe("YYYY-MM-DD"),
        checkOutDate:    z.string().describe("YYYY-MM-DD"),
        numberOfGuests:  z.number().optional().default(1),
        specialRequests: z.string().optional(),
      }),
    },
  );

  // ── Transportation tools ────────────────────────────────────────────────────

  const searchTransportation = tool(
    async ({ city, country, type, limit }) => {
      const where = { isAvailable: true };
      if (city)    where.city         = { contains: city,    mode: "insensitive" };
      if (country) where.country      = { contains: country, mode: "insensitive" };
      // FIX: providerType (not type)
      if (type)    where.providerType = type;

      const providers = await prisma.transportationProvider.findMany({
        where,
        take: limit,
        select: {
          id:           true,
          name:         true,
          // FIX: providerType (not type)
          providerType: true,
          city:         true,
          country:      true,
          description:  true,
          rating:       true,
          baseFare:     true,
          perKmRate:    true,
          vendor:       { select: { businessName: true } },
          _count:       { select: { vehicles: true } },
        },
      });

      if (!providers.length) return { found: false, message: `No transportation providers found in ${city || country || "that area"}.` };
      return { found: true, count: providers.length, providers };
    },
    {
      name:        "searchTransportation",
      description: "Search for transportation providers (car rentals, taxi services, bus companies, etc.) by location.",
      schema: z.object({
        city:    z.string().optional(),
        country: z.string().optional(),
        // FIX: correct TransportationProviderType enum values from schema
        type: z.enum([
          "TAXI_SERVICE", "RIDE_SHARING", "CAR_RENTAL", "BUS_COMPANY",
          "TRAIN_SERVICE", "AIRLINE", "FERRY_SERVICE", "BICYCLE_RENTAL", "OTHER",
        ]).optional(),
        limit: z.number().optional().default(8),
      }),
    },
  );

  const getTransportationDetails = tool(
    async ({ providerId }) => {
      const provider = await prisma.transportationProvider.findFirst({
        where: { id: providerId, isAvailable: true },
        include: {
          vehicles: {
            where: { isAvailable: true },
            select: {
              id:          true,
              // FIX: vehicleType (not type)
              vehicleType: true,
              vehicleNumber: true,
              make:        true,
              model:       true,
              capacity:    true,
              pricePerDay: true,
              pricePerKm:  true,
              features:    true,
              amenities:   true,
            },
          },
          vendor: { select: { businessName: true, overallRating: true } },
        },
      });

      if (!provider) return { found: false, message: "Transportation provider not found." };
      return { found: true, provider };
    },
    {
      name:        "getTransportationDetails",
      description: "Get full details of a transportation provider including available vehicles.",
      schema: z.object({ providerId: z.string() }),
    },
  );

  const bookTransportation = tool(
    async ({ travelPlanId, vehicleId, serviceType, pickupTime, pickupLocation, dropoffLocation, numberOfPassengers, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const vehicle = await prisma.transportationVehicle.findFirst({
        where:   { id: vehicleId, isAvailable: true },
        include: { provider: { select: { id: true, name: true } } },
      });
      if (!vehicle) return { success: false, message: "Vehicle not found or not available." };

      const booking = await prisma.transportationBooking.create({
        data: {
          travelPlanId,
          vehicleId,
          providerId:          vehicle.provider.id,
          // FIX: serviceType is a required non-nullable field on TransportationBooking
          serviceType,
          pickupTime:          new Date(pickupTime),
          pickupLocation,
          dropoffLocation,
          numberOfPassengers:  numberOfPassengers || 1,
          specialRequests:     specialRequests || null,
          status:              "BOOKED",
          // FIX: vehicle.vehicleType (not vehicle.type)
          snapshotVehicleType:   vehicle.vehicleType,
          // FIX: vehicleNumber is the internal fleet snapshot ID (not licensePlate)
          snapshotVehicleNumber: vehicle.vehicleNumber || null,
        },
        select: { id: true, pickupTime: true, status: true },
      });

      return { success: true, message: `Transportation with "${vehicle.provider.name}" added to your plan!`, booking };
    },
    {
      name:        "bookTransportation",
      description: "Add a transportation booking to a travel plan. Call getTransportationDetails first to get a vehicleId.",
      schema: z.object({
        travelPlanId:       z.string(),
        vehicleId:          z.string().describe("Vehicle ID from getTransportationDetails"),
        // FIX: serviceType is required in TransportationBooking schema
        serviceType: z.enum([
          "TAXI", "BUS", "TRAIN", "FLIGHT",
          "FERRY", "CAR_RENTAL", "BICYCLE", "WALKING", "OTHER",
        ]).describe("Type of transportation service"),
        pickupTime:         z.string().describe("Pickup datetime ISO format"),
        pickupLocation:     z.string().describe("Pickup address or landmark"),
        dropoffLocation:    z.string().describe("Drop-off address or landmark"),
        numberOfPassengers: z.number().optional().default(1),
        specialRequests:    z.string().optional(),
      }),
    },
  );

  // ── Experience tools ────────────────────────────────────────────────────────

  const searchExperiences = tool(
    async ({ location, city, country, category, maxPrice, limit }) => {
      const where = { isActive: true };
      if (city)     where.city           = { contains: city,     mode: "insensitive" };
      if (country)  where.country        = { contains: country,  mode: "insensitive" };
      if (location) where.location       = { contains: location, mode: "insensitive" };
      if (category) where.category       = category;
      if (maxPrice) where.pricePerPerson = { lte: parseFloat(maxPrice) };

      const experiences = await prisma.vendorExperience.findMany({
        where,
        take: limit,
        orderBy: { averageRating: "desc" },
        select: {
          id:              true,
          name:            true,
          category:        true,
          location:        true,
          city:            true,
          country:         true,
          description:     true,
          pricePerPerson:  true,
          // FIX: durationHours (not duration — schema field is durationHours Float)
          durationHours:   true,
          // FIX: maxParticipants (not maxGroupSize)
          maxParticipants: true,
          averageRating:   true,
          languages:       true,
          vendor:          { select: { businessName: true } },
        },
      });

      if (!experiences.length) return { found: false, message: `No experiences found in ${city || location || "that area"}.` };
      return { found: true, count: experiences.length, experiences };
    },
    {
      name:        "searchExperiences",
      description: "Search for vendor-hosted experiences — tours, activities, cultural events, adventures.",
      schema: z.object({
        location: z.string().optional(),
        city:     z.string().optional(),
        country:  z.string().optional(),
        category: z.enum(["TOUR", "ADVENTURE", "CULTURAL", "FOOD_DRINK", "WELLNESS", "SPORTS", "ENTERTAINMENT", "WORKSHOP", "OTHER"]).optional(),
        maxPrice: z.string().optional(),
        limit:    z.number().optional().default(8),
      }),
    },
  );

  const getExperienceDetails = tool(
    async ({ experienceId }) => {
      const exp = await prisma.vendorExperience.findFirst({
        where: { id: experienceId, isActive: true },
        include: {
          vendor:  { select: { businessName: true, overallRating: true } },
          reviews: { take: 3, orderBy: { createdAt: "desc" }, select: { rating: true, comment: true, createdAt: true } },
        },
      });

      if (!exp) return { found: false, message: "Experience not found." };
      return { found: true, experience: exp };
    },
    {
      name:        "getExperienceDetails",
      description: "Get full details of a vendor experience including pricing, availability, and recent reviews.",
      schema: z.object({ experienceId: z.string() }),
    },
  );

  const bookExperience = tool(
    async ({ travelPlanId, experienceId, experienceDate, numberOfParticipants, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const exp = await prisma.vendorExperience.findFirst({
        where:  { id: experienceId, isActive: true },
        // FIX: maxParticipants (not maxGroupSize — no such field on VendorExperience)
        select: { id: true, name: true, pricePerPerson: true, maxParticipants: true },
      });
      if (!exp) return { success: false, message: "Experience not found." };

      // FIX: maxParticipants (not maxGroupSize)
      if (exp.maxParticipants && numberOfParticipants > exp.maxParticipants) {
        return { success: false, message: `This experience has a maximum of ${exp.maxParticipants} participants.` };
      }

      // Fetch user for lead guest details (required non-nullable fields on ExperienceBooking)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

      const unitPrice   = exp.pricePerPerson ?? 0;
      const totalAmount = +(unitPrice * numberOfParticipants).toFixed(2);

      const booking = await prisma.experienceBooking.create({
        data: {
          travelPlanId,
          experienceId,
          // REMOVED: userId — ExperienceBooking has no userId column in current schema
          experienceDate:       new Date(experienceDate),
          numberOfParticipants,
          // FIX: unitPrice is required non-nullable on ExperienceBooking
          unitPrice,
          totalAmount,
          // FIX: leadGuestName / leadGuestEmail are required non-nullable fields
          leadGuestName:        user?.name  || "Guest",
          leadGuestEmail:       user?.email || "",
          specialRequests:      specialRequests || null,
          status:               "PENDING",
        },
        select: { id: true, experienceDate: true, numberOfParticipants: true, totalAmount: true, status: true },
      });

      return { success: true, message: `Experience "${exp.name}" added! Total: $${totalAmount}.`, booking };
    },
    {
      name:        "bookExperience",
      description: "Add a vendor experience booking to a travel plan.",
      schema: z.object({
        travelPlanId:         z.string(),
        experienceId:         z.string(),
        experienceDate:       z.string().describe("YYYY-MM-DD"),
        numberOfParticipants: z.number().default(1),
        specialRequests:      z.string().optional(),
      }),
    },
  );

  // ── Travel Package tools ────────────────────────────────────────────────────

  const searchTravelPackages = tool(
    async ({ destination, maxBudget, durationDays, limit }) => {
      const where = { isActive: true };
      if (destination)  where.destinations = { has: destination };
      // FIX: basePrice (not price — TravelPackage has no price field)
      if (maxBudget)    where.basePrice    = { lte: parseFloat(maxBudget) };
      if (durationDays) where.durationDays = { lte: durationDays };

      const packages = await prisma.travelPackage.findMany({
        where,
        take: limit,
        // FIX: averageRating (not rating — TravelPackage has no rating field)
        orderBy: { averageRating: "desc" },
        select: {
          id:           true,
          name:         true,
          destinations: true,
          description:  true,
          // FIX: basePrice (not price)
          basePrice:    true,
          discount:     true,
          durationDays: true,
          maxTravelers: true,
          // FIX: averageRating (not rating)
          averageRating: true,
          totalReviews:  true,
          // FIX: includes (not inclusions — schema field is includes Json?)
          includes:     true,
          currency:     true,
          vendor:       { select: { businessName: true } },
        },
      });

      if (!packages.length) return { found: false, message: `No travel packages found for ${destination || "that destination"}.` };
      return { found: true, count: packages.length, packages };
    },
    {
      name:        "searchTravelPackages",
      description: "Search for all-inclusive travel packages by destination, budget, or duration.",
      schema: z.object({
        destination:  z.string().optional(),
        maxBudget:    z.string().optional().describe("Maximum package base price"),
        durationDays: z.number().optional(),
        limit:        z.number().optional().default(8),
      }),
    },
  );

  const getTravelPackageDetails = tool(
    async ({ packageId }) => {
      const pkg = await prisma.travelPackage.findFirst({
        where:   { id: packageId, isActive: true },
        include: { vendor: { select: { businessName: true, overallRating: true } } },
      });

      if (!pkg) return { found: false, message: "Package not found." };
      return { found: true, package: pkg };
    },
    {
      name:        "getTravelPackageDetails",
      description: "Get full details of a travel package including inclusions, pricing, and duration.",
      schema: z.object({ packageId: z.string() }),
    },
  );

  const bookTravelPackage = tool(
    async ({ travelPlanId, packageId, startDate, numberOfTravelers, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const pkg = await prisma.travelPackage.findFirst({
        where:  { id: packageId, isActive: true },
        // FIX: basePrice (not price)
        select: { id: true, name: true, basePrice: true, discount: true, durationDays: true, maxTravelers: true },
      });
      if (!pkg) return { success: false, message: "Package not found." };

      if (pkg.maxTravelers && numberOfTravelers > pkg.maxTravelers) {
        return { success: false, message: `This package has a maximum of ${pkg.maxTravelers} travelers.` };
      }

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + (pkg.durationDays || 0));

      // FIX: use basePrice (not pkg.price which was always undefined → $0)
      const discountFactor = pkg.discount ? 1 - pkg.discount / 100 : 1;
      const finalAmount    = +(pkg.basePrice * discountFactor * numberOfTravelers).toFixed(2);

      // Fetch user for lead guest details (required non-nullable fields on TravelPackageBooking)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

      const booking = await prisma.travelPackageBooking.create({
        data: {
          travelPlanId,
          packageId,
          // REMOVED: userId — TravelPackageBooking has no userId column in current schema
          startDate:       new Date(startDate),
          endDate,
          numberOfTravelers,
          // FIX: basePrice / leadGuestName / leadGuestEmail are required non-nullable fields
          basePrice:       pkg.basePrice,
          discount:        pkg.discount ?? 0,
          finalAmount,
          leadGuestName:   user?.name  || "Guest",
          leadGuestEmail:  user?.email || "",
          specialRequests: specialRequests || null,
          status:          "PENDING",
        },
        select: { id: true, startDate: true, endDate: true, finalAmount: true, status: true },
      });

      return { success: true, message: `Package "${pkg.name}" added! Total: $${finalAmount}.`, booking };
    },
    {
      name:        "bookTravelPackage",
      description: "Add a travel package booking to a travel plan.",
      schema: z.object({
        travelPlanId:      z.string(),
        packageId:         z.string(),
        startDate:         z.string().describe("YYYY-MM-DD"),
        numberOfTravelers: z.number().default(1),
        specialRequests:   z.string().optional(),
      }),
    },
  );

  // ── Retail / Shopping tools ─────────────────────────────────────────────────

  const searchRetailStores = tool(
    async ({ city, country, storeType, priceRange, limit }) => {
      const where = { isActive: true };
      if (city)       where.city       = { contains: city,    mode: "insensitive" };
      if (country)    where.country    = { contains: country, mode: "insensitive" };
      // FIX: filter on storeType (RetailStoreType enum) — the old 'category' filter used wrong enum values
      if (storeType)  where.storeType  = storeType;
      if (priceRange) where.priceRange = priceRange;

      const stores = await prisma.retailStore.findMany({
        where,
        take: limit,
        orderBy: { rating: "desc" },
        select: {
          id:           true,
          name:         true,
          storeType:    true,
          category:     true,
          city:         true,
          country:      true,
          address:      true,
          description:  true,
          priceRange:   true,
          rating:       true,
          openingHours: true,
          vendor:       { select: { businessName: true } },
        },
      });

      if (!stores.length) return { found: false, message: `No stores found in ${city || country || "that area"}.` };
      return { found: true, count: stores.length, stores };
    },
    {
      name:        "searchRetailStores",
      description: "Search for retail stores, markets, and shops to visit during a trip.",
      schema: z.object({
        city:    z.string().optional(),
        country: z.string().optional(),
        // FIX: RetailStoreType enum values from schema (replaced wrong free-text category enum)
        storeType: z.enum([
          "SHOPPING_MALL", "DEPARTMENT_STORE", "BOUTIQUE", "SOUVENIR_SHOP",
          "ELECTRONICS", "BOOKSTORE", "SUPERMARKET", "OTHER",
        ]).optional(),
        priceRange: z.enum(["BUDGET", "MODERATE", "EXPENSIVE", "LUXURY"]).optional(),
        limit:      z.number().optional().default(8),
      }),
    },
  );

  const addShoppingVisit = tool(
    async ({ travelPlanId, storeId, plannedDate, notes }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const store = await prisma.retailStore.findFirst({ where: { id: storeId, isActive: true }, select: { id: true, name: true } });
      if (!store) return { success: false, message: "Store not found." };

      const visit = await prisma.shoppingVisit.create({
        data: {
          travelPlanId,
          storeId,
          // REMOVED: userId — ShoppingVisit has no userId column in current schema
          // FIX: plannedDate is NOT NULL in schema — never pass null, default to today
          plannedDate: plannedDate ? new Date(plannedDate) : new Date(),
          notes:       notes || null,
          status:      "PLANNED",
        },
        select: { id: true, plannedDate: true, status: true },
      });

      return { success: true, message: `Shopping visit to "${store.name}" added to your plan!`, visit };
    },
    {
      name:        "addShoppingVisit",
      description: "Add a retail store visit to a travel plan.",
      schema: z.object({
        travelPlanId: z.string(),
        storeId:      z.string(),
        plannedDate:  z.string().optional().describe("YYYY-MM-DD. Defaults to today if omitted."),
        notes:        z.string().optional(),
      }),
    },
  );

  // ── Vendor application tools ────────────────────────────────────────────────

  const getVendorApplicationStatus = tool(
    async () => {
      const application = await prisma.vendorApplication.findFirst({
        where:   { userId },
        orderBy: { createdAt: "desc" },
        select:  { id: true, status: true, vendorTypes: true, createdAt: true, additionalInfo: true },
      });

      const vendor = await prisma.vendor.findFirst({
        where:  { userId },
        select: { id: true, businessName: true, verificationStatus: true, isActive: true, vendorType: true },
      });

      if (!application && !vendor) return { hasApplication: false, hasVendor: false, message: "You haven't applied to become a vendor yet." };
      return { hasApplication: !!application, hasVendor: !!vendor, application, vendor };
    },
    {
      name:        "getVendorApplicationStatus",
      description: "Check the current user's vendor application status and vendor account details.",
      schema: z.object({}),
    },
  );

  const applyForVendor = tool(
    async ({ taxId, vendorTypes, additionalInfo }) => {
      const existing = await prisma.vendorApplication.findFirst({
        where: { userId, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (existing) return { success: false, message: `You already have a ${existing.status.toLowerCase()} vendor application.` };

      const application = await prisma.vendorApplication.create({
        data: { userId, taxId, vendorTypes, additionalInfo: additionalInfo || null, status: "PENDING" },
        select: { id: true, status: true, vendorTypes: true, createdAt: true },
      });

      return {
        success:     true,
        message:     "Your vendor application has been submitted! Our team will review it within 2-3 business days.",
        application,
      };
    },
    {
      name:        "applyForVendor",
      description: "Submit a vendor application. Requires tax ID and the types of services they want to offer.",
      schema: z.object({
        taxId:          z.string(),
        vendorTypes:    z.array(z.enum(["ACCOMMODATION", "TRANSPORTATION", "EXPERIENCE", "PACKAGE", "RETAIL"])).min(1),
        additionalInfo: z.string().optional(),
      }),
    },
  );

  const getVendorProfile = tool(
    async ({ vendorId }) => {
      const where  = vendorId ? { id: vendorId } : { userId };
      const vendor = await prisma.vendor.findFirst({
        where,
        include: {
          profile:     true,
          teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
          _count: {
            select: {
              accommodations:          true,
              transportationProviders: true,
              experiences:             true,
              travelPackages:          true,
              retailStores:            true,
            },
          },
        },
      });

      if (!vendor) return { found: false, message: vendorId ? "Vendor not found." : "You don't have a vendor account." };
      return { found: true, vendor };
    },
    {
      name:        "getVendorProfile",
      description: "Get a vendor's profile and listing counts. Omit vendorId to get your own.",
      schema: z.object({ vendorId: z.string().optional() }),
    },
  );

  // ── User profile tools ──────────────────────────────────────────────────────

  const getUserProfile = tool(
    async () => {
      const user = await prisma.user.findUnique({
        where:   { id: userId },
        include: {
          profile: true,
          vendor:  { select: { id: true, businessName: true, verificationStatus: true } },
          _count:  { select: { travelPlans: true } },
        },
      });

      if (!user) return { found: false, message: "User not found." };
      const { password: _, ...safeUser } = user;
      return { found: true, user: safeUser };
    },
    {
      name:        "getUserProfile",
      description: "Get the current user's profile, account details, and stats.",
      schema: z.object({}),
    },
  );

  // ── Guide / informational tool ──────────────────────────────────────────────

  const getPlatformGuide = tool(
    async ({ topic }) => {
      const guides = {
        "travel-plan":        "**Creating a Travel Plan**\n1. Give your trip a title and pick a destination\n2. Set your travel dates and budget\n3. Start adding bookings: accommodation → transportation → experiences\n4. Share the plan with friends if travelling together\n5. Track everything in one place!",
        "vendor-application": "**Becoming a Vendor**\n1. Have your Tax ID ready\n2. Choose which services you'll offer (accommodation, transport, experiences, packages, retail)\n3. Submit your application — review takes 2-3 business days\n4. Once approved, create listings and set them as Active",
        "booking-flow":       "**How Bookings Work**\n- All bookings live inside a Travel Plan\n- Create your plan first, then search & add services\n- Bookings start with PENDING status\n- Confirm & pay through the app\n- Vendors receive notifications for each new booking",
        "collaboration":      "**Sharing Travel Plans**\n- VIEWER: can only view the plan\n- SUGGESTER: can view + add suggestions\n- EDITOR: can view, edit, and add bookings\n- Share via the collaborator's email address",
        "general":            "**Platform Overview**\nThis is an AI-powered trip planner. You can:\n- Create and manage travel plans\n- Book accommodations, transportation, and experiences\n- Add travel packages and shopping visits\n- Collaborate with other travelers\n- Apply to become a vendor and list your own services",
      };

      return { guide: guides[topic] || guides["general"] };
    },
    {
      name:        "getPlatformGuide",
      description: "Get a how-to guide for platform features.",
      schema: z.object({
        topic: z.enum(["travel-plan", "vendor-application", "booking-flow", "collaboration", "general"]),
      }),
    },
  );

  return [
    getUserTravelPlans, getTravelPlanDetails, createTravelPlan, updateTravelPlan, deleteTravelPlan, shareTravelPlan,
    searchAccommodations, getAccommodationDetails, bookAccommodation,
    searchTransportation, getTransportationDetails, bookTransportation,
    searchExperiences, getExperienceDetails, bookExperience,
    searchTravelPackages, getTravelPackageDetails, bookTravelPackage,
    searchRetailStores, addShoppingVisit,
    getVendorApplicationStatus, applyForVendor, getVendorProfile,
    getUserProfile,
    getPlatformGuide,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SESSION MANAGEMENT (Redis-backed)
// ─────────────────────────────────────────────────────────────────────────────

async function loadHistory(userId, sessionId) {
  try {
    const raw = await redisService.client?.get(SESSION_KEY(userId, sessionId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveHistory(userId, sessionId, messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    await redisService.client?.set(SESSION_KEY(userId, sessionId), JSON.stringify(trimmed), "EX", SESSION_TTL_SECONDS);

    const indexKey = SESSIONS_INDEX_KEY(userId);
    const indexRaw = await redisService.client?.get(indexKey) || "[]";
    const index    = JSON.parse(indexRaw);
    if (!index.find((s) => s.sessionId === sessionId)) {
      index.unshift({ sessionId, startedAt: new Date().toISOString() });
      await redisService.client?.set(indexKey, JSON.stringify(index.slice(0, 20)), "EX", SESSION_TTL_SECONDS * 7);
    }
  } catch {
    /* fire-and-forget */
  }
}

function deserializeMessages(raw) {
  return raw.map((m) => {
    switch (m.type) {
      case "human":  return new HumanMessage(m.content);
      case "ai":     return new AIMessage({ content: m.content, tool_calls: m.tool_calls });
      case "tool":   return new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id });
      case "system": return new SystemMessage(m.content);
      default:       return new HumanMessage(m.content);
    }
  });
}

function serializeMessages(messages) {
  return messages.map((m) => {
    if (m instanceof HumanMessage)  return { type: "human",  content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
    if (m instanceof AIMessage)     return { type: "ai",     content: typeof m.content === "string" ? m.content : JSON.stringify(m.content), tool_calls: m.tool_calls };
    if (m instanceof ToolMessage)   return { type: "tool",   content: typeof m.content === "string" ? m.content : JSON.stringify(m.content), tool_call_id: m.tool_call_id };
    if (m instanceof SystemMessage) return { type: "system", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
    return { type: "human", content: String(m.content) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  CORE AGENT LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function runAgentTurn(userMessage, history, userId, isSuperAdmin) {
  const tools        = buildTools(userId, isSuperAdmin);
  const llm          = getLLM();
  const llmWithTools = llm.bindTools(tools);
  const toolsByName  = Object.fromEntries(tools.map((t) => [t.name, t]));

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    ...deserializeMessages(history),
    new HumanMessage(userMessage),
  ];

  const toolsUsed = [];
  let iterations  = 0;

  while (iterations < MAX_AGENT_ITERATIONS) {
    iterations++;
    const response = await llmWithTools.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      const reply = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      return { reply, toolsUsed, messages };
    }

    for (const call of response.tool_calls) {
      toolsUsed.push(call.name);
      let result;
      try {
        const toolFn = toolsByName[call.name];
        if (!toolFn) throw new Error(`Unknown tool: ${call.name}`);
        result = await toolFn.invoke(call.args);
      } catch (err) {
        result = { error: true, message: err.message || "Tool execution failed" };
      }
      messages.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id }));
    }
  }

  return { reply: "I'm having trouble completing that request. Please try rephrasing.", toolsUsed, messages };
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

class AIAgentController {

  async chat(req, res, next) {
    try {
      const userId       = req.user.id;
      const isSuperAdmin = req.user.isSuperAdmin || false;
      const { message, sessionId: rawSessionId } = req.body;

      if (!message?.trim()) return badRequest(res, "message is required");

      const sessionId = rawSessionId || `${userId}-${Date.now()}`;
      const history   = await loadHistory(userId, sessionId);

      const { reply, toolsUsed, messages } = await runAgentTurn(message.trim(), history, userId, isSuperAdmin);

      const historyToSave = serializeMessages(messages.slice(1));
      await saveHistory(userId, sessionId, historyToSave);

      res.json({ success: true, sessionId, reply, toolsUsed, messageCount: historyToSave.length });
    } catch (error) {
      next(error);
    }
  }

  async streamChat(req, res, next) {
    try {
      const userId       = req.user.id;
      const isSuperAdmin = req.user.isSuperAdmin || false;
      const { message, sessionId: rawSessionId } = req.body;

      if (!message?.trim()) { res.status(400).json({ success: false, message: "message is required" }); return; }

      const sessionId = rawSessionId || `${userId}-${Date.now()}`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

      try {
        const tools        = buildTools(userId, isSuperAdmin);
        const llm          = getLLM();
        const llmWithTools = llm.bindTools(tools);
        const toolsByName  = Object.fromEntries(tools.map((t) => [t.name, t]));

        const history  = await loadHistory(userId, sessionId);
        const messages = [new SystemMessage(SYSTEM_PROMPT), ...deserializeMessages(history), new HumanMessage(message.trim())];

        const toolsUsed = [];
        let iterations  = 0;

        while (iterations < MAX_AGENT_ITERATIONS) {
          iterations++;
          let fullContent    = "";
          let tool_calls_acc = [];

          const stream = await llmWithTools.stream(messages);
          for await (const chunk of stream) {
            if (chunk.content) {
              const token = typeof chunk.content === "string" ? chunk.content : "";
              if (token) { fullContent += token; send({ type: "token", content: token }); }
            }
            if (chunk.tool_call_chunks?.length) {
              for (const delta of chunk.tool_call_chunks) {
                const existing = tool_calls_acc.find((tc) => tc.index === delta.index);
                if (existing) { existing.args = (existing.args || "") + (delta.args || ""); }
                else { tool_calls_acc.push({ ...delta, args: delta.args || "" }); }
              }
            }
          }

          const tool_calls = tool_calls_acc.filter((tc) => tc.name).map((tc) => {
            let parsedArgs = {};
            try { parsedArgs = JSON.parse(tc.args || "{}"); } catch { parsedArgs = {}; }
            return { id: tc.id || `call_${Date.now()}`, name: tc.name, args: parsedArgs };
          });

          messages.push(new AIMessage({ content: fullContent, tool_calls }));
          if (!tool_calls.length) break;

          for (const call of tool_calls) {
            send({ type: "tool", name: call.name, status: "calling" });
            toolsUsed.push(call.name);
            let result;
            try {
              const toolFn = toolsByName[call.name];
              if (!toolFn) throw new Error(`Unknown tool: ${call.name}`);
              result = await toolFn.invoke(call.args);
            } catch (err) {
              result = { error: true, message: err.message || "Tool execution failed" };
            }
            send({ type: "tool", name: call.name, status: "done" });
            messages.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id }));
          }
        }

        const historyToSave = serializeMessages(messages.slice(1));
        await saveHistory(userId, sessionId, historyToSave);
        send({ type: "done", sessionId, toolsUsed, messageCount: historyToSave.length });
      } catch (err) {
        send({ type: "error", message: err.message || "Agent error" });
      }
      res.end();
    } catch (error) {
      next(error);
    }
  }

  async getHistory(req, res, next) {
    try {
      const userId        = req.user.id;
      const { sessionId } = req.query;
      if (!sessionId) return badRequest(res, "sessionId is required");

      const raw = await loadHistory(userId, sessionId);
      const displayMessages = raw
        .filter((m) => m.type === "human" || m.type === "ai")
        .map((m) => ({
          role:      m.type === "human" ? "user" : "assistant",
          content:   m.content,
          toolsUsed: m.type === "ai" && m.tool_calls?.length ? m.tool_calls.map((tc) => tc.name) : undefined,
        }));

      res.json({ success: true, sessionId, messages: displayMessages, total: displayMessages.length });
    } catch (error) {
      next(error);
    }
  }

  async clearHistory(req, res, next) {
    try {
      const userId        = req.user.id;
      const { sessionId } = req.query;
      if (!sessionId) return badRequest(res, "sessionId is required");

      await redisService.client?.del(SESSION_KEY(userId, sessionId)).catch(() => {});
      res.json({ success: true, message: "Conversation history cleared." });
    } catch (error) {
      next(error);
    }
  }

  async getSessions(req, res, next) {
    try {
      const userId   = req.user.id;
      const raw      = await redisService.client?.get(SESSIONS_INDEX_KEY(userId)) || "[]";
      const sessions = JSON.parse(raw);
      res.json({ success: true, sessions });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AIAgentController();