// routes/agent.routes.js
const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agent.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  chatSchema,
  streamSchema,
  historyQuerySchema,
  clearHistoryQuerySchema
} = require('../schemas/agent.schema');

// All agent routes require authentication
router.use(authMiddleware.authenticate);

/**
 * @swagger
 * tags:
 *   name: AI Agent
 *   description: Conversational AI travel assistant (xAI Grok)
 */

/**
 * @swagger
 * /api/agent/chat:
 *   post:
 *     summary: Send a message to the AI agent and get a complete response
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *                 description: The user's message to the AI
 *               sessionId:
 *                 type: string
 *                 maxLength: 100
 *                 description: Optional session identifier to continue a previous conversation
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 sessionId:
 *                   type: string
 *                   example: "user123-1633024800000"
 *                 reply:
 *                   type: string
 *                   example: "I've found a great hotel for you in Paris!"
 *                 toolsUsed:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["searchAccommodations"]
 *                 messageCount:
 *                   type: integer
 *                   example: 5
 *       400:
 *         description: Bad request (missing message)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post(
  '/chat',
  validate(chatSchema),
  agentController.chat
);

/**
 * @swagger
 * /api/agent/stream:
 *   post:
 *     summary: Send a message and receive a Server-Sent Events stream of tokens and tool calls
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *                 description: The user's message to the AI
 *               sessionId:
 *                 type: string
 *                 maxLength: 100
 *                 description: Optional session identifier to continue a previous conversation
 *     responses:
 *       200:
 *         description: SSE stream – see event types below
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: object
 *               properties:
 *                 event:
 *                   type: string
 *                   enum: [data]
 *                 data:
 *                   oneOf:
 *                     - type: object
 *                       properties:
 *                         type: { type: string, enum: ['token'] }
 *                         content: { type: string }
 *                     - type: object
 *                       properties:
 *                         type: { type: string, enum: ['tool'] }
 *                         name: { type: string }
 *                         status: { type: string, enum: ['calling', 'done'] }
 *                     - type: object
 *                       properties:
 *                         type: { type: string, enum: ['done'] }
 *                         sessionId: { type: string }
 *                         toolsUsed: { type: array, items: { type: string } }
 *                         messageCount: { type: integer }
 *                     - type: object
 *                       properties:
 *                         type: { type: string, enum: ['error'] }
 *                         message: { type: string }
 *       400:
 *         description: Bad request (missing message)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post(
  '/stream',
  validate(streamSchema),
  agentController.streamChat
);

/**
 * @swagger
 * /api/agent/history:
 *   get:
 *     summary: Retrieve conversation history for a specific session
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: The session ID to fetch history for
 *     responses:
 *       200:
 *         description: Conversation history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sessionId:
 *                   type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       role:
 *                         type: string
 *                         enum: [user, assistant]
 *                       content:
 *                         type: string
 *                       toolsUsed:
 *                         type: array
 *                         items:
 *                           type: string
 *                 total:
 *                   type: integer
 *       400:
 *         description: Missing sessionId
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Session not found
 */
router.get(
  '/history',
  validate(historyQuerySchema, 'query'),
  agentController.getHistory
);

/**
 * @swagger
 * /api/agent/history:
 *   delete:
 *     summary: Clear conversation history for a specific session
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: The session ID to clear
 *     responses:
 *       200:
 *         description: History cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing sessionId
 *       401:
 *         description: Unauthorized
 */
router.delete(
  '/history',
  validate(clearHistoryQuerySchema, 'query'),
  agentController.clearHistory
);

/**
 * @swagger
 * /api/agent/sessions:
 *   get:
 *     summary: List all active sessions for the current user
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sessionId:
 *                         type: string
 *                       startedAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
router.get('/sessions', agentController.getSessions);

module.exports = router;