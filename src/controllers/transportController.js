const prisma = require('../config/prisma');

const transportController = {
  // Create a transport booking
  createTransport: async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const transportData = req.body;

      // Check if trip exists
      const trip = await prisma.trip.findUnique({
        where: { id: tripId }
      });

      if (!trip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Create transport booking
      const transport = await prisma.transport.create({
        data: {
          ...transportData,
          tripId,
          pickupTime: new Date(transportData.pickupTime),
          estimatedArrival: transportData.estimatedArrival ? new Date(transportData.estimatedArrival) : null
        }
      });

      res.status(201).json({
        success: true,
        message: 'Transport booking created successfully',
        data: transport
      });
    } catch (error) {
      next(error);
    }
  },

  // Get all transports for a trip
  getTripTransports: async (req, res, next) => {
    try {
      const { tripId } = req.params;

      const transports = await prisma.transport.findMany({
        where: { tripId },
        orderBy: {
          pickupTime: 'asc'
        }
      });

      res.json({
        success: true,
        count: transports.length,
        data: transports
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single transport
  getTransportById: async (req, res, next) => {
    try {
      const { transportId } = req.params;

      const transport = await prisma.transport.findUnique({
        where: { id: transportId }
      });

      if (!transport) {
        return res.status(404).json({
          error: 'Transport booking not found'
        });
      }

      res.json({
        success: true,
        data: transport
      });
    } catch (error) {
      next(error);
    }
  },

  // Update transport booking
  updateTransport: async (req, res, next) => {
    try {
      const { transportId } = req.params;
      const updates = req.body;

      const transport = await prisma.transport.update({
        where: { id: transportId },
        data: updates
      });

      res.json({
        success: true,
        message: 'Transport booking updated successfully',
        data: transport
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete transport booking
  deleteTransport: async (req, res, next) => {
    try {
      const { transportId } = req.params;

      await prisma.transport.delete({
        where: { id: transportId }
      });

      res.json({
        success: true,
        message: 'Transport booking deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Update transport status
  updateTransportStatus: async (req, res, next) => {
    try {
      const { transportId } = req.params;
      const { status } = req.body;

      const transport = await prisma.transport.update({
        where: { id: transportId },
        data: { status }
      });

      res.json({
        success: true,
        message: 'Transport status updated successfully',
        data: transport
      });
    } catch (error) {
      next(error);
    }
  },

  // Estimate fare
  estimateFare: async (req, res, next) => {
    try {
      const { pickupLocation, dropoffLocation, transportType } = req.body;

      // This would integrate with external APIs like Uber, Google Maps
      // For now, return mock data
      const estimates = [
        {
          type: 'TAXI',
          service: 'Local Taxi',
          estimatedFare: 25.50,
          duration: '15 mins',
          vehicleType: 'Sedan'
        },
        {
          type: 'TAXI',
          service: 'Premium Taxi',
          estimatedFare: 35.00,
          duration: '15 mins',
          vehicleType: 'SUV'
        }
      ];

      res.json({
        success: true,
        data: estimates
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = transportController;