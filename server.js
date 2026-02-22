require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const onFinished = require("on-finished");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// Use chalk v4 (CommonJS compatible)
const chalk = require("chalk");

const authRoutes = require("./src/routes/auth.routes");
const userRoutes = require('./src/routes/user.routes');
const accommodationRoutes = require('./src/routes/accommodation.routes');
const vendorRoutes = require('./src/routes/vendor.routes');
const transportationRoutes = require('./src/routes/transportation.routes');
// const travelPlanRoutes = require('./routes/travelplan.routes');

// Import OpenFGA service (not the config initializer)
const {createSuperAdmin} = require("./src/config/make-superadmin")
const openfgaService = require("./src/services/openfga.service");
const redisService = require("./src/services/redis.service");

const app = express();
const prisma = new PrismaClient();

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create write streams for different log levels
const accessLogStream = fs.createWriteStream(path.join(logsDir, "access.log"), {
  flags: "a",
});
const errorLogStream = fs.createWriteStream(path.join(logsDir, "error.log"), {
  flags: "a",
});

// ==================== CUSTOM LOGGER ====================

// Color mapping for HTTP methods
const methodColors = {
  GET: chalk.green,
  POST: chalk.yellow,
  PUT: chalk.blue,
  DELETE: chalk.red,
  PATCH: chalk.magenta,
  OPTIONS: chalk.cyan,
  HEAD: chalk.gray,
};

// Status code color mapping
const statusColors = {
  2: chalk.green, // 2xx
  3: chalk.cyan, // 3xx
  4: chalk.yellow, // 4xx
  5: chalk.red, // 5xx
};

class Logger {
  constructor() {
    this.startTime = Date.now();
  }

  // Get colored method
  getColoredMethod(method) {
    const color = methodColors[method] || chalk.white;
    return color(method.padEnd(6));
  }

  // Get colored status
  getColoredStatus(status) {
    const statusCode = parseInt(status);
    const statusGroup = Math.floor(statusCode / 100);
    const color = statusColors[statusGroup] || chalk.white;
    return color(statusCode);
  }

  // Format date in [DD/MMM/YYYY:HH:MM:SS +0000] format
  formatDate(date = new Date()) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const day = String(date.getDate()).padStart(2, "0");
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    // Get timezone offset in +0000 format
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? "+" : "-";
    const timezone = `${offsetSign}${String(offsetHours).padStart(2, "0")}${String(offsetMinutes).padStart(2, "0")}`;

    return `[${day}/${month}/${year}:${hours}:${minutes}:${seconds} ${timezone}]`;
  }

  // Calculate response time
  getResponseTime(start) {
    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(0);
    return `${ms}ms`;
  }

  // Main log method
  log(req, res, next) {
    const start = process.hrtime();
    const requestStart = Date.now();

    // Get user agent
    const userAgent = req.headers["user-agent"] || "unknown";

    // Log on response finish
    res.on("finish", () => {
      const responseTime = this.getResponseTime(start);
      const timestamp = this.formatDate(new Date(requestStart));

      // Prepare log components
      const method = req.method;
      const url = req.originalUrl || req.url;
      const status = res.statusCode;

      // Format: METHOD [TIMESTAMP] URL UserAgent Status ResponseTime
      const logMessage = `${method} ${timestamp} ${url} ${userAgent} ${status} ${responseTime}`;

      // Colored console output
      const coloredMethod = this.getColoredMethod(method);
      const coloredStatus = this.getColoredStatus(status);
      const coloredUrl = chalk.cyan(url);
      const coloredTime = chalk.magenta(responseTime);

      console.log(
        `${coloredMethod} ${chalk.gray(timestamp)} ${coloredUrl} ${chalk.gray(userAgent)} ${coloredStatus} ${coloredTime}`,
      );

      // Write to access log
      accessLogStream.write(`${logMessage}\n`);

      // If there was an error, log it to error log
      if (status >= 400) {
        const errorMessage = res.locals?.error?.message || "Unknown error";
        const errorLog = `${timestamp} [ERROR] ${method} ${url} ${status} ${errorMessage}\n`;
        errorLogStream.write(errorLog);
      }
    });

    next();
  }

  // Error logger
  error(err, req, res, next) {
    // Store error in res.locals for the onFinished handler
    if (!res.locals) res.locals = {};
    res.locals.error = err;

    const timestamp = this.formatDate();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const userAgent = req.headers["user-agent"] || "unknown";

    // Error console output
    console.log(
      chalk.red(
        `${method} ${timestamp} ${url} ${userAgent} ERROR ${err.message}`,
      ),
    );

    // Write to error log immediately
    errorLogStream.write(
      `${timestamp} [ERROR] ${method} ${url} ${userAgent} ${err.message}\n`,
    );

    if (process.env.NODE_ENV === "development") {
      console.log(chalk.red(err.stack));
      errorLogStream.write(`${err.stack}\n`);
    }

    next(err);
  }

  // System info logger
  logSystemInfo() {
    const memory = process.memoryUsage();
    const loadAvg = os.loadavg();

    console.log(
      chalk.cyan("[SYSTEM] Memory:", {
        rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
      }),
    );
    console.log(chalk.cyan("[SYSTEM] Load Average:", loadAvg));
  }
}

// Initialize logger
const logger = new Logger();

// ==================== MIDDLEWARE ====================

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(16).toString("hex");
  res.setHeader("X-Request-ID", req.requestId);
  next();
});

// Request logging middleware (applied to all routes)
app.use((req, res, next) => logger.log(req, res, next));

// Response time header
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(0);

    // Only set header if response is not already sent
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${ms}ms`);
    }
  });

  next();
});

// ==================== ROUTES ====================

// Health check with detailed info
app.get("/health", (req, res) => {
  logger.logSystemInfo();
  res.json({
    status: "OK",
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: prisma ? "connected" : "disconnected",
    environment: process.env.NODE_ENV,
    openfga: {
      enabled: process.env.OPENFGA_ENABLED === "true",
      initialized: openfgaService.initialized,
    },
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accommodations', accommodationRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/transportation', transportationRoutes);
// app.use('/api/travel-plans', travelPlanRoutes);

// Test route for logging demonstration
app.get("/api/test", (req, res) => {
  res.json({ message: "Test successful" });
});

app.get("/api/test-error", (req, res, next) => {
  next(new Error("This is a test error"));
});

// 404 handler
app.use((req, res) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;

  logger.error(error, req, res, () => {});

  res.status(404).json({
    success: false,
    requestId: req.requestId,
    message: "Route not found",
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, next) => {
  // Log error
  const status = err.status || 500;
  const message = err.message || "Internal server error";

  // In production, don't send stack traces
  const response = {
    success: false,
    requestId: req.requestId,
    message,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  // Check if headers already sent
  if (!res.headersSent) {
    res.status(status).json(response);
  } else {
    console.error(chalk.red("Headers already sent, can't send error response"));
  }
});

// ==================== SERVER INITIALIZATION ====================

const PORT = process.env.PORT || 3003;

// Initialize OpenFGA and start server
async function startServer() {
  try {
     if (process.env.CREATESUPERUSER){ createSuperAdmin(); }
    // Test database connection
    await prisma.$connect();
    console.log(chalk.green("✓ Database connected successfully"));

    // Initialize OpenFGA if enabled
    if (process.env.OPENFGA_ENABLED === "true") {
      try {
        console.log(chalk.blue("🔄 Initializing OpenFGA..."));
        await openfgaService.initialize();
        const storeInfo = await openfgaService.getStoreInfo();
        console.log(chalk.green("✓ OpenFGA initialized successfully"));
        console.log(chalk.gray(`  Store ID: ${storeInfo.storeId}`));
        console.log(chalk.gray(`  Model ID: ${storeInfo.modelId}`));
      } catch (error) {
        console.log(
          chalk.yellow("⚠ OpenFGA initialization failed:", error.message),
        );
        console.log(
          chalk.yellow("  Continuing without OpenFGA authorization..."),
        );
        console.log(
          chalk.yellow(
            "  Make sure OpenFGA server is running at:",
            process.env.OPENFGA_API_URL || "http://localhost:8080",
          ),
        );
      }
      try {
        await redisService.init();
        console.log(chalk.green("✓ Redis connected successfully"));
      } catch (error) {
        console.log(
          chalk.yellow("⚠ Redis initialization failed:", error.message),
        );
      }
    } else {
      console.log(
        chalk.yellow(
          "⚠ OpenFGA is disabled (set OPENFGA_ENABLED=true to enable)",
        ),
      );
    }

    // Start server
    const server = app.listen(PORT, () => {
      console.log(chalk.green("\n✓ Server started successfully"));
      console.log(
        chalk.cyan(`  Environment: ${process.env.NODE_ENV || "development"}`),
      );
      console.log(chalk.cyan(`  Port: ${PORT}`));
      console.log(chalk.cyan(`  URL: http://localhost:${PORT}`));
      console.log(chalk.cyan(`  Logs: ${logsDir}\n`));

      // Log system info on startup
      logger.logSystemInfo();

      // Example log
      console.log(chalk.gray("\nExample log format:"));
      console.log(
        chalk.gray(
          "[GET] [30/Jan/2026:09:41:09 +0000] /api/test PostmanRuntime/7.51.0 200 6ms\n",
        ),
      );
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log(
        chalk.yellow("\n\nReceived shutdown signal. Closing connections..."),
      );

      server.close(async () => {
        console.log(chalk.yellow("HTTP server closed"));

        await prisma.$disconnect();
        console.log(chalk.yellow("Database connection closed"));

        // Log shutdown
        const shutdownLog = `${logger.formatDate()} [SYSTEM] Server shutdown\n`;
        fs.createWriteStream(path.join(logsDir, "system.log"), {
          flags: "a",
        }).write(shutdownLog);

        console.log(chalk.green("✓ Graceful shutdown completed"));
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        console.error(
          chalk.red(
            "Could not close connections in time, forcefully shutting down",
          ),
        );
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  } catch (error) {
    console.error(chalk.red("Failed to start server:"), error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error(chalk.red("Uncaught Exception:"), error);

  // Log to error file
  const timestamp = logger.formatDate();
  errorLogStream.write(
    `${timestamp} [UNCAUGHT_EXCEPTION] ${error.message}\n${error.stack}\n`,
  );

  // Don't exit immediately, give time for logging
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error(chalk.red("Unhandled Rejection at:"), promise);
  console.error(chalk.red("Reason:"), reason);

  // Log to error file
  const timestamp = logger.formatDate();
  errorLogStream.write(`${timestamp} [UNHANDLED_REJECTION] ${reason}\n`);
});

// Start the server
startServer();

// Export for testing
module.exports = { app, logger };
