const prisma = require('../config/prisma');

const tripController = {
  // Create a new trip
  createTrip: async (req, res, next) => {
    try {
      const {
        title,
        destination,
        description,
        startDate,
        endDate,
        budget,
        travelers,
        interests,
        userId
      } = req.body;

      // Basic validation
      if (!title || !destination || !startDate || !endDate) {
        return res.status(400).json({
          error: 'Title, destination, startDate, and endDate are required'
        });
      }

      // Create trip
      const trip = await prisma.trip.create({
        data: {
          title,
          destination,
          description,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          budget: budget ? parseFloat(budget) : null,
          travelers: travelers ? parseInt(travelers) : 1,
          interests: interests || [],
          userId: userId || 'temp-user-id' // Replace with actual user auth later
        }
      });

      res.status(201).json({
        success: true,
        message: 'Trip created successfully',
        data: trip
      });
    } catch (error) {
      next(error);
    }
  },

  // Get all trips
  getAllTrips: async (req, res, next) => {
    try {
      const trips = await prisma.trip.findMany({
        include: {
          activities: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      res.json({
        success: true,
        count: trips.length,
        data: trips
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single trip by ID
getTripById: async (req, res, next) => {
  try {
    const { id } = req.params;

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: {
        activities: {
          orderBy: {
            date: 'asc'
          }
        },
        hotels: {
          orderBy: {
            checkIn: 'asc'
          }
        },
        transports: {
          orderBy: {
            pickupTime: 'asc'
          }
        },
        stores: {
          orderBy: {
            plannedDate: 'asc'
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!trip) {
      return res.status(404).json({
        error: 'Trip not found'
      });
    }

    res.json({
      success: true,
      data: trip
    });
  } catch (error) {
    next(error);
  }
},

  // Update trip
  updateTrip: async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Check if trip exists
      const existingTrip = await prisma.trip.findUnique({
        where: { id }
      });

      if (!existingTrip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Update trip
      const updatedTrip = await prisma.trip.update({
        where: { id },
        data: updates
      });

      res.json({
        success: true,
        message: 'Trip updated successfully',
        data: updatedTrip
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete trip
  deleteTrip: async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if trip exists
      const existingTrip = await prisma.trip.findUnique({
        where: { id }
      });

      if (!existingTrip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Delete trip (cascade will delete activities)
      await prisma.trip.delete({
        where: { id }
      });

      res.json({
        success: true,
        message: 'Trip deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Generate AI trip plan
  generateAITrip: async (req, res, next) => {
    try {
      const { destination, preferences, budget, duration } = req.body;

      // TODO: Integrate with OpenAI API
      // For now, return mock data
      const aiResponse = {
        destination,
        itinerary: [
          {
            day: 1,
            activities: [
              "Arrival and check-in to accommodation",
              "Visit local landmarks and museums",
              "Try traditional cuisine at recommended restaurants"
            ]
          },
          {
            day: 2,
            activities: [
              "Morning adventure activity",
              "Afternoon cultural experience",
              "Evening entertainment and local shows"
            ]
          }
        ],
        recommendations: {
          restaurants: ["Local favorite 1", "Fine dining option", "Budget-friendly spot"],
          attractions: ["Must-see landmark", "Hidden gem", "Photo spot"],
          tips: ["Best time to visit", "Transportation tips", "Cultural etiquette"]
        },
        estimatedCost: budget ? budget * 0.9 : null
      };

      res.json({
        success: true,
        message: 'AI trip plan generated',
        data: aiResponse
      });
    } catch (error) {
      next(error);
    }
  },

  // Optimize trip with AI
  optimizeTrip: async (req, res, next) => {
    try {
      const { id } = req.params;

      const trip = await prisma.trip.findUnique({
        where: { id },
        include: { activities: true }
      });

      if (!trip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // TODO: Implement AI optimization logic
      const optimizationResult = {
        originalBudget: trip.budget,
        optimizedBudget: trip.budget ? trip.budget * 0.85 : null,
        improvements: [
          "Better route planning for activities",
          "Cost-saving alternatives found",
          "Time optimization suggestions"
        ],
        savings: "15% estimated savings"
      };

      res.json({
        success: true,
        message: 'Trip optimized successfully',
        data: optimizationResult
      });
    } catch (error) {
      next(error);
    }
  },

  // Add activity to trip
  addActivity: async (req, res, next) => {
    try {
      const { id } = req.params;
      const activityData = req.body;

      // Check if trip exists
      const trip = await prisma.trip.findUnique({
        where: { id }
      });

      if (!trip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Create activity
      const activity = await prisma.activity.create({
        data: {
          ...activityData,
          tripId: id,
          date: new Date(activityData.date)
        }
      });

      res.status(201).json({
        success: true,
        message: 'Activity added successfully',
        data: activity
      });
    } catch (error) {
      next(error);
    }
  },

  // Get trip activities
  getTripActivities: async (req, res, next) => {
    try {
      const { id } = req.params;

      const activities = await prisma.activity.findMany({
        where: { tripId: id },
        orderBy: {
          date: 'asc'
        }
      });

      res.json({
        success: true,
        count: activities.length,
        data: activities
      });
    } catch (error) {
      next(error);
    }
  },

  // Update activity
  updateActivity: async (req, res, next) => {
    try {
      const { activityId } = req.params;
      const updates = req.body;

      const activity = await prisma.activity.update({
        where: { id: activityId },
        data: updates
      });

      res.json({
        success: true,
        message: 'Activity updated successfully',
        data: activity
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete activity
  deleteActivity: async (req, res, next) => {
    try {
      const { activityId } = req.params;

      await prisma.activity.delete({
        where: { id: activityId }
      });

      res.json({
        success: true,
        message: 'Activity deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = tripController;