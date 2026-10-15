const crypto = require('node:crypto');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
    if (typeof password !== 'string' || typeof stored !== 'string' || password.length > 256) return false;
    try {
        const [algorithm, salt, expected] = stored.split(':');
        if (algorithm === 'scrypt' || algorithm === 'pbkdf2') {
            if (!salt || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
            const actual = algorithm === 'scrypt' ? crypto.scryptSync(password, salt, 64) : crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512');
            return safeEqual(actual, Buffer.from(expected, 'hex'));
        }
        if (stored.startsWith('$2')) return require('bcrypt').compareSync(password, stored);
        return safeEqual(Buffer.from(stored), Buffer.from(crypto.createHash('sha256').update(password + 'mc_salt_2026').digest('hex')));
    } catch { return false; }
}
const passwordValid = password => typeof password === 'string' && password.length >= 8 && password.length <= 128 && !/[\r\n\0]/.test(password);
module.exports = { hashPassword, verifyPassword, passwordValid };
