const { PrismaClient } = require('@prisma/client');
const openfgaService = require('../services/openfga.service');
const redisService = require('../services/redis.service');

const prisma = new PrismaClient();

class VendorController {
  constructor() {
    this.applyForVendor = this.applyForVendor.bind(this);
    this.getApplicationStatus = this.getApplicationStatus.bind(this);
    this.getAllApplicationsForUser = this.getAllApplicationsForUser.bind(this);
    this.getVendorStatus = this.getVendorStatus.bind(this);
    this.getMyAccommodations = this.getMyAccommodations.bind(this);
    this.getAllApplications = this.getAllApplications.bind(this);
    this.getApplicationById = this.getApplicationById.bind(this);
    this.approveApplication = this.approveApplication.bind(this);
    this.rejectApplication = this.rejectApplication.bind(this);
    this.getAllVendors = this.getAllVendors.bind(this);
  }

  /**
   * Apply to become a vendor
   * POST /api/vendor/apply
   */
/**
 * Apply to become a vendor
 * POST /api/vendor/apply
 */
async applyForVendor(req, res, next) {
  try {
    const userId = req.user.id;

    // Check if user already has an APPROVED application (they're already a vendor)
    const approvedApplication = await prisma.vendorApplication.findFirst({
      where: { 
        userId,
        status: 'APPROVED'
      }
    });

    if (approvedApplication) {
      // Check if they're actually a vendor in OpenFGA
      const isVendor = await openfgaService.isVendor?.(userId) || false;
      
      if (isVendor) {
        return res.status(400).json({
          success: false,
          message: 'You are already an approved vendor. Cannot submit another application.'
        });
      }
    }

    // Check for PENDING applications (optional - you can allow multiple pending)
    const pendingApplication = await prisma.vendorApplication.findFirst({
      where: { 
        userId,
        status: 'PENDING'
      }
    });

    if (pendingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending application. Please wait for it to be reviewed before submitting another.'
      });
    }

    // Create new application (allow multiple)
    const application = await prisma.vendorApplication.create({
      data: {
        ...req.body,
        userId,
        status: 'PENDING'
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    // Notify superadmins
    console.log(`📝 New vendor application #${application.id} from ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: application,
      message: 'Vendor application submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting vendor application:', error);
    next(error);
  }
}
  /**
   * Get current application status
   * GET /api/vendor/application-status
   */
  async getApplicationStatus(req, res, next) {
    try {
      const userId = req.user.id;

      const application = await prisma.vendorApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          businessName: true,
          createdAt: true,
          reviewedAt: true,
          rejectionReason: true
        }
      });

      if (!application) {
        return res.json({
          success: true,
          data: { status: 'NOT_APPLIED' }
        });
      }

      res.json({
        success: true,
        data: application
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all applications for the authenticated user
   * GET /api/vendor/my-applications
   */
  async getAllApplicationsForUser(req, res, next) {
    try {
      const userId = req.user.id;

      const userApplications = await prisma.vendorApplication.findMany({
        where: { userId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          businessName: true,
          businessAddress: true,
          businessPhone: true,
          businessEmail: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          reviewedAt: true
        }
      });

      res.json({
        success: true,
        data: userApplications,
        total: userApplications.length,
        message: userApplications.length > 0 
          ? 'Applications retrieved successfully' 
          : 'No applications found'
      });

    } catch (error) {
      console.error('Error fetching user applications:', error);
      next(error);
    }
  }

  /**
   * Get vendor status
   * GET /api/vendor/status
   */
  async getVendorStatus(req, res, next) {
    try {
      const userId = req.user.id;

      const isVendor = await openfgaService.isVendor?.(userId) || false;
      
      let vendorSince = null;
      let approvedApplication = null;
      
      if (isVendor) {
        approvedApplication = await prisma.vendorApplication.findFirst({
          where: { 
            userId, 
            status: 'APPROVED' 
          },
          orderBy: { reviewedAt: 'desc' },
          select: { reviewedAt: true, businessName: true }
        });
        vendorSince = approvedApplication?.reviewedAt;
      }

      res.json({
        success: true,
        isVendor,
        vendorSince,
        businessName: approvedApplication?.businessName,
        message: isVendor ? 'You are an approved vendor' : 'You are not a vendor'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor's own accommodations
   * GET /api/vendor/my-accommodations
   */
  async getMyAccommodations(req, res, next) {
    try {
      // Check if user is vendor
      const isVendor = await openfgaService.isVendor?.(req.user.id) || false;
      if (!isVendor && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can access this'
        });
      }

      const accommodations = await prisma.accommodation.findMany({
        where: { vendorId: req.user.id },
        include: {
          _count: {
            select: {
              rooms: true,
              bookings: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        data: accommodations,
        total: accommodations.length
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all vendor applications (superadmin only)
   * GET /api/vendor/admin/applications
   */
  async getAllApplications(req, res, next) {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (status) where.status = status;

      const [applications, total] = await Promise.all([
        prisma.vendorApplication.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                createdAt: true
              }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy: { createdAt: 'desc' }
        }),
        prisma.vendorApplication.count({ where })
      ]);

      res.json({
        success: true,
        data: applications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get application by ID (superadmin only)
   * GET /api/vendor/admin/applications/:applicationId
   */
  async getApplicationById(req, res, next) {
    try {
      const { applicationId } = req.params;

      const application = await prisma.vendorApplication.findUnique({
        where: { id: applicationId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              createdAt: true,
              profile: true
            }
          }
        }
      });

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found'
        });
      }

      res.json({
        success: true,
        data: application
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Approve vendor application (superadmin only)
   * POST /api/vendor/admin/applications/:applicationId/approve
   */
  async approveApplication(req, res, next) {
    try {
      const { applicationId } = req.params;
      const { notes } = req.body;

      const application = await prisma.vendorApplication.findUnique({
        where: { id: applicationId },
        include: { user: true }
      });

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found'
        });
      }

      if (application.status !== 'PENDING') {
        return res.status(400).json({
          success: false,
          message: `Application already ${application.status}`
        });
      }

      // Update application status
      const updatedApplication = await prisma.vendorApplication.update({
        where: { id: applicationId },
        data: {
          status: 'APPROVED',
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          rejectionReason: null
        }
      });

      // Assign vendor role in OpenFGA
      if (openfgaService.assignVendorRole) {
        await openfgaService.assignVendorRole(application.userId);
      }

      // Invalidate caches
      await redisService.client?.del(`user:${application.userId}`);

      console.log(`✅ Vendor application approved for ${application.user.email}`);

      res.json({
        success: true,
        data: updatedApplication,
        message: 'Vendor application approved successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reject vendor application (superadmin only)
   * POST /api/vendor/admin/applications/:applicationId/reject
   */
  async rejectApplication(req, res, next) {
    try {
      const { applicationId } = req.params;
      const { reason } = req.body;

      const application = await prisma.vendorApplication.findUnique({
        where: { id: applicationId },
        include: { user: true }
      });

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found'
        });
      }

      if (application.status !== 'PENDING') {
        return res.status(400).json({
          success: false,
          message: `Application already ${application.status}`
        });
      }

      // Update application status
      const updatedApplication = await prisma.vendorApplication.update({
        where: { id: applicationId },
        data: {
          status: 'REJECTED',
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          rejectionReason: reason
        }
      });

      console.log(`❌ Vendor application rejected for ${application.user.email}: ${reason}`);

      res.json({
        success: true,
        data: updatedApplication,
        message: 'Vendor application rejected'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all approved vendors (superadmin only)
   * GET /api/vendor/admin/vendors
   */
  async getAllVendors(req, res, next) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get all approved applications
      const [applications, total] = await Promise.all([
        prisma.vendorApplication.findMany({
          where: { status: 'APPROVED' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                createdAt: true,
                profile: true,
                _count: {
                  select: {
                    travelPlans: true
                  }
                }
              }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy: { reviewedAt: 'desc' }
        }),
        prisma.vendorApplication.count({ where: { status: 'APPROVED' } })
      ]);

      // Get accommodation counts for each vendor
      const vendorsWithStats = await Promise.all(
        applications.map(async (app) => {
          const accommodationCount = await prisma.accommodation.count({
            where: { vendorId: app.userId }
          });
          
          return {
            ...app,
            user: {
              ...app.user,
              accommodationCount
            }
          };
        })
      );

      res.json({
        success: true,
        data: vendorsWithStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new VendorController();