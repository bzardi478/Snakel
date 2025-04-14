// auth.js (Server-Side)

const bcrypt = require('bcrypt');

// In a real application, replace this with a database (e.g., MongoDB, PostgreSQL)
const users = [];

async function registerUser(username, password, callback) {
    const userExists = users.find(user => user.username === username);
    if (userExists) {
        return callback({ success: false, error: 'Username already taken' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: users.length + 1,
            username: username,
            password: hashedPassword,
        };
        users.push(newUser);
        callback({ success: true, userId: newUser.id });
    } catch (error) {
        console.error('Error registering user:', error);
        callback({ success: false, error: 'Registration failed' });
    }
}

async function loginUser(username, password, callback) {
    const user = users.find(user => user.username === username);
    if (!user) {
        return callback({ success: false, error: 'Invalid username or password' });
    }

    try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return callback({ success: false, error: 'Invalid username or password' });
        }

        callback({ success: true, userId: user.id });
    } catch (error) {
        console.error('Error logging in user:', error);
        callback({ success: false, error: 'Login failed' });
    }
}

module.exports = {
    registerUser,
    loginUser,
};