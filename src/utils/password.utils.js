const bcrypt = require('bcrypt');
const crypto = require('crypto');

const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

const comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const generateOTP = (length = 6) => {
  return crypto.randomInt(10 ** (length - 1), 10 ** length).toString();
};

module.exports = {
  hashPassword,
  comparePassword,
  generateResetToken,
  generateOTP
};