// auth.js

const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

let serviceAccount = null; // Initialize as null

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (error) {
        console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', error);
        process.exit(1);
    }
} else {
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (error) {
        console.error('Error loading ./serviceAccountKey.json:', error);
    }
}

if (serviceAccount) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin SDK initialized successfully.'); // Add this log
    } catch (error) {
        console.error('Error initializing Firebase Admin SDK:', error);
        console.error(error); // Log the full error
        // You might want to handle this more gracefully, like disabling authentication
        // features or exiting the process. For now, we'll let it continue.
    }
} else {
    console.error('Firebase Admin SDK could not initialize. Check service account configuration.');
}

const firestore = admin.firestore();

async function registerUser(username, password, callback) {
    console.log('registerUser called with:', username, password); // Log when the function is called
    try {
        console.log('Hashing password...'); // Log before hashing
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Password hashed:', hashedPassword); // Log after hashing

        console.log('Checking if username exists:', username); // Log before checking Firestore
        const userDoc = await firestore.collection('users').doc(username).get();
        console.log('Username check result:', userDoc.exists); // Log the result of the check
        if (userDoc.exists) {
            console.log('Username already registered - sending error.'); // Log before the callback
            return callback({ success: false, error: 'Username already registered' });
        }

        console.log('Storing user data:', username); // Log before writing to Firestore
        await firestore.collection('users').doc(username).set({
            password: hashedPassword,
        });
        console.log('User data stored successfully - sending success.'); // Log before the callback
        callback({ success: true, userId: username });
    } catch (error) {
        console.error('Error registering user:', error); // Log any errors in the try/catch block
        callback({ success: false, error: 'Registration failed' });
    } finally {
        console.log('registerUser finished.'); // Log when the function completes
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
    } finally {
        console.log('loginUser finished.');
    }
}

module.exports = {
    registerUser,
    loginUser,
};