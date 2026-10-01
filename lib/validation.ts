import Joi from 'joi';

// Admin validation schemas
export const adminLoginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'any.required': 'Password is required'
    }),
  rememberMe: Joi.boolean().optional()
});

// Customer validation schemas (currently unused but may be needed for future customer management features)

// Message validation schemas
export const sendMessageSchema = Joi.object({
  conversationId: Joi.string()
    .uuid()
    .optional()
    .messages({
      'string.uuid': 'Invalid conversation ID format'
    }),
  customerId: Joi.string()
    .uuid()
    .optional()
    .messages({
      'string.uuid': 'Invalid customer ID format'
    }),
  phoneNumber: Joi.string()
    .pattern(/^\+?[1-9][\d\s\-\(\)]{1,20}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    }),
  content: Joi.string()
    .min(1)
    .max(4000)
    .optional()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message cannot exceed 4000 characters'
    }),
  message: Joi.string()
    .min(1)
    .max(4000)
    .optional()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message cannot exceed 4000 characters'
    }),
  role: Joi.string()
    .valid('user', 'assistant', 'agent', 'system')
    .default('assistant')
}).or('customerId', 'phoneNumber')
  .custom((value, helpers) => {
    // Ensure at least one of content or message is provided
    if (!value.content && !value.message) {
      return helpers.error('object.missing', { 
        message: 'Either content or message field is required' 
      });
    }
    return value;
  });

// Company and chatbot validation schemas (unused - future features)

// Pagination validation
export const paginationSchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.min': 'Page must be at least 1'
    }),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
  sortBy: Joi.string()
    .optional(),
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
});

// Search validation (unused - future search features)

// UUID validation helper
export const uuidSchema = Joi.string()
  .uuid()
  .required()
  .messages({
    'string.uuid': 'Invalid ID format',
    'any.required': 'ID is required'
  });

// Refresh token validation
export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required'
    })
});
