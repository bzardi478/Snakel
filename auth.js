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
    console.log('registerUser called with:', username, password);
    try {
        console.log('TRY BLOCK START'); // Added log
        console.log('Hashing password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Password hashed:', hashedPassword);
        console.log('Checking if username exists:', username);
        const userDoc = await firestore.collection('users').doc(username).get();
        console.log('Username check result:', userDoc.exists);
        if (userDoc.exists) {
            console.log('Username already registered - sending error.');
            return callback({ success: false, error: 'Username already registered' });
        }
        console.log('Storing user data:', username);
        await firestore.collection('users').doc(username).set({
            password: hashedPassword,
        });
        console.log('User data stored successfully - sending success.');
        callback({ success: true, userId: username });
        console.log('TRY BLOCK END - SUCCESS'); // Added log
    } catch (error) {
        console.error('CATCH BLOCK ENTERED - Error registering user:', error); // Modified log
        console.error(error); // Log the full error object
        callback({ success: false, error: 'Registration failed' });
        console.log('CATCH BLOCK END'); // Added log
    } finally {
        console.log('registerUser finished.');
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