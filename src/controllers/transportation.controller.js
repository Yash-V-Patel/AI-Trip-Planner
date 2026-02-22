const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class TransportationController {
  constructor() {
    // Bind all methods
    this.createProvider = this.createProvider.bind(this);
    this.getAllProviders = this.getAllProviders.bind(this);
    this.getProviderById = this.getProviderById.bind(this);
    this.updateProvider = this.updateProvider.bind(this);
    this.deleteProvider = this.deleteProvider.bind(this);
    this.addVehicle = this.addVehicle.bind(this);
    this.updateVehicle = this.updateVehicle.bind(this);
    this.deleteVehicle = this.deleteVehicle.bind(this);
    this.createBooking = this.createBooking.bind(this);
    this.getBookingById = this.getBookingById.bind(this);
    this.updateBooking = this.updateBooking.bind(this);
    this.cancelBooking = this.cancelBooking.bind(this);
    this.getAvailableVehicles = this.getAvailableVehicles.bind(this);
    this.calculateFare = this.calculateFare.bind(this);
    this.getProviderStats = this.getProviderStats.bind(this);
    this.getMyProviders = this.getMyProviders.bind(this);
    this.bulkAddVehicles = this.bulkAddVehicles.bind(this);
    this.updateVehicleLocation = this.updateVehicleLocation.bind(this);
    this.getVehicleHistory = this.getVehicleHistory.bind(this);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Check if user can manage transportation provider
   */
  async canManageProvider(user, providerId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      if (!providerId) {
        // Creating new provider - check if user is a vendor
        const isVendor = await openfgaService.isVendor?.(user?.id) || false;
        return isVendor;
      }

      // For existing providers, check via OpenFGA
      switch (action) {
        case "delete":
          return await openfgaService.canDeleteTransportationProvider?.(user?.id, providerId) || false;
        case "update":
          return await openfgaService.canUpdateTransportationProvider?.(user?.id, providerId) || false;
        case "edit":
          return await openfgaService.canEditTransportationProvider?.(user?.id, providerId) || false;
        case "view":
          return await openfgaService.canViewTransportationProvider?.(user?.id, providerId) || false;
        case "manage_vehicles":
          return await openfgaService.canManageProviderVehicles?.(user?.id, providerId) || false;
        default:
          return false;
      }
    } catch (error) {
      console.error("Error in canManageProvider:", error);
      return false;
    }
  }

  /**
   * Check if user can manage vehicles
   */
  async canManageVehicle(user, providerId, vehicleId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      if (vehicleId) {
        // Check specific vehicle permissions
        switch (action) {
          case "delete":
            return await openfgaService.canDeleteTransportationVehicle?.(user?.id, vehicleId) || false;
          case "edit":
            return await openfgaService.canEditTransportationVehicle?.(user?.id, vehicleId) || false;
          case "view":
            return await openfgaService.canViewTransportationVehicle?.(user?.id, vehicleId) || false;
          default:
            return false;
        }
      } else {
        // Check if user can manage vehicles in this provider
        return await this.canManageProvider(user, providerId, 'manage_vehicles');
      }
    } catch (error) {
      console.error("Error in canManageVehicle:", error);
      return false;
    }
  }

  /**
   * Check if user has permission for travel plan operations
   */
  async checkTravelPlanPermission(userId, travelPlanId, requiredPermission) {
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

  // ==================== TRANSPORTATION PROVIDER MANAGEMENT ====================

  /**
   * Create a new transportation provider
   * POST /api/transportation/providers
   */
  async createProvider(req, res, next) {
    try {
      // Check permission
      const canManage = await this.canManageProvider(req.user);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'Only approved vendors can create transportation providers'
        });
      }

      const providerData = req.body;

      // Convert contact number to string if present
      if (providerData.contactNumber) {
        providerData.contactNumber = String(providerData.contactNumber);
      }

      // Add vendorId to track ownership
      providerData.vendorId = req.user.id;

      const provider = await prisma.transportationProvider.create({
        data: providerData,
        include: {
          vehicles: true
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createTransportationProviderRelations) {
        await openfgaService.createTransportationProviderRelations(req.user.id, provider.id);
      }

      // Invalidate providers list cache
      await redisService.client?.del('transportation:providers:list:*');

      res.status(201).json({
        success: true,
        data: provider,
        message: 'Transportation provider created successfully'
      });
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
        return res.status(409).json({
          success: false,
          message: 'Provider with this name already exists'
        });
      }
      next(error);
    }
  }

  /**
   * Get all transportation providers with filtering
   * GET /api/transportation/providers
   */
  async getAllProviders(req, res, next) {
    try {
      const {
        providerType,
        city,
        minRating,
        page = 1,
        limit = 10,
        sortBy = 'rating',
        sortOrder = 'desc'
      } = req.query;

      // Build cache key
      const cacheKey = `transportation:providers:list:${providerType || ''}:${city || ''}:${page}:${limit}`;

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
      if (providerType) where.providerType = providerType;
      if (city) where.serviceArea = { has: city };
      if (minRating) where.rating = { gte: parseFloat(minRating) };

      // Only show active providers to public
      where.isAvailable = true;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build orderBy
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      const [providers, total] = await Promise.all([
        prisma.transportationProvider.findMany({
          where,
          include: {
            vehicles: {
              where: { isAvailable: true },
              take: 5,
              select: {
                id: true,
                vehicleType: true,
                capacity: true,
                amenities: true,
                driverRating: true
              }
            },
            _count: {
              select: {
                vehicles: true,
                bookings: true,
              },
            },
          },
          skip,
          take: parseInt(limit),
          orderBy,
        }),
        prisma.transportationProvider.count({ where }),
      ]);

      const response = {
        success: true,
        data: providers,
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
   * Get provider by ID
   * GET /api/transportation/providers/:id
   */
  async getProviderById(req, res, next) {
    try {
      const { id } = req.params;

      // Try cache first
      const cacheKey = `transportation:provider:${id}`;
      let provider = await redisService.client?.get(cacheKey);

      if (provider && !req.query.skipCache) {
        return res.json({
          success: true,
          data: JSON.parse(provider),
          cached: true,
        });
      }

      provider = await prisma.transportationProvider.findUnique({
        where: { id },
        include: {
          vehicles: {
            where: { isAvailable: true },
            orderBy: { createdAt: "desc" },
          },
          bookings: {
            take: 10,
            orderBy: { createdAt: "desc" },
            include: {
              travelPlan: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
          _count: {
            select: {
              vehicles: true,
              bookings: true,
            },
          },
        },
      });

      if (!provider) {
        return res.status(404).json({
          success: false,
          message: "Transportation provider not found",
        });
      }

      // Check if provider is active
      if (!provider.isAvailable && !req.user?.isSuperAdmin && req.user?.id !== provider.vendorId) {
        return res.status(403).json({
          success: false,
          message: "This provider is currently unavailable",
        });
      }

      // Cache for 1 hour
      await redisService.client?.setex(cacheKey, 3600, JSON.stringify(provider));

      res.json({
        success: true,
        data: provider,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor's own providers
   * GET /api/transportation/my-providers
   */
  async getMyProviders(req, res, next) {
    try {
      const userId = req.user.id;

      const providers = await prisma.transportationProvider.findMany({
        where: { vendorId: userId },
        include: {
          vehicles: true,
          _count: {
            select: {
              vehicles: true,
              bookings: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({
        success: true,
        data: providers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update provider
   * PUT /api/transportation/providers/:id
   */
  async updateProvider(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageProvider(req.user, id, 'update');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own transportation providers'
        });
      }

      const updateData = req.body;

      // Convert contact number to string if present
      if (updateData.contactNumber) {
        updateData.contactNumber = String(updateData.contactNumber);
      }

      // Don't allow changing vendorId
      delete updateData.vendorId;

      const provider = await prisma.transportationProvider.update({
        where: { id },
        data: updateData,
        include: {
          vehicles: true,
        },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`transportation:provider:${id}`),
        redisService.client?.del('transportation:providers:list:*')
      ]);

      res.json({
        success: true,
        data: provider,
        message: 'Transportation provider updated successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }
      next(error);
    }
  }

  /**
   * Delete provider
   * DELETE /api/transportation/providers/:id
   */
  async deleteProvider(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageProvider(req.user, id, 'delete');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own providers with no active bookings'
        });
      }

      // Check if provider has active bookings
      const activeBookings = await prisma.transportationBooking.count({
        where: {
          providerId: id,
          status: { in: ['BOOKED', 'CONFIRMED', 'ON_THE_WAY'] }
        }
      });

      if (activeBookings > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete provider with active bookings. Mark it as unavailable instead.'
        });
      }

      await prisma.transportationProvider.delete({
        where: { id }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`transportation:provider:${id}`),
        redisService.client?.del('transportation:providers:list:*')
      ]);

      res.json({
        success: true,
        message: 'Transportation provider deleted successfully'
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }
      next(error);
    }
  }

  /**
   * Get provider statistics
   * GET /api/transportation/providers/:id/stats
   */
  async getProviderStats(req, res, next) {
    try {
      const { id } = req.params;

      // Check if user can view this provider
      const canView = await this.canManageProvider(req.user, id, 'view');
      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view these statistics'
        });
      }

      const [
        totalBookings,
        completedBookings,
        cancelledBookings,
        totalRevenue,
        averageRating,
        vehicleUtilization
      ] = await Promise.all([
        prisma.transportationBooking.count({ where: { providerId: id } }),
        prisma.transportationBooking.count({ where: { providerId: id, status: 'COMPLETED' } }),
        prisma.transportationBooking.count({ where: { providerId: id, status: 'CANCELLED' } }),
        prisma.transportationBooking.aggregate({
          where: { providerId: id, status: 'COMPLETED' },
          _sum: { actualFare: true }
        }),
        prisma.transportationVehicle.aggregate({
          where: { providerId: id },
          _avg: { driverRating: true }
        }),
        prisma.transportationVehicle.count({
          where: { providerId: id, isAvailable: true }
        })
      ]);

      const totalVehicles = await prisma.transportationVehicle.count({
        where: { providerId: id }
      });

      res.json({
        success: true,
        data: {
          totalBookings,
          completedBookings,
          cancelledBookings,
          totalRevenue: totalRevenue._sum.actualFare || 0,
          averageRating: averageRating._avg.driverRating || 0,
          vehicleUtilization: {
            available: vehicleUtilization,
            total: totalVehicles,
            percentage: totalVehicles > 0 ? (vehicleUtilization / totalVehicles) * 100 : 0
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== VEHICLE MANAGEMENT ====================

  /**
   * Add vehicle to provider
   * POST /api/transportation/providers/:providerId/vehicles
   */
  async addVehicle(req, res, next) {
    try {
      const { providerId } = req.params;

      // Check permission
      const canManage = await this.canManageVehicle(req.user, providerId, null, 'edit');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only add vehicles to your own providers'
        });
      }

      const vehicleData = req.body;

      // Convert driver contact to string if present
      if (vehicleData.driverContact) {
        vehicleData.driverContact = String(vehicleData.driverContact);
      }

      const vehicle = await prisma.transportationVehicle.create({
        data: {
          ...vehicleData,
          providerId
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createTransportationVehicleRelations) {
        await openfgaService.createTransportationVehicleRelations(req.user.id, vehicle.id, providerId);
      }

      // Invalidate provider cache
      await redisService.client?.del(`transportation:provider:${providerId}`);

      res.status(201).json({
        success: true,
        data: vehicle,
        message: 'Vehicle added successfully'
      });
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target?.includes('vehicleNumber')) {
        return res.status(409).json({
          success: false,
          message: 'Vehicle with this number already exists'
        });
      }
      next(error);
    }
  }

  /**
   * Bulk add vehicles
   * POST /api/transportation/providers/:providerId/vehicles/bulk
   */
  async bulkAddVehicles(req, res, next) {
    try {
      const { providerId } = req.params;
      const { vehicles } = req.body;

      // Check permission
      const canManage = await this.canManageVehicle(req.user, providerId, null, 'edit');
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You can only add vehicles to your own providers'
        });
      }

      // Prepare vehicles data
      const vehiclesData = vehicles.map(v => ({
        ...v,
        providerId,
        driverContact: v.driverContact ? String(v.driverContact) : null
      }));

      // Create all vehicles
      const result = await prisma.$transaction(
        vehiclesData.map(v => 
          prisma.transportationVehicle.create({ data: v })
        )
      );

      // Set up OpenFGA relations for each vehicle
      if (openfgaService.createTransportationVehicleRelations) {
        await Promise.all(
          result.map(v => 
            openfgaService.createTransportationVehicleRelations(req.user.id, v.id, providerId)
          )
        );
      }

      // Invalidate provider cache
      await redisService.client?.del(`transportation:provider:${providerId}`);

      res.status(201).json({
        success: true,
        data: result,
        message: `${result.length} vehicles added successfully`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update vehicle
   * PUT /api/transportation/vehicles/:vehicleId
   */
  async updateVehicle(req, res, next) {
    try {
      const { vehicleId } = req.params;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where: { id: vehicleId },
        include: {
          provider: {
            select: { id: true }
          }
        }
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      // Check permission
      const canManage = await this.canManageVehicle(
        req.user,
        vehicle.provider.id,
        vehicleId,
        'edit'
      );

      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update vehicles in your own providers",
        });
      }

      const updateData = req.body;
      if (updateData.driverContact) {
        updateData.driverContact = String(updateData.driverContact);
      }

      const updatedVehicle = await prisma.transportationVehicle.update({
        where: { id: vehicleId },
        data: updateData,
      });

      // Invalidate provider cache
      await redisService.client?.del(`transportation:provider:${vehicle.provider.id}`);

      res.json({
        success: true,
        data: updatedVehicle,
        message: "Vehicle updated successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }
      next(error);
    }
  }

  /**
   * Update vehicle location
   * PATCH /api/transportation/vehicles/:vehicleId/location
   */
  async updateVehicleLocation(req, res, next) {
    try {
      const { vehicleId } = req.params;
      const { lat, lng } = req.body;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where: { id: vehicleId },
        include: {
          provider: {
            select: { id: true }
          }
        }
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      // Check permission (drivers or vendors can update location)
      const canManage = await this.canManageVehicle(
        req.user,
        vehicle.provider.id,
        vehicleId,
        'edit'
      );

      if (!canManage && req.user.id !== vehicle.driverName) { // Simple driver check
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this vehicle's location",
        });
      }

      const updatedVehicle = await prisma.transportationVehicle.update({
        where: { id: vehicleId },
        data: {
          currentLocation: {
            lat,
            lng,
            timestamp: new Date().toISOString()
          }
        },
      });

      res.json({
        success: true,
        data: updatedVehicle.currentLocation,
        message: "Vehicle location updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete vehicle
   * DELETE /api/transportation/vehicles/:vehicleId
   */
  async deleteVehicle(req, res, next) {
    try {
      const { vehicleId } = req.params;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where: { id: vehicleId },
        include: {
          provider: {
            select: { id: true }
          },
          bookings: {
            where: {
              status: { in: ['BOOKED', 'CONFIRMED', 'ON_THE_WAY'] },
              pickupTime: { gt: new Date() }
            }
          }
        }
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      // Check permission
      const canManage = await this.canManageVehicle(
        req.user,
        vehicle.provider.id,
        vehicleId,
        'delete'
      );

      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only delete vehicles in your own providers",
        });
      }

      // Check if vehicle has future bookings
      if (vehicle.bookings.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete vehicle with future bookings. Mark it as unavailable instead.",
        });
      }

      await prisma.transportationVehicle.delete({
        where: { id: vehicleId },
      });

      // Invalidate provider cache
      await redisService.client?.del(`transportation:provider:${vehicle.provider.id}`);

      res.json({
        success: true,
        message: "Vehicle deleted successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }
      next(error);
    }
  }

  /**
   * Get vehicle booking history
   * GET /api/transportation/vehicles/:vehicleId/history
   */
  async getVehicleHistory(req, res, next) {
    try {
      const { vehicleId } = req.params;
      const { from, to, limit = 50 } = req.query;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where: { id: vehicleId },
        include: {
          provider: {
            select: { id: true }
          }
        }
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      // Check permission
      const canView = await this.canManageVehicle(
        req.user,
        vehicle.provider.id,
        vehicleId,
        'view'
      );

      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this vehicle's history",
        });
      }

      // Build date filter
      const where = { vehicleId };
      if (from || to) {
        where.pickupTime = {};
        if (from) where.pickupTime.gte = new Date(from);
        if (to) where.pickupTime.lte = new Date(to);
      }

      const bookings = await prisma.transportationBooking.findMany({
        where,
        orderBy: { pickupTime: 'desc' },
        take: parseInt(limit),
        include: {
          travelPlan: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      res.json({
        success: true,
        data: bookings,
        total: bookings.length
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get available vehicles for a provider
   * GET /api/transportation/providers/:providerId/available-vehicles
   */
  async getAvailableVehicles(req, res, next) {
    try {
      const { providerId } = req.params;
      const { pickupTime, dropoffTime, passengers, vehicleType } = req.query;

      if (!pickupTime || !dropoffTime) {
        return res.status(400).json({
          success: false,
          message: "Pickup and dropoff times are required",
        });
      }

      const pickup = new Date(pickupTime);
      const dropoff = new Date(dropoffTime);

      // Build vehicle filter
      const vehicleWhere = {
        providerId,
        isAvailable: true,
        capacity: { gte: parseInt(passengers) || 1 }
      };
      if (vehicleType) vehicleWhere.vehicleType = vehicleType;

      // Get all vehicles for the provider
      const vehicles = await prisma.transportationVehicle.findMany({
        where: vehicleWhere
      });

      // Find booked vehicles for the time range
      const bookedVehicles = await prisma.transportationBooking.findMany({
        where: {
          providerId,
          status: { in: ['BOOKED', 'CONFIRMED', 'ON_THE_WAY'] },
          OR: [
            {
              AND: [
                { pickupTime: { lte: dropoff } },
                { estimatedArrival: { gte: pickup } }
              ]
            }
          ]
        },
        select: {
          vehicleId: true
        }
      });

      const bookedVehicleIds = bookedVehicles.map(b => b.vehicleId).filter(Boolean);

      // Filter available vehicles
      const availableVehicles = vehicles.filter(
        vehicle => !bookedVehicleIds.includes(vehicle.id)
      );

      // Get provider for fare calculation
      const provider = await prisma.transportationProvider.findUnique({
        where: { id: providerId },
        select: {
          baseFare: true,
          perKmRate: true,
          perMinuteRate: true
        }
      });

      res.json({
        success: true,
        data: availableVehicles,
        totalAvailable: availableVehicles.length,
        totalVehicles: vehicles.length,
        provider: {
          baseFare: provider?.baseFare,
          perKmRate: provider?.perKmRate,
          perMinuteRate: provider?.perMinuteRate
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate fare estimate
   * POST /api/transportation/calculate-fare
   */
  async calculateFare(req, res, next) {
    try {
      const { providerId, distance, duration, vehicleType } = req.body;

      const provider = await prisma.transportationProvider.findUnique({
        where: { id: providerId }
      });

      if (!provider) {
        return res.status(404).json({
          success: false,
          message: "Provider not found"
        });
      }

      // Calculate fare based on provider's pricing model
      let estimatedFare = provider.baseFare || 0;

      if (distance && provider.perKmRate) {
        estimatedFare += distance * provider.perKmRate;
      }

      if (duration && provider.perMinuteRate) {
        estimatedFare += duration * provider.perMinuteRate;
      }

      // Add vehicle type premium if applicable
      let vehiclePremium = 1.0;
      if (vehicleType) {
        const premiumVehicles = ['LUXURY', 'SUV', 'PREMIUM'];
        if (premiumVehicles.includes(vehicleType.toUpperCase())) {
          vehiclePremium = 1.5;
        }
      }

      estimatedFare *= vehiclePremium;

      res.json({
        success: true,
        data: {
          estimatedFare: Math.round(estimatedFare * 100) / 100,
          currency: 'USD',
          breakdown: {
            baseFare: provider.baseFare || 0,
            distanceCharge: distance && provider.perKmRate ? distance * provider.perKmRate : 0,
            timeCharge: duration && provider.perMinuteRate ? duration * provider.perMinuteRate : 0,
            vehiclePremium: vehiclePremium > 1 ? (estimatedFare - (estimatedFare / vehiclePremium)) : 0
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== BOOKING MANAGEMENT ====================

  /**
   * Create transportation booking
   * POST /api/travel-plans/:travelPlanId/transportation-bookings
   */
  async createBooking(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const bookingData = req.body;

      // Check if user has permission to edit the travel plan
      const canEdit = await this.checkTravelPlanPermission(
        req.user.id,
        travelPlanId,
        'edit'
      );

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to add bookings to this travel plan",
        });
      }

      // Validate times
      const pickupTime = new Date(bookingData.pickupTime);
      const estimatedArrival = bookingData.estimatedArrival ? new Date(bookingData.estimatedArrival) : null;

      if (estimatedArrival && estimatedArrival <= pickupTime) {
        return res.status(400).json({
          success: false,
          message: "Estimated arrival must be after pickup time",
        });
      }

      // Verify vehicle availability if specified
      if (bookingData.vehicleId) {
        const conflictingBookings = await prisma.transportationBooking.findMany({
          where: {
            vehicleId: bookingData.vehicleId,
            status: { in: ['BOOKED', 'CONFIRMED', 'ON_THE_WAY'] },
            OR: [
              {
                AND: [
                  { pickupTime: { lte: estimatedArrival || pickupTime } },
                  { estimatedArrival: { gte: pickupTime } }
                ]
              }
            ]
          }
        });

        if (conflictingBookings.length > 0) {
          return res.status(409).json({
            success: false,
            message: "Vehicle is not available for the selected time slot",
          });
        }
      }

      // Create booking
      const booking = await prisma.transportationBooking.create({
        data: {
          ...bookingData,
          travelPlanId
        },
        include: {
          provider: true,
          vehicle: true
        }
      });

      // Set up OpenFGA relations
      if (openfgaService.createTransportationBookingRelations) {
        await openfgaService.createTransportationBookingRelations(
          req.user.id,
          booking.id,
          travelPlanId
        );
      }

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${travelPlanId}`),
        redisService.client?.del(`transportation:provider:${booking.providerId}`)
      ]);

      res.status(201).json({
        success: true,
        data: booking,
        message: "Transportation booking created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get booking by ID
   * GET /api/transportation/bookings/:bookingId
   */
  async getBookingById(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: {
          provider: true,
          vehicle: true,
          travelPlan: {
            select: {
              id: true,
              title: true,
              userId: true
            }
          }
        }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Check permission via OpenFGA
      const canView = await openfgaService.canViewTransportationBooking?.(
        req.user.id,
        bookingId
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
   * PUT /api/transportation/bookings/:bookingId
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission via OpenFGA
      const canEdit = await openfgaService.canEditTransportationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this booking",
        });
      }

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Don't allow updates to completed or cancelled bookings
      if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update booking with status: ${booking.status}`,
        });
      }

      const updatedBooking = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: req.body,
        include: {
          provider: true,
          vehicle: true
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`transportation:provider:${booking.providerId}`)
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
   * DELETE /api/transportation/bookings/:bookingId
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      // Check permission via OpenFGA
      const canCancel = await openfgaService.canCancelTransportationBooking?.(
        req.user.id,
        bookingId
      ) || false;

      if (!canCancel && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to cancel this booking",
        });
      }

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: { travelPlan: true }
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      // Update booking status to cancelled
      const cancelledBooking = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: {
          status: "CANCELLED",
          isPaid: false,
          paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING'
        }
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`transportation:provider:${booking.providerId}`)
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
}

module.exports = new TransportationController();