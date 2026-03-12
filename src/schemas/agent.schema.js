// schemas/agent.schema.js
const Joi = require('joi');

/**
 * Schema for POST /api/agent/chat
 */
exports.chatSchema = Joi.object({
  message: Joi.string().required().min(1).max(4000).messages({
    'string.empty': 'Message cannot be empty',
    'any.required': 'Message is required'
  }),
  sessionId: Joi.string().max(100).optional()
});

/**
 * Schema for POST /api/agent/stream
 * (Same as chat – only the response format differs)
 */
exports.streamSchema = Joi.object({
  message: Joi.string().required().min(1).max(4000).messages({
    'string.empty': 'Message cannot be empty',
    'any.required': 'Message is required'
  }),
  sessionId: Joi.string().max(100).optional()
});

/**
 * Schema for GET /api/agent/history (query parameters)
 */
exports.historyQuerySchema = Joi.object({
  sessionId: Joi.string().required().max(100).messages({
    'any.required': 'sessionId is required'
  })
});

/**
 * Schema for DELETE /api/agent/history (query parameters)
 */
exports.clearHistoryQuerySchema = Joi.object({
  sessionId: Joi.string().required().max(100).messages({
    'any.required': 'sessionId is required'
  })
});

// No schema needed for GET /api/agent/sessions – it has no parameters.