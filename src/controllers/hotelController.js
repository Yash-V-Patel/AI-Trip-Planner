const prisma = require('../config/prisma');

const hotelController = {
  // Create a hotel booking
  createHotel: async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const hotelData = req.body;

      // Check if trip exists
      const trip = await prisma.trip.findUnique({
        where: { id: tripId }
      });

      if (!trip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Create hotel booking
      const hotel = await prisma.hotel.create({
        data: {
          ...hotelData,
          tripId,
          checkIn: new Date(hotelData.checkIn),
          checkOut: new Date(hotelData.checkOut)
        }
      });

      res.status(201).json({
        success: true,
        message: 'Hotel booking created successfully',
        data: hotel
      });
    } catch (error) {
      next(error);
    }
  },

  // Get all hotels for a trip
  getTripHotels: async (req, res, next) => {
    try {
      const { tripId } = req.params;

      const hotels = await prisma.hotel.findMany({
        where: { tripId },
        orderBy: {
          checkIn: 'asc'
        }
      });

      res.json({
        success: true,
        count: hotels.length,
        data: hotels
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single hotel
  getHotelById: async (req, res, next) => {
    try {
      const { hotelId } = req.params;

      const hotel = await prisma.hotel.findUnique({
        where: { id: hotelId }
      });

      if (!hotel) {
        return res.status(404).json({
          error: 'Hotel booking not found'
        });
      }

      res.json({
        success: true,
        data: hotel
      });
    } catch (error) {
      next(error);
    }
  },

  // Update hotel booking
  updateHotel: async (req, res, next) => {
    try {
      const { hotelId } = req.params;
      const updates = req.body;

      const hotel = await prisma.hotel.update({
        where: { id: hotelId },
        data: updates
      });

      res.json({
        success: true,
        message: 'Hotel booking updated successfully',
        data: hotel
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete hotel booking
  deleteHotel: async (req, res, next) => {
    try {
      const { hotelId } = req.params;

      await prisma.hotel.delete({
        where: { id: hotelId }
      });

      res.json({
        success: true,
        message: 'Hotel booking deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Search hotels by location (for AI recommendations)
  searchHotels: async (req, res, next) => {
    try {
      const { location, checkIn, checkOut, budget, rating } = req.query;

      // This would integrate with external hotel APIs
      // For now, return mock data
      const mockHotels = [
        {
          name: "Luxury Hotel",
          address: "123 Main St",
          rating: 4.5,
          pricePerNight: 200,
          amenities: ["Pool", "Spa", "Free WiFi"]
        },
        {
          name: "Budget Inn",
          address: "456 Side St",
          rating: 3.8,
          pricePerNight: 80,
          amenities: ["Free WiFi", "Breakfast"]
        }
      ];

      res.json({
        success: true,
        message: 'Hotels found',
        data: mockHotels
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = hotelController;