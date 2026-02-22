const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class AccommodationController {
  constructor() {
    // Bind all methods to ensure 'this' works correctly
    this.createAccommodation = this.createAccommodation.bind(this);
    this.getAllAccommodations = this.getAllAccommodations.bind(this);
    this.getAccommodationById = this.getAccommodationById.bind(this);
    this.updateAccommodation = this.updateAccommodation.bind(this);
    this.deleteAccommodation = this.deleteAccommodation.bind(this);
    this.addRoom = this.addRoom.bind(this);
    this.updateRoom = this.updateRoom.bind(this);
    this.deleteRoom = this.deleteRoom.bind(this);
    this.addService = this.addService.bind(this);
    this.updateService = this.updateService.bind(this);
    this.deleteService = this.deleteService.bind(this);
    this.createBooking = this.createBooking.bind(this);
    this.getBookingById = this.getBookingById.bind(this);
    this.updateBooking = this.updateBooking.bind(this);
    this.cancelBooking = this.cancelBooking.bind(this);
    this.getAvailableRooms = this.getAvailableRooms.bind(this);
    this.canManageAccommodation = this.canManageAccommodation.bind(this);
    this.canManageRoom = this.canManageRoom.bind(this);
    this.canManageService = this.canManageService.bind(this);
    this.checkTravelPlanPermission = this.checkTravelPlanPermission.bind(this);
    this.getPriceCategoryFromMax = this.getPriceCategoryFromMax.bind(this);
    this.checkIsVendor = this.checkIsVendor.bind(this);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Check if user has permission for travel plan operations
   */
  async checkTravelPlanPermission(userId, travelPlanId, requiredPermission) {
    // SuperAdmin always has access
    if (this.req?.user?.isSuperAdmin) return true;

    try {
      switch (requiredPermission) {
        case "edit":
          return await openfgaService.canEditTravelPlan?.(userId, travelPlanId) || false;
        case "view":
          return await openfgaService.canViewTravelPlan?.(userId, travelPlanId) || false;
        case "suggest":
          return await openfgaService.canSuggestTravelPlan?.(userId, travelPlanId) || false;
        default:
          return false;
      }
    } catch (error) {
      console.error("Error checking travel plan permission:", error);
      return false;
    }
  }

  /**
   * Check if user is an approved vendor
   */
  async checkIsVendor(userId) {
    try {
      if (!userId) return false;
      
      // Check if user has vendor role in OpenFGA
      const isVendor = await openfgaService.checkPermission?.(
        userId,
        "can_manage_own_accommodations",
        "vendor:global"
      ) || false;
      
      return isVendor;
    } catch (error) {
      console.error("Error checking vendor status:", error);
      return false;
    }
  }

  /**
   * Check if user can manage accommodation (create/update/delete)
   * SuperAdmin always has access
   * Vendor has access to their own accommodations
   */
  async canManageAccommodation(user, accommodationId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      if (!accommodationId) {
        // Creating new accommodation - check if user is an approved vendor
        const isVendor = await this.checkIsVendor(user?.id);
        return isVendor;
      }

      // For existing accommodations, check if user is the vendor who owns it
      const accommodation = await prisma.accommodation.findUnique({
        where: { id: accommodationId },
        select: { vendorId: true }
      });

      if (!accommodation) return false;

      // If user is the vendor who owns this accommodation
      if (accommodation.vendorId === user?.id) {
        // Vendors can do everything except delete (maybe allow delete if no bookings)
        if (action === "delete") {
          // Check if accommodation has any active bookings
          const activeBookings = await prisma.accommodationBooking.count({
            where: {
              accommodationId,
              bookingStatus: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }
            }
          });
          return activeBookings === 0; // Can only delete if no active bookings
        }
        return true; // Vendors can view, edit, update their own
      }

      // Check OpenFGA permissions for other cases (managers, editors, etc.)
      switch (action) {
        case "delete":
          return await openfgaService.canDeleteAccommodation?.(user?.id, accommodationId) || false;
        case "update":
          return await openfgaService.canUpdateAccommodation?.(user?.id, accommodationId) || false;
        case "edit":
          return await openfgaService.canEditAccommodation?.(user?.id, accommodationId) || false;
        case "view":
          return await openfgaService.canViewAccommodation?.(user?.id, accommodationId) || false;
        default:
          return false;
      }
    } catch (error) {
      console.error("Error in canManageAccommodation:", error);
      return false;
    }
  }

  /**
   * Check if user can manage rooms
   * SuperAdmin always has access
   * Vendor can manage rooms in their own accommodations
   */
  async canManageRoom(user, accommodationId, roomId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      // First check if user is the vendor who owns this accommodation
      const accommodation = await prisma.accommodation.findUnique({
        where: { id: accommodationId },
        select: { vendorId: true }
      });

      if (accommodation?.vendorId === user?.id) {
        return true; // Vendors can manage rooms in their own accommodations
      }

      if (roomId) {
        // Check specific room permissions
        switch (action) {
          case "delete":
            return await openfgaService.canDeleteRoom?.(user?.id, roomId) || false;
          case "edit":
            return await openfgaService.canEditRoom?.(user?.id, roomId) || false;
          case "view":
            return await openfgaService.canViewRoom?.(user?.id, roomId) || false;
          default:
            return false;
        }
      } else {
        // Check if user can manage rooms in this accommodation
        return await openfgaService.canManageAccommodationRooms?.(
          user?.id,
          accommodationId,
        ) || false;
      }
    } catch (error) {
      console.error("Error in canManageRoom:", error);
      return false;
    }
  }

  /**
   * Check if user can manage services
   * SuperAdmin always has access
   * Vendor can manage services in their own accommodations
   */
  async canManageService(user, accommodationId, serviceId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      // First check if user is the vendor who owns this accommodation
      const accommodation = await prisma.accommodation.findUnique({
        where: { id: accommodationId },
        select: { vendorId: true }
      });

      if (accommodation?.vendorId === user?.id) {
        return true; // Vendors can manage services in their own accommodations
      }

      if (serviceId) {
        // Check specific service permissions
        switch (action) {
          case "delete":
            return await openfgaService.canDeleteService?.(user?.id, serviceId) || false;
          case "edit":
            return await openfgaService.canEditService?.(user?.id, serviceId) || false;
          case "view":
            return await openfgaService.canViewService?.(user?.id, serviceId) || false;
          default:
            return false;
        }
      } else {
        // Check if user can manage services in this accommodation
        return await openfgaService.canManageAccommodationServices?.(
          user?.id,
          accommodationId,
        ) || false;
      }
    } catch (error) {
      console.error("Error in canManageService:", error);
      return false;
    }
  }

  // ==================== ACCOMMODATION MANAGEMENT ====================

  /**
   * Create a new accommodation
   * POST /api/accommodations
   * Access: Vendors and SuperAdmins
   */
  async createAccommodation(req, res, next) {
    try {
      // Check permission
      const canManage = await this.canManageAccommodation(req.user);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'Only approved vendors can create accommodations'
        });
      }

      const accommodationData = req.body;

      // Convert phone to string if present
      if (accommodationData.phone) {
        accommodationData.phone = String(accommodationData.phone);
      }

      // Add vendorId to track ownership
      accommodationData.vendorId = req.user.id;

      const accommodation = await prisma.accommodation.create({
        data: accommodationData,
        include: {
          rooms: true,
          services: true
        }
      });

      // Set up OpenFGA relations - make creator the owner
      if (openfgaService.createAccommodationRelations) {
        await openfgaService.createAccommodationRelations(req.user.id, accommodation.id);
      }

      // Invalidate accommodations list cache
      await redisService.client?.del('accommodations:list:*');

      res.status(201).json({
        success: true,
        data: accommodation,
        message: 'Accommodation created successfully'
      });
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
        return res.status(409).json({
          success: false,
          message: 'Accommodation with this name already exists'
        });
      }
      next(error);
    }
  }

  /**
   * Get all accommodations with filtering
   * GET /api/accommodations
   * Access: Public
   */
  async getAllAccommodations(req, res, next) {
    try {
      const {
        city,
        country,
        type,
        minRating,
        maxPrice,
        page = 1,
        limit = 10,
      } = req.query;

      // Build cache key
      const cacheKey = `accommodations:list:${city || ""}:${country || ""}:${type || ""}:${page}:${limit}`;

      // Try cache first
      let result = await redisService.client?.get(cacheKey);
      if (result && !req.query.skipCache) {
        return res.json({
          success: true,
          ...JSON.parse(result),
          cached: true,
        });
      }

      // Build filter
      const where = {};
      if (city) where.city = { contains: city, mode: "insensitive" };
      if (country) where.country = { contains: country, mode: "insensitive" };
      if (type) where.accommodationType = type;
      if (minRating) where.starRating = { gte: parseInt(minRating) };
      if (maxPrice)
        where.priceCategory = this.getPriceCategoryFromMax(parseInt(maxPrice));

      // Only show active accommodations to public
      where.isActive = true;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [accommodations, total] = await Promise.all([
        prisma.accommodation.findMany({
          where,
          include: {
            rooms: {
              where: { isAvailable: true },
              take: 5,
            },
            _count: {
              select: {
                rooms: true,
                bookings: true,
              },
            },
          },
          skip,
          take: parseInt(limit),
          orderBy: { createdAt: "desc" },
        }),
        prisma.accommodation.count({ where }),
      ]);

      const response = {
        success: true,
        data: accommodations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      };

      // Cache for 10 minutes
      await redisService.client?.setex(cacheKey, 600, JSON.stringify(response));

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get accommodation by ID
   * GET /api/accommodations/:id
   * Access: Public
   */
  async getAccommodationById(req, res, next) {
    try {
      const { id } = req.params;

      // Try cache first
      const cacheKey = `accommodation:${id}`;
      let accommodation = await redisService.client?.get(cacheKey);

      if (accommodation && !req.query.skipCache) {
        return res.json({
          success: true,
          data: JSON.parse(accommodation),
          cached: true,
        });
      }

      accommodation = await prisma.accommodation.findUnique({
        where: { id },
        include: {
          rooms: {
            where: { isAvailable: true },
            orderBy: { basePrice: "asc" },
          },
          services: {
            where: { isAvailable: true },
          },
        },
      });

      if (!accommodation) {
        return res.status(404).json({
          success: false,
          message: "Accommodation not found",
        });
      }

      // Check if accommodation is active
      if (!accommodation.isActive) {
        return res.status(403).json({
          success: false,
          message: "This accommodation is currently unavailable",
        });
      }

      // Cache for 1 hour
      await redisService.client?.setex(cacheKey, 3600, JSON.stringify(accommodation));

      res.json({
        success: true,
        data: accommodation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update accommodation
   * PUT /api/accommodations/:id
   * Access: Vendor (own) / SuperAdmin
   */
  async updateAccommodation(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageAccommodation(req.user, id, 'update');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own accommodations'
        });
      }

      const updateData = req.body;

      // Convert phone to string if present
      if (updateData.phone) {
        updateData.phone = String(updateData.phone);
      }

      // Don't allow changing vendorId
      delete updateData.vendorId;

      const accommodation = await prisma.accommodation.update({
        where: { id },
        data: updateData,
        include: {
          rooms: true,
          services: true
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`accommodation:${id}`),
        redisService.client?.del('accommodations:list:*')
      ]);

      res.json({
        success: true,
        data: accommodation,
        message: 'Accommodation updated successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Accommodation not found'
        });
      }
      next(error);
    }
  }

  /**
   * Delete accommodation
   * DELETE /api/accommodations/:id
   * Access: Vendor (own, with no active bookings) / SuperAdmin
   */
  async deleteAccommodation(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageAccommodation(req.user, id, 'delete');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own accommodations with no active bookings'
        });
      }

      // Double-check if accommodation has active bookings
      const activeBookings = await prisma.accommodationBooking.count({
        where: {
          accommodationId: id,
          bookingStatus: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }
        }
      });

      if (activeBookings > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete accommodation with active bookings. Deactivate it instead.'
        });
      }

      await prisma.accommodation.delete({
        where: { id }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`accommodation:${id}`),
        redisService.client?.del('accommodations:list:*')
      ]);

      res.json({
        success: true,
        message: 'Accommodation deleted successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Accommodation not found'
        });
      }
      next(error);
    }
  }

  // ==================== ROOM MANAGEMENT ====================

  /**
   * Add room to accommodation
   * POST /api/accommodations/:accommodationId/rooms
   * Access: Vendor (own) / SuperAdmin
   */
  async addRoom(req, res, next) {
    try {
      const { accommodationId } = req.params;

      // Check permission
      const canManage = await this.canManageRoom(req.user, accommodationId, null, 'edit');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only add rooms to your own accommodations'
        });
      }

      const roomData = req.body;

      const room = await prisma.accommodationRoom.create({
        data: {
          ...roomData,
          accommodationId
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createRoomRelations) {
        await openfgaService.createRoomRelations(req.user.id, room.id, accommodationId);
      }

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${accommodationId}`);

      res.status(201).json({
        success: true,
        data: room,
        message: 'Room added successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update room
   * PUT /api/rooms/:roomId
   * Access: Vendor (own) / SuperAdmin
   */
  async updateRoom(req, res, next) {
    try {
      const { roomId } = req.params;

      const room = await prisma.accommodationRoom.findUnique({
        where: { id: roomId },
        include: {
          accommodation: {
            select: { id: true, vendorId: true },
          },
        },
      });

      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }

      // Check permission (using accommodationId)
      const canManage = await this.canManageRoom(
        req.user,
        room.accommodation.id,
        roomId,
        'edit'
      );
      
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update rooms in your own accommodations",
        });
      }

      const updatedRoom = await prisma.accommodationRoom.update({
        where: { id: roomId },
        data: req.body,
      });

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${room.accommodation.id}`);

      res.json({
        success: true,
        data: updatedRoom,
        message: "Room updated successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }
      next(error);
    }
  }

  /**
   * Delete room
   * DELETE /api/rooms/:roomId
   * Access: Vendor (own, with no future bookings) / SuperAdmin
   */
  async deleteRoom(req, res, next) {
    try {
      const { roomId } = req.params;

      const room = await prisma.accommodationRoom.findUnique({
        where: { id: roomId },
        include: {
          accommodation: {
            select: { id: true, vendorId: true },
          },
        },
      });

      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }

      // Check permission
      const canManage = await this.canManageRoom(
        req.user,
        room.accommodation.id,
        roomId,
        'delete'
      );
      
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only delete rooms in your own accommodations",
        });
      }

      // Check if room has future bookings
      const futureBookings = await prisma.accommodationBooking.count({
        where: {
          rooms: {
            some: { id: roomId },
          },
          checkInDate: { gt: new Date() },
          bookingStatus: { in: ["PENDING", "CONFIRMED"] },
        },
      });

      if (futureBookings > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete room with future bookings. Mark it as unavailable instead.",
        });
      }

      await prisma.accommodationRoom.delete({
        where: { id: roomId },
      });

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${room.accommodation.id}`);

      res.json({
        success: true,
        message: "Room deleted successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }
      next(error);
    }
  }

  // ==================== SERVICE MANAGEMENT ====================

  /**
   * Add service to accommodation
   * POST /api/accommodations/:accommodationId/services
   * Access: Vendor (own) / SuperAdmin
   */
  async addService(req, res, next) {
    try {
      const { accommodationId } = req.params;

      // Check permission
      const canManage = await this.canManageService(req.user, accommodationId, null, 'edit');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only add services to your own accommodations'
        });
      }

      const service = await prisma.accommodationService.create({
        data: {
          ...req.body,
          accommodationId
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createServiceRelations) {
        await openfgaService.createServiceRelations(req.user.id, service.id, accommodationId);
      }

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${accommodationId}`);

      res.status(201).json({
        success: true,
        data: service,
        message: 'Service added successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update service
   * PUT /api/services/:serviceId
   * Access: Vendor (own) / SuperAdmin
   */
  async updateService(req, res, next) {
    try {
      const { serviceId } = req.params;

      const service = await prisma.accommodationService.findUnique({
        where: { id: serviceId },
        include: {
          accommodation: {
            select: { id: true, vendorId: true },
          },
        },
      });

      if (!service) {
        return res.status(404).json({
          success: false,
          message: "Service not found",
        });
      }

      // Check permission
      const canManage = await this.canManageService(
        req.user,
        service.accommodation.id,
        serviceId,
        'edit'
      );
      
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update services in your own accommodations",
        });
      }

      const updatedService = await prisma.accommodationService.update({
        where: { id: serviceId },
        data: req.body,
      });

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${service.accommodation.id}`);

      res.json({
        success: true,
        data: updatedService,
        message: "Service updated successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Service not found",
        });
      }
      next(error);
    }
  }

  /**
   * Delete service
   * DELETE /api/services/:serviceId
   * Access: Vendor (own) / SuperAdmin
   */
  async deleteService(req, res, next) {
    try {
      const { serviceId } = req.params;

      const service = await prisma.accommodationService.findUnique({
        where: { id: serviceId },
        include: {
          accommodation: {
            select: { id: true, vendorId: true },
          },
        },
      });

      if (!service) {
        return res.status(404).json({
          success: false,
          message: "Service not found",
        });
      }

      // Check permission
      const canManage = await this.canManageService(
        req.user,
        service.accommodation.id,
        serviceId,
        'delete'
      );
      
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only delete services in your own accommodations",
        });
      }

      await prisma.accommodationService.delete({
        where: { id: serviceId },
      });

      // Invalidate accommodation cache
      await redisService.client?.del(`accommodation:${service.accommodation.id}`);

      res.json({
        success: true,
        message: "Service deleted successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Service not found",
        });
      }
      next(error);
    }
  }

  // ==================== BOOKING MANAGEMENT ====================
  // ... (keep all booking methods as they were - they don't change with vendor role)
  
  /**
   * Create accommodation booking
   * POST /api/travel-plans/:travelPlanId/accommodation-bookings
   * Access: TravelPlan Owner/Editor
   */
  async createBooking(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const bookingData = req.body;

      // Check if user has permission to edit the travel plan
      const canEdit = await openfgaService.canEditTravelPlan?.(
        req.user.id,
        travelPlanId,
      ) || false;
      
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan",
        });
      }

      // Validate dates
      const checkIn = new Date(bookingData.checkInDate);
      const checkOut = new Date(bookingData.checkOutDate);

      if (checkOut <= checkIn) {
        return res.status(400).json({
          success: false,
          message: "Check-out date must be after check-in date",
        });
      }

      // Calculate total nights
      const totalNights = Math.ceil(
        (checkOut - checkIn) / (1000 * 60 * 60 * 24),
      );

      // Verify rooms are available
      const accommodation = await prisma.accommodation.findUnique({
        where: { id: bookingData.accommodationId },
        include: {
          rooms: {
            where: {
              roomNumber: { in: bookingData.selectedRoomNumbers },
              isAvailable: true,
            },
          },
        },
      });

      if (!accommodation) {
        return res.status(404).json({
          success: false,
          message: "Accommodation not found",
        });
      }

      if (accommodation.rooms.length !== bookingData.selectedRoomNumbers.length) {
        return res.status(400).json({
          success: false,
          message: "One or more selected rooms are not available",
        });
      }

      // Check for booking conflicts
      const conflictingBookings = await prisma.accommodationBooking.findMany({
        where: {
          accommodationId: bookingData.accommodationId,
          bookingStatus: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          selectedRoomNumbers: { hasSome: bookingData.selectedRoomNumbers },
          OR: [
            {
              AND: [
                { checkInDate: { lte: checkOut } },
                { checkOutDate: { gte: checkIn } },
              ],
            },
          ],
        },
      });

      if (conflictingBookings.length > 0) {
        return res.status(409).json({
          success: false,
          message: "One or more rooms are already booked for these dates",
        });
      }

      // Create booking
      const booking = await prisma.accommodationBooking.create({
        data: {
          ...bookingData,
          totalNights,
          travelPlanId,
        },
        include: {
          accommodation: true,
          rooms: true,
        },
      });

      // Set up OpenFGA relations
      if (openfgaService.createAccommodationBookingRelations) {
        await openfgaService.createAccommodationBookingRelations(
          req.user.id,
          booking.id,
          travelPlanId,
        );
      }

      // Invalidate travel plan cache
      await redisService.client?.del(`travelplan:${travelPlanId}`);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Accommodation booking created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get booking by ID
   * GET /api/accommodation-bookings/:bookingId
   * Access: TravelPlan Owner/Editor/Viewer/Suggester
   */
  async getBookingById(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: {
          accommodation: true,
          rooms: true,
          travelPlan: {
            select: {
              id: true,
              title: true,
              userId: true,
            },
          },
        },
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Check permission
      const canView = await openfgaService.canViewAccommodationBooking?.(
        req.user.id,
        bookingId,
      ) || false;
      
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this booking",
        });
      }

      res.json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update booking
   * PUT /api/accommodation-bookings/:bookingId
   * Access: TravelPlan Owner/Editor
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canEdit = await openfgaService.canEditAccommodationBooking?.(
        req.user.id,
        bookingId,
      ) || false;
      
      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking",
        });
      }

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true },
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Don't allow updates to cancelled or completed bookings
      if (["CANCELLED", "CHECKED_OUT", "NO_SHOW"].includes(booking.bookingStatus)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.bookingStatus}`,
        });
      }

      const updatedBooking = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: req.body,
        include: {
          accommodation: true,
          rooms: true,
        },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`),
      ]);

      res.json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel booking
   * DELETE /api/accommodation-bookings/:bookingId
   * Access: TravelPlan Owner/Editor
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission
      const canCancel = await openfgaService.canCancelAccommodationBooking?.(
        req.user.id,
        bookingId,
      ) || false;
      
      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking",
        });
      }

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true },
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Update booking status to cancelled
      const cancelledBooking = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: {
          bookingStatus: "CANCELLED",
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : "PENDING",
        },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`),
      ]);

      res.json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get available rooms for accommodation
   * GET /api/accommodations/:accommodationId/available-rooms
   * Access: Public
   */
  async getAvailableRooms(req, res, next) {
    try {
      const { accommodationId } = req.params;
      const { checkIn, checkOut, guests } = req.query;

      if (!checkIn || !checkOut) {
        return res.status(400).json({
          success: false,
          message: "Check-in and check-out dates are required",
        });
      }

      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);

      // Get all rooms for the accommodation
      const rooms = await prisma.accommodationRoom.findMany({
        where: {
          accommodationId,
          isAvailable: true,
          maxOccupancy: { gte: parseInt(guests) || 1 },
        },
      });

      // Find booked room IDs for the date range
      const bookedRooms = await prisma.accommodationBooking.findMany({
        where: {
          accommodationId,
          bookingStatus: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          OR: [
            {
              AND: [
                { checkInDate: { lte: checkOutDate } },
                { checkOutDate: { gte: checkInDate } },
              ],
            },
          ],
        },
        select: {
          selectedRoomNumbers: true,
        },
      });

      const bookedRoomNumbers = bookedRooms.flatMap((b) => b.selectedRoomNumbers);

      // Filter available rooms
      const availableRooms = rooms.filter(
        (room) => !bookedRoomNumbers.includes(room.roomNumber),
      );

      res.json({
        success: true,
        data: availableRooms,
        totalAvailable: availableRooms.length,
        totalRooms: rooms.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get price category from max price
   */
  getPriceCategoryFromMax(maxPrice) {
    if (maxPrice < 100) return "BUDGET";
    if (maxPrice < 300) return "MIDRANGE";
    if (maxPrice < 500) return "LUXURY";
    return "BOUTIQUE";
  }
}

module.exports = new AccommodationController();