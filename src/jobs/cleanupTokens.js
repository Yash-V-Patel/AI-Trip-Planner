const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Run this job periodically (e.g., every hour)
async function cleanupExpiredTokens() {
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { isRevoked: true }
        ]
      }
    });
    
    console.log(`🧹 Cleaned up ${result.count} expired/revoked tokens`);
  } catch (error) {
    console.error('Error cleaning up tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// If running as a standalone script
if (require.main === module) {
  cleanupExpiredTokens()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { cleanupExpiredTokens };