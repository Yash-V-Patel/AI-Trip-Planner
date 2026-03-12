"use strict";

/**
 * ai_agent.controller.js
 *
 * Conversational AI agent powered by xAI Grok via LangChain.
 * The agent holds a per-session conversation history (stored in Redis) and
 * has access to every major platform capability as a LangChain tool:
 *
 *   Travel Plans   → create, read, update, delete, share
 *   Accommodations → search, details, book
 *   Transportation → search, details, book
 *   Experiences    → search, details, book
 *   Packages       → search, details, book
 *   Retail Stores  → search, details, add shopping visit
 *   Vendor         → apply, check status, get profile
 *   User           → get/update profile
 *
 * Endpoints
 * ─────────
 *   POST   /api/agent/chat            – send a message, receive full response
 *   POST   /api/agent/stream          – send a message, receive SSE stream
 *   GET    /api/agent/history         – get conversation history for a session
 *   DELETE /api/agent/history         – clear conversation history for a session
 *   GET    /api/agent/sessions        – list all sessions for the user
 */

const { ChatXAI } = require("@langchain/xai");
const { tool }    = require("@langchain/core/tools");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { z }           = require("zod");
const { PrismaClient } = require("@prisma/client");
const redisService    = require("../services/redis.service");

const prisma = new PrismaClient();

// ─── constants ────────────────────────────────────────────────────────────────
const SESSION_TTL_SECONDS = 60 * 60 * 24;   // 24 hours
const MAX_HISTORY_MESSAGES = 40;             // per session
const MAX_AGENT_ITERATIONS = 10;             // safety guard against infinite tool loops
const SESSION_KEY = (userId, sessionId) => `ai_agent:session:${userId}:${sessionId}`;
const SESSIONS_INDEX_KEY = (userId) => `ai_agent:sessions:${userId}`;

// ─── helpers ──────────────────────────────────────────────────────────────────
const notFound   = (res, msg = "Not found")   => res.status(404).json({ success: false, message: msg });
const badRequest = (res, msg = "Bad request") => res.status(400).json({ success: false, message: msg });

// ─── LLM instantiation (lazy singleton so the key is read at call-time) ───────
let _llm = null;
const getLLM = () => {
  if (!_llm) {
    _llm = new ChatXAI({
      model:       process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning",
      apiKey:      process.env.XAI_API_KEY,
      temperature: 0.3,
    //   maxTokens:   2048,
    maxTokens: 600
    });
  }
  return _llm;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are TripAI, a friendly and knowledgeable travel assistant for an AI-powered trip planning platform.

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

/**
 * Build the full list of tools for a given user context.
 * Passing userId + isSuperAdmin lets tools enforce authorization correctly
 * without the agent needing to know those details.
 */
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
              accommodations:  true,
              transportServices: true,
              experiences:     true,
              experienceBookings: true,
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
        limit:  z.number().optional().default(10).describe("Max number of plans to return (default 10)"),
        status: z.enum(["PLANNING", "ONGOING", "COMPLETED", "CANCELLED"]).optional().describe("Filter by status"),
      }),
    },
  );

  const getTravelPlanDetails = tool(
    async ({ travelPlanId }) => {
      const plan = await prisma.travelPlan.findFirst({
        where: { id: travelPlanId, userId },
        include: {
          accommodations:   { include: { accommodation: { select: { id: true, name: true, city: true } } } },
          transportServices:{ include: { provider: { select: { id: true, name: true, type: true } } } },
          experiences:      true,
          experienceBookings: { include: { experience: { select: { id: true, name: true, location: true } } } },
          travelPackageBookings:  { include: { package: { select: { id: true, name: true } } } },
          shoppingVisits:   { include: { store: { select: { id: true, name: true, city: true } } } },
          // collaborators:    { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      });

      if (!plan) return { found: false, message: "Travel plan not found or you don't have access." };
      return { found: true, plan };
    },
    {
      name:        "getTravelPlanDetails",
      description: "Get full details of a specific travel plan including all bookings and collaborators.",
      schema: z.object({
        travelPlanId: z.string().describe("The travel plan ID"),
      }),
    },
  );

  const createTravelPlan = tool(
    async ({ title, destination, startDate, endDate, budget, description, currency, numberOfTravelers, travelStyle }) => {
      const plan = await prisma.travelPlan.create({
        data: {
          userId,
          title,
          destination,
          startDate:   startDate ? new Date(startDate) : null,
          endDate:     endDate   ? new Date(endDate)   : null,
          budget:      budget    ? parseFloat(budget)   : null,
          description: description || null,
          currency:    currency || "USD",
          numberOfTravelers: numberOfTravelers || 1,
          travelStyle: travelStyle || null,
          status:      "PLANNING",
        },
        select: {
          id:          true,
          title:       true,
          destination: true,
          startDate:   true,
          endDate:     true,
          budget:      true,
          status:      true,
        },
      });

      return { success: true, message: `Travel plan "${title}" created successfully!`, plan };
    },
    {
      name:        "createTravelPlan",
      description: "Create a new travel plan for the user. Always confirm destination and dates with the user before calling this.",
      schema: z.object({
        title:             z.string().describe("A descriptive name for the trip (e.g. 'Paris Summer Trip')"),
        destination:       z.string().describe("Primary destination city or country"),
        startDate:         z.string().optional().describe("Trip start date in ISO format (YYYY-MM-DD)"),
        endDate:           z.string().optional().describe("Trip end date in ISO format (YYYY-MM-DD)"),
        budget:            z.string().optional().describe("Total budget as a number string"),
        description:       z.string().optional().describe("Optional notes or description"),
        currency:          z.string().optional().default("USD").describe("Currency code (default USD)"),
        numberOfTravelers: z.number().optional().default(1).describe("Number of travelers"),
        travelStyle:       z.enum(["BUDGET", "MIDRANGE", "LUXURY", "BACKPACKER", "FAMILY", "BUSINESS"]).optional(),
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

      const updated = await prisma.travelPlan.update({ where: { id: travelPlanId }, data, select: { id: true, title: true, destination: true, startDate: true, endDate: true, budget: true, status: true } });
      return { success: true, message: "Travel plan updated.", plan: updated };
    },
    {
      name:        "updateTravelPlan",
      description: "Update an existing travel plan's details (title, destination, dates, budget, status).",
      schema: z.object({
        travelPlanId:      z.string().describe("The travel plan ID to update"),
        title:             z.string().optional(),
        destination:       z.string().optional(),
        startDate:         z.string().optional().describe("ISO date YYYY-MM-DD"),
        endDate:           z.string().optional().describe("ISO date YYYY-MM-DD"),
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
      if (!plan) return { success: false, message: "Travel plan not found or you don't have permission to delete it." };

      await prisma.travelPlan.delete({ where: { id: travelPlanId } });
      return { success: true, message: `Travel plan "${plan.title}" has been deleted.` };
    },
    {
      name:        "deleteTravelPlan",
      description: "Permanently delete a travel plan and all its bookings. ONLY call after explicit user confirmation.",
      schema: z.object({
        travelPlanId: z.string().describe("The travel plan ID to delete"),
      }),
    },
  );

  const shareTravelPlan = tool(
    async ({ travelPlanId, collaboratorEmail, role }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found or you don't have permission to share it." };

      const collaborator = await prisma.user.findUnique({ where: { email: collaboratorEmail }, select: { id: true, name: true } });
      if (!collaborator) return { success: false, message: `No user found with email ${collaboratorEmail}.` };

      // Upsert collaborator record
      await prisma.travelPlanCollaborator.upsert({
        where: { travelPlanId_userId: { travelPlanId, userId: collaborator.id } },
        create: { travelPlanId, userId: collaborator.id, role },
        update: { role },
      });

      return { success: true, message: `Shared with ${collaborator.name || collaboratorEmail} as ${role}.` };
    },
    {
      name:        "shareTravelPlan",
      description: "Share a travel plan with another user by their email address.",
      schema: z.object({
        travelPlanId:       z.string().describe("The travel plan ID to share"),
        collaboratorEmail:  z.string().email().describe("Email of the user to share with"),
        role:               z.enum(["VIEWER", "SUGGESTER", "EDITOR"]).describe("Access level for the collaborator"),
      }),
    },
  );

  // ── Accommodation tools ─────────────────────────────────────────────────────

  const searchAccommodations = tool(
    async ({ city, country, checkIn, checkOut, guests, priceCategory, type, limit }) => {
      const where = { isActive: true };
      if (city)         where.city    = { contains: city,    mode: "insensitive" };
      if (country)      where.country = { contains: country, mode: "insensitive" };
      if (priceCategory) where.priceCategory = priceCategory;
      if (type) where.accommodationType = type;

      const accommodations = await prisma.accommodation.findMany({
        where,
        take: limit,
        orderBy: { starRating: "desc" },
        select: {
          id:             true,
          name:           true,
          accommodationType :    true,
          city:           true,
          country:        true,
          address:        true,
          starRating:     true,
          priceCategory:  true,
          description:    true,
          amenities:      true,
          checkInTime:    true,
          checkOutTime:   true,
          isVerified:     true,
          vendor:         { select: { businessName: true, overallRating: true } },
          _count:         { select: { rooms: true } },
        },
      });

      if (!accommodations.length) return { found: false, message: `No accommodations found in ${city || country || "that location"}.` };
      return { found: true, count: accommodations.length, accommodations };
    },
    {
      name:        "searchAccommodations",
      description: "Search for hotels, hostels, apartments, and other accommodations by location.",
      schema: z.object({
        city:          z.string().optional().describe("City name"),
        country:       z.string().optional().describe("Country name"),
        checkIn:       z.string().optional().describe("Check-in date ISO format"),
        checkOut:      z.string().optional().describe("Check-out date ISO format"),
        guests:        z.number().optional().describe("Number of guests"),
        priceCategory: z.enum(["BUDGET", "MIDRANGE", "LUXURY", "BOUTIQUE"]).optional(),
        type:          z.enum(["HOTEL", "HOSTEL", "APARTMENT", "RESORT", "VILLA", "BED_AND_BREAKFAST", "GUESTHOUSE"]).optional(),
        limit:         z.number().optional().default(8).describe("Max results"),
      }),
    },
  );

  const getAccommodationDetails = tool(
    async ({ accommodationId }) => {
      const acc = await prisma.accommodation.findFirst({
        where: { id: accommodationId, isActive: true },
        include: {
          rooms:    { where: { isAvailable: true }, select: { id: true, name: true, type: true, pricePerNight: true, maxOccupancy: true, amenities: true } },
          services: { select: { id: true, name: true, type: true, price: true, description: true } },
          vendor:   { select: { businessName: true, overallRating: true, totalReviews: true } },
        },
      });

      if (!acc) return { found: false, message: "Accommodation not found." };
      return { found: true, accommodation: acc };
    },
    {
      name:        "getAccommodationDetails",
      description: "Get full details of an accommodation including available rooms and services.",
      schema: z.object({
        accommodationId: z.string().describe("The accommodation ID"),
      }),
    },
  );

  const bookAccommodation = tool(
    async ({ travelPlanId, accommodationId, roomIds, checkInDate, checkOutDate, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found or you don't have access." };

      const acc = await prisma.accommodation.findFirst({ where: { id: accommodationId, isActive: true }, select: { id: true, name: true } });
      if (!acc) return { success: false, message: "Accommodation not found or not available." };

      const booking = await prisma.accommodationBooking.create({
        data: {
          travelPlanId,
          accommodationId,
          userId,
          checkInDate:  new Date(checkInDate),
          checkOutDate: new Date(checkOutDate),
          bookingStatus: "PENDING",
          specialRequests: specialRequests || null,
          ...(roomIds?.length ? { rooms: { connect: roomIds.map((id) => ({ id })) } } : {}),
        },
        select: { id: true, checkInDate: true, checkOutDate: true, bookingStatus: true },
      });

      return { success: true, message: `Accommodation "${acc.name}" added to your travel plan!`, booking };
    },
    {
      name:        "bookAccommodation",
      description: "Add an accommodation booking to a travel plan.",
      schema: z.object({
        travelPlanId:    z.string().describe("The travel plan to add this booking to"),
        accommodationId: z.string().describe("The accommodation ID to book"),
        roomIds:         z.array(z.string()).optional().describe("Specific room IDs to book"),
        checkInDate:     z.string().describe("Check-in date ISO format YYYY-MM-DD"),
        checkOutDate:    z.string().describe("Check-out date ISO format YYYY-MM-DD"),
        specialRequests: z.string().optional().describe("Any special requests"),
      }),
    },
  );

  // ── Transportation tools ────────────────────────────────────────────────────

  const searchTransportation = tool(
    async ({ city, country, type, limit }) => {
      const where = { isAvailable: true };
      if (city)    where.city    = { contains: city,    mode: "insensitive" };
      if (country) where.country = { contains: country, mode: "insensitive" };
      if (type) where.providerType = type;

      const providers = await prisma.transportationProvider.findMany({
        where,
        take: limit,
        select: {
          id:          true,
          name:        true,
          providerType:  true,
          city:        true,
          country:     true,
          description: true,
          rating:      true,
          priceRange:  true,
          vendor:      { select: { businessName: true } },
          _count:      { select: { vehicles: true } },
        },
      });

      if (!providers.length) return { found: false, message: `No transportation providers found in ${city || country || "that area"}.` };
      return { found: true, count: providers.length, providers };
    },
    {
      name:        "searchTransportation",
      description: "Search for transportation providers (car rentals, bus services, private transfers, etc.) by location.",
      schema: z.object({
        city:    z.string().optional().describe("City name"),
        country: z.string().optional().describe("Country name"),
        type:    z.enum(["CAR_RENTAL", "BUS", "PRIVATE_TRANSFER", "BOAT", "BICYCLE", "MOTORCYCLE", "SHUTTLE"]).optional(),
        limit:   z.number().optional().default(8),
      }),
    },
  );

  const getTransportationDetails = tool(
    async ({ providerId }) => {
      const provider = await prisma.transportationProvider.findFirst({
        where: { id: providerId, isAvailable: true },
        include: {
          vehicles: { where: { isAvailable: true }, select: { id: true, type: true, model: true, capacity: true, pricePerDay: true, pricePerKm: true, features: true } },
          vendor:   { select: { businessName: true, overallRating: true } },
        },
      });

      if (!provider) return { found: false, message: "Transportation provider not found." };
      return { found: true, provider };
    },
    {
      name:        "getTransportationDetails",
      description: "Get full details of a transportation provider including available vehicles.",
      schema: z.object({
        providerId: z.string().describe("The transportation provider ID"),
      }),
    },
  );

  const bookTransportation = tool(
    async ({ travelPlanId, vehicleId, pickupTime, pickupLocation, dropoffLocation, numberOfPassengers, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const vehicle = await prisma.transportationVehicle.findFirst({ where: { id: vehicleId, isAvailable: true }, include: { provider: { select: { id: true, name: true } } } });
      if (!vehicle) return { success: false, message: "Vehicle not found or not available." };

      const booking = await prisma.transportationBooking.create({
        data: {
          travelPlanId,
          vehicleId,
          providerId:          vehicle.provider.id,
          userId,
          pickupTime:          new Date(pickupTime),
          pickupLocation:      pickupLocation || null,
          dropoffLocation:     dropoffLocation || null,
          numberOfPassengers:  numberOfPassengers || 1,
          specialRequests:     specialRequests || null,
          status:              "BOOKED",
          // Snapshot fields from vehicle
          snapshotVehicleType: vehicle.vehicleType,
          snapshotVehicleNumber: vehicle.licensePlate || null,
        },
        select: { id: true, pickupTime: true, status: true },
      });

      return { success: true, message: `Transportation with "${vehicle.provider.name}" added to your plan!`, booking };
    },
    {
      name:        "bookTransportation",
      description: "Add a transportation booking to a travel plan.",
      schema: z.object({
        travelPlanId:       z.string(),
        vehicleId:          z.string().describe("Vehicle ID to book"),
        pickupTime:         z.string().describe("Pickup datetime in ISO format"),
        pickupLocation:     z.string().optional().describe("Pickup address or location"),
        dropoffLocation:    z.string().optional().describe("Drop-off address or location"),
        numberOfPassengers: z.number().optional().default(1),
        specialRequests:    z.string().optional(),
      }),
    },
  );

  // ── Experience tools ────────────────────────────────────────────────────────

  const searchExperiences = tool(
    async ({ location, city, country, category, maxPrice, limit }) => {
      const where = { isActive: true };
      if (city)     where.city     = { contains: city,     mode: "insensitive" };
      if (country)  where.country  = { contains: country,  mode: "insensitive" };
      if (location) where.location = { contains: location, mode: "insensitive" };
      if (category) where.category = category;
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
          duration:        true,
          maxGroupSize:    true,
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
        location: z.string().optional().describe("Broad location string"),
        city:     z.string().optional(),
        country:  z.string().optional(),
        category: z.enum(["TOUR", "ADVENTURE", "CULTURAL", "FOOD_DRINK", "WELLNESS", "SPORTS", "ENTERTAINMENT", "WORKSHOP", "OTHER"]).optional(),
        maxPrice: z.string().optional().describe("Maximum price per person"),
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
      // blackoutDates is a Json field — no JSON.parse needed
      return { found: true, experience: exp };
    },
    {
      name:        "getExperienceDetails",
      description: "Get full details of a vendor experience including pricing, availability, and recent reviews.",
      schema: z.object({
        experienceId: z.string().describe("The vendor experience ID"),
      }),
    },
  );

  const bookExperience = tool(
    async ({ travelPlanId, experienceId, experienceDate, numberOfParticipants, specialRequests }) => {
      const plan = await prisma.travelPlan.findFirst({ where: { id: travelPlanId, userId }, select: { id: true } });
      if (!plan) return { success: false, message: "Travel plan not found." };

      const exp = await prisma.vendorExperience.findFirst({ where: { id: experienceId, isActive: true }, select: { id: true, name: true, pricePerPerson: true, maxGroupSize: true } });
      if (!exp) return { success: false, message: "Experience not found." };

      if (exp.maxGroupSize && numberOfParticipants > exp.maxGroupSize) {
        return { success: false, message: `This experience has a maximum group size of ${exp.maxGroupSize}.` };
      }

      const totalAmount = (exp.pricePerPerson ?? 0) * numberOfParticipants;

      const booking = await prisma.experienceBooking.create({
        data: {
          travelPlanId,
          experienceId,
          userId,
          experienceDate:       new Date(experienceDate),
          numberOfParticipants,
          totalAmount,
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
        experienceDate:       z.string().describe("Date in ISO format YYYY-MM-DD"),
        numberOfParticipants: z.number().default(1),
        specialRequests:      z.string().optional(),
      }),
    },
  );

  // ── Travel Package tools ────────────────────────────────────────────────────

  const searchTravelPackages = tool(
    async ({ destination, maxBudget, durationDays, limit }) => {
      const where = { isActive: true };
      if (destination) where.destination = { contains: destination, mode: "insensitive" };
      if (maxBudget)   where.price        = { lte: parseFloat(maxBudget) };
      if (durationDays) where.durationDays = { lte: durationDays };

      const packages = await prisma.travelPackage.findMany({
        where,
        take: limit,
        orderBy: { rating: "desc" },
        select: {
          id:           true,
          name:         true,
          destination:  true,
          description:  true,
          price:        true,
          durationDays: true,
          maxTravelers: true,
          rating:       true,
          inclusions:   true,
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
        maxBudget:    z.string().optional().describe("Maximum package price"),
        durationDays: z.number().optional().describe("Maximum trip duration in days"),
        limit:        z.number().optional().default(8),
      }),
    },
  );

  const getTravelPackageDetails = tool(
    async ({ packageId }) => {
      const pkg = await prisma.travelPackage.findFirst({
        where: { id: packageId, isActive: true },
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

      const pkg = await prisma.travelPackage.findFirst({ where: { id: packageId, isActive: true }, select: { id: true, name: true, basePrice: true, durationDays: true, maxTravelers: true } });
      if (!pkg) return { success: false, message: "Package not found." };

      if (pkg.maxTravelers && numberOfTravelers > pkg.maxTravelers) {
        return { success: false, message: `This package has a maximum of ${pkg.maxTravelers} travelers.` };
      }

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + (pkg.durationDays || 0));

      const finalAmount = (pkg.basePrice - (pkg.basePrice * (pkg.discount ?? 0) / 100)) * numberOfTravelers;

      const booking = await prisma.travelPackageBooking.create({
        // data: {
        //   travelPlanId,
        //   packageId,
        //   userId,
        //   startDate:        new Date(startDate),
        //   endDate,
        //   numberOfTravelers,
        //   finalAmount,
        //   specialRequests:  specialRequests || null,
        //   status:           "PENDING",
        // }

        data: {
              travelPlanId, packageId, startDate, userId, endDate, numberOfTravelers, finalAmount,
              basePrice:      pkg.basePrice,
              leadGuestName:  userName,   // or extract from user context
              leadGuestEmail: userEmail,    // pass from req.user
              specialRequests: specialRequests || null,
              status: "PENDING",
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
        startDate:         z.string().describe("Start date ISO format YYYY-MM-DD"),
        numberOfTravelers: z.number().default(1),
        specialRequests:   z.string().optional(),
      }),
    },
  );

  // ── Retail / Shopping tools ─────────────────────────────────────────────────

  const searchRetailStores = tool(
    async ({ city, country, category, priceRange, limit }) => {
      const where = { isActive: true };
      if (city)       where.city       = { contains: city,     mode: "insensitive" };
      if (country)    where.country    = { contains: country,  mode: "insensitive" };
      if (category)   where.category   = category;
      if (priceRange) where.priceRange = priceRange;

      const stores = await prisma.retailStore.findMany({
        where,
        take: limit,
        orderBy: { rating: "desc" },
        select: {
          id:          true,
          name:        true,
          category:    true,
          city:        true,
          country:     true,
          address:     true,
          description: true,
          priceRange:  true,
          rating:      true,
          openingHours: true,
          vendor:      { select: { businessName: true } },
        },
      });

      if (!stores.length) return { found: false, message: `No stores found in ${city || country || "that area"}.` };
      return { found: true, count: stores.length, stores };
    },
    {
      name:        "searchRetailStores",
      description: "Search for retail stores, markets, and shops to visit during a trip.",
      schema: z.object({
        city:       z.string().optional(),
        country:    z.string().optional(),
        category:   z.enum(["FASHION", "ELECTRONICS", "SOUVENIRS", "FOOD_MARKET", "ARTISAN", "BOOKS", "SPORTS", "JEWELRY", "OTHER"]).optional(),
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
          userId,
          plannedDate: plannedDate ? new Date(plannedDate) : null,
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
        plannedDate:  z.string().optional().describe("Planned visit date ISO format"),
        notes:        z.string().optional(),
      }),
    },
  );

  // ── Vendor application tools ────────────────────────────────────────────────

  const getVendorApplicationStatus = tool(
    async () => {
      const application = await prisma.vendorApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, vendorTypes: true, createdAt: true, additionalInfo: true },
      });

      const vendor = await prisma.vendor.findFirst({
        where: { userId },
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
      const existing = await prisma.vendorApplication.findFirst({ where: { userId, status: { in: ["PENDING", "APPROVED"] } } });
      if (existing) return { success: false, message: `You already have a ${existing.status.toLowerCase()} vendor application.` };

      const application = await prisma.vendorApplication.create({
        data: {
          userId,
          taxId,
          vendorTypes,
          additionalInfo: additionalInfo || null,
          status: "PENDING",
        },
        select: { id: true, status: true, vendorTypes: true, createdAt: true },
      });

      return {
        success: true,
        message: "Your vendor application has been submitted! Our team will review it within 2-3 business days. You'll receive a notification once it's approved.",
        application,
      };
    },
    {
      name:        "applyForVendor",
      description: "Submit a vendor application for the current user. Requires tax ID and the types of services they want to offer.",
      schema: z.object({
        taxId:          z.string().describe("Business tax identification number"),
        vendorTypes:    z.array(z.enum(["ACCOMMODATION", "TRANSPORTATION", "EXPERIENCE", "PACKAGE", "RETAIL"])).min(1).describe("Types of services to offer"),
        additionalInfo: z.string().optional().describe("Any additional information about their business"),
      }),
    },
  );

  const getVendorProfile = tool(
    async ({ vendorId }) => {
      const where = vendorId ? { id: vendorId } : { userId };
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
      description: "Get a vendor's profile and listing counts. If no vendorId is provided, returns the current user's vendor.",
      schema: z.object({
        vendorId: z.string().optional().describe("Specific vendor ID — omit to get your own vendor profile"),
      }),
    },
  );

  // ── User profile tools ──────────────────────────────────────────────────────

  const getUserProfile = tool(
    async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          vendor:  { select: { id: true, businessName: true, verificationStatus: true } },
          _count:  { select: { travelPlans: true } },
        },
      });

      if (!user) return { found: false, message: "User not found." };
      // Never expose hashed passwords
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
        "travel-plan": "**Creating a Travel Plan**\n1. Give your trip a title and pick a destination\n2. Set your travel dates and budget\n3. Start adding bookings: accommodation → transportation → experiences\n4. Share the plan with friends if travelling together\n5. Track everything in one place!",
        "vendor-application": "**Becoming a Vendor**\n1. Have your Tax ID ready\n2. Choose which services you'll offer (accommodation, transport, experiences, packages, retail)\n3. Submit your application — review takes 2-3 business days\n4. Once approved, you get a vendor account to create listings\n5. Create your listings and set them as Active to start receiving bookings",
        "booking-flow": "**How Bookings Work**\n- All bookings live inside a Travel Plan\n- Create your plan first, then search & add services\n- Bookings start with PENDING status\n- Confirm & pay through the app\n- Vendors receive notifications for each new booking",
        "collaboration": "**Sharing Travel Plans**\n- VIEWER: can only view the plan\n- SUGGESTER: can view + add suggestions\n- EDITOR: can view, edit, and add bookings\n- Share via the collaborator's email address",
        "general": "**Platform Overview**\nThis is an AI-powered trip planner. You can:\n- Create and manage travel plans\n- Book accommodations, transportation, and experiences\n- Add travel packages and shopping visits\n- Collaborate with other travelers\n- Apply to become a vendor and list your own services",
      };

      const content = guides[topic] || guides["general"];
      return { guide: content };
    },
    {
      name:        "getPlatformGuide",
      description: "Get a how-to guide for platform features. Use this to explain concepts to the user.",
      schema: z.object({
        topic: z.enum(["travel-plan", "vendor-application", "booking-flow", "collaboration", "general"])
          .describe("The topic to explain"),
      }),
    },
  );

  return [
    // Travel plan
    getUserTravelPlans,
    getTravelPlanDetails,
    createTravelPlan,
    updateTravelPlan,
    deleteTravelPlan,
    shareTravelPlan,
    // Accommodation
    searchAccommodations,
    getAccommodationDetails,
    bookAccommodation,
    // Transportation
    searchTransportation,
    getTransportationDetails,
    bookTransportation,
    // Experiences
    searchExperiences,
    getExperienceDetails,
    bookExperience,
    // Packages
    searchTravelPackages,
    getTravelPackageDetails,
    bookTravelPackage,
    // Retail
    searchRetailStores,
    addShoppingVisit,
    // Vendor
    getVendorApplicationStatus,
    applyForVendor,
    getVendorProfile,
    // User
    getUserProfile,
    // Guide
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

    // Track session in index
    const indexKey = SESSIONS_INDEX_KEY(userId);
    const indexRaw = await redisService.client?.get(indexKey) || "[]";
    const index    = JSON.parse(indexRaw);
    if (!index.find((s) => s.sessionId === sessionId)) {
      index.unshift({ sessionId, startedAt: new Date().toISOString() });
      await redisService.client?.set(indexKey, JSON.stringify(index.slice(0, 20)), "EX", SESSION_TTL_SECONDS * 7);
    }
  } catch {
    /* fire-and-forget — Redis failures shouldn't break chat */
  }
}

/**
 * Convert serialised plain-object messages back into LangChain message instances.
 */
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

/**
 * Run one turn of the agent:
 *   1. Append user message to history
 *   2. Invoke LLM (with tools bound)
 *   3. Execute any tool calls
 *   4. Loop until final text response
 *   5. Return { reply, toolsUsed, messages }
 */
async function runAgentTurn(userMessage, history, userId, isSuperAdmin) {
  const tools      = buildTools(userId, isSuperAdmin);
  const llm        = getLLM();
  const llmWithTools = llm.bindTools(tools);

  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

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

    // No tool calls → we have the final answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const reply = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      return { reply, toolsUsed, messages };
    }

    // Execute each requested tool call
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

      messages.push(
        new ToolMessage({
          content:      JSON.stringify(result),
          tool_call_id: call.id,
        }),
      );
    }
  }

  // Safety: if we hit the iteration limit return whatever we have
  const last = messages[messages.length - 1];
  return {
    reply: "I'm having trouble completing that request. Please try rephrasing.",
    toolsUsed,
    messages,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

class AIAgentController {

  /**
   * POST /api/agent/chat
   * Body: { message, sessionId? }
   */
  async chat(req, res, next) {
    try {
      const userId     = req.user.id;
      const isSuperAdmin = req.user.isSuperAdmin || false;
      const { message, sessionId: rawSessionId } = req.body;

      if (!message?.trim()) return badRequest(res, "message is required");

      const sessionId = rawSessionId || `${userId}-${Date.now()}`;
      const history   = await loadHistory(userId, sessionId);

      const { reply, toolsUsed, messages } = await runAgentTurn(
        message.trim(),
        history,
        userId,
        isSuperAdmin,
      );

      // Persist history — strip system message (index 0) before saving
      const historyToSave = serializeMessages(messages.slice(1));
      await saveHistory(userId, sessionId, historyToSave);

      res.json({
        success:   true,
        sessionId,
        reply,
        toolsUsed,
        messageCount: historyToSave.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/agent/stream
   * Body: { message, sessionId? }
   * Response: Server-Sent Events stream
   *
   * Event types:
   *   data: { type: "token",    content: "..." }
   *   data: { type: "tool",     name: "...", status: "calling"|"done" }
   *   data: { type: "done",     sessionId, toolsUsed }
   *   data: { type: "error",    message: "..." }
   */
  async streamChat(req, res, next) {
    try {
      const userId       = req.user.id;
      const isSuperAdmin = req.user.isSuperAdmin || false;
      const { message, sessionId: rawSessionId } = req.body;

      if (!message?.trim()) {
        res.status(400).json({ success: false, message: "message is required" });
        return;
      }

      const sessionId = rawSessionId || `${userId}-${Date.now()}`;

      // ── SSE headers ──
      res.setHeader("Content-Type",  "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (obj) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      try {
        const tools        = buildTools(userId, isSuperAdmin);
        const llm          = getLLM();
        const llmWithTools = llm.bindTools(tools);
        const toolsByName  = Object.fromEntries(tools.map((t) => [t.name, t]));

        const history  = await loadHistory(userId, sessionId);
        const messages = [
          new SystemMessage(SYSTEM_PROMPT),
          ...deserializeMessages(history),
          new HumanMessage(message.trim()),
        ];

        const toolsUsed = [];
        let   iterations = 0;

        while (iterations < MAX_AGENT_ITERATIONS) {
          iterations++;

          // Stream the LLM response token by token
          let fullContent  = "";
          let tool_calls_acc = [];

          const stream = await llmWithTools.stream(messages);

          for await (const chunk of stream) {
            // Accumulate text tokens
            if (chunk.content) {
              const token = typeof chunk.content === "string" ? chunk.content : "";
              if (token) {
                fullContent += token;
                send({ type: "token", content: token });
              }
            }
            // Accumulate tool call deltas
            if (chunk.tool_call_chunks?.length) {
              for (const delta of chunk.tool_call_chunks) {
                const existing = tool_calls_acc.find((tc) => tc.index === delta.index);
                if (existing) {
                  existing.args = (existing.args || "") + (delta.args || "");
                } else {
                  tool_calls_acc.push({ ...delta, args: delta.args || "" });
                }
              }
            }
          }

          // Reconstruct tool_calls with parsed args
          const tool_calls = tool_calls_acc
            .filter((tc) => tc.name)
            .map((tc) => {
              let parsedArgs = {};
              try { parsedArgs = JSON.parse(tc.args || "{}"); } catch { parsedArgs = {}; }
              return { id: tc.id || `call_${Date.now()}`, name: tc.name, args: parsedArgs };
            });

          const assistantMsg = new AIMessage({ content: fullContent, tool_calls });
          messages.push(assistantMsg);

          if (!tool_calls.length) break; // Final answer

          // Execute tools
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

        // Save history
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

  /**
   * GET /api/agent/history
   * Query: { sessionId }
   */
  async getHistory(req, res, next) {
    try {
      const userId    = req.user.id;
      const { sessionId } = req.query;
      if (!sessionId) return badRequest(res, "sessionId is required");

      const raw = await loadHistory(userId, sessionId);

      // Return only human and AI messages (skip tool messages for display)
      const displayMessages = raw
        .filter((m) => m.type === "human" || m.type === "ai")
        .map((m) => ({
          role:      m.type === "human" ? "user" : "assistant",
          content:   m.content,
          toolsUsed: m.type === "ai" && m.tool_calls?.length ? m.tool_calls.map((tc) => tc.name) : undefined,
        }));

      res.json({
        success: true,
        sessionId,
        messages: displayMessages,
        total:    displayMessages.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/agent/history
   * Query: { sessionId }
   */
  async clearHistory(req, res, next) {
    try {
      const userId    = req.user.id;
      const { sessionId } = req.query;
      if (!sessionId) return badRequest(res, "sessionId is required");

      await redisService.client?.del(SESSION_KEY(userId, sessionId)).catch(() => {});

      res.json({ success: true, message: "Conversation history cleared." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/agent/sessions
   */
  async getSessions(req, res, next) {
    try {
      const userId = req.user.id;
      const raw    = await redisService.client?.get(SESSIONS_INDEX_KEY(userId)) || "[]";
      const sessions = JSON.parse(raw);

      res.json({ success: true, sessions });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AIAgentController();