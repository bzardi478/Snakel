// auth.js

const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccount = JSON.parse(serviceAccountString);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

async function registerUser(username, password, callback) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // Check if username (as document ID) already exists
        const userDoc = await firestore.collection('users').doc(username).get();
        if (userDoc.exists) {
            return callback({ success: false, error: 'Username already registered' });
        }

        // Store user data in Firestore
        await firestore.collection('users').doc(username).set({
            password: hashedPassword,
        });

        callback({ success: true, userId: username });
    } catch (error) {
        console.error('Error registering user:', error);
        callback({ success: false, error: 'Registration failed' });
    }
}

async function loginUser(username, password, callback) {
    try {
        const userDoc = await firestore.collection('users').doc(username).get();
        const userData = userDoc.data();

        if (!userData) {
            return callback({ success: false, error: 'Invalid username or password' });
        }

        const passwordMatch = await bcrypt.compare(password, userData.password);

        if (!passwordMatch) {
            return callback({ success: false, error: 'Invalid username or password' });
        }

        callback({ success: true, userId: username });
    } catch (error) {
        console.error('Error logging in user:', error);
        callback({ success: false, error: 'Login failed' });
    }
}

module.exports = {
    registerUser,
    loginUser,
};