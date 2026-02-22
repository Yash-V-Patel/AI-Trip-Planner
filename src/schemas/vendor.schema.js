const Joi = require('joi');

const vendorApplicationSchema = Joi.object({
  businessName: Joi.string().required().max(255),
  businessAddress: Joi.string().required().max(500),
  businessPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/).required(),
  businessEmail: Joi.string().email().required().max(255),
  taxId: Joi.string().max(50).allow(''),
  documents: Joi.array().items(Joi.string().uri()).min(1).required(),
  additionalInfo: Joi.string().max(1000).allow('')
});

const approveApplicationSchema = Joi.object({
  notes: Joi.string().max(500).allow('')
});

const rejectApplicationSchema = Joi.object({
  reason: Joi.string().required().max(500)
});

module.exports = {
  vendorApplicationSchema,
  approveApplicationSchema,
  rejectApplicationSchema
};