const Joi = require('joi');

const periodEnum = ['today', 'week', 'month', 'quarter', 'year'];

exports.statsQuerySchema = Joi.object({
  period: Joi.string().valid(...periodEnum).optional(),
  category: Joi.string().optional()
});

exports.activityQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional().default(20),
  offset: Joi.number().integer().min(0).optional().default(0),
  type: Joi.string().optional()
});

exports.updateWidgetPreferencesSchema = Joi.object({
  widgets: Joi.object().pattern(Joi.string(), Joi.object({
    enabled: Joi.boolean(),
    order: Joi.number().integer(),
    config: Joi.object()
  })).optional(),
  layout: Joi.object().optional()
});

exports.notificationsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional().default(20),
  unreadOnly: Joi.boolean().optional().default(false)
});

exports.notificationIdParamSchema = Joi.object({
  notificationId: Joi.string().uuid().required()
});

exports.chartsQuerySchema = Joi.object({
  chart: Joi.string().required(),
  period: Joi.string().valid(...periodEnum).optional().default('month')
});

exports.upcomingQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).optional().default(10)
});