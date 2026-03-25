const logger = require('../utils/logger');

/**
 * Sends a 6-digit OTP code to the provided email or phone number.
 * Note: This MVP version mocks the delivery entirely to avoid
 * dependency on paid external services (Twilio/SendGrid/SES).
 * 
 * @param {string} destination - Email address or phone number
 * @param {string} type - 'email' or 'phone'
 * @param {string} otpCode - The randomly generated 6-digit code
 */
const sendOTP = async (destination, type, otpCode) => {
  logger.info({ destination, type, otpCode }, 'Preparing to dispatch OTP');

  if (type === 'email') {
    // In production, instantiate NodeMailer here and send real email.
    // e.g. await transporter.sendMail({ to: destination, subject: 'Your OTP Code', ... })
    logger.info(`[MOCK EMAIL] Sent OTP ${otpCode} to email: ${destination}`);
  } else if (type === 'phone') {
    // In production, instantiate Twilio/MessageBird here and send real SMS.
    // e.g. await twilioClient.messages.create({ to: destination, body: `Your code is ${otpCode}` })
    logger.info(`[MOCK SMS] Sent OTP ${otpCode} to phone: ${destination}`);
  } else {
    logger.warn({ type }, 'Unknown notification type');
  }

  return true;
};

module.exports = {
  sendOTP
};
