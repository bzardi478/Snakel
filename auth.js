const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (error) {
        console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', error);
        // Handle this error appropriately, maybe exit the process or use a default
        process.exit(1);
    }
} else {
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (error) {
        console.error('Error loading ./serviceAccountKey.json:', error);
        // Handle this error appropriately for local development
    }
}

if (serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    console.error('Firebase Admin SDK could not initialize. Check service account configuration.');
    // Handle the case where Firebase cannot be initialized
    // You might want to disable authentication-related routes or features
}

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