// auth.js
const admin = require('firebase-admin');

// Utility function to validate email format
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Registers a new user with Firebase Authentication and sends an email verification link.
 *
 * @param {admin.auth.Auth} firebaseAuthService The Firebase Auth service instance.
 * @param {admin.database.Database} firebaseDatabase The Firebase Realtime Database instance.
 * @param {string} email The user's email address.
 * @param {string} password The user's password.
 * @param {function(object):void} callback The callback function to return the result.
 */
async function registerUser(firebaseAuthService, firebaseDatabase, email, password, callback) {
    if (!isValidEmail(email)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }
    // Firebase requires passwords to be at least 6 characters for security.
    if (password.length < 6) {
        return callback({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    try {
        // 1. Create the user in Firebase Authentication
        const userRecord = await firebaseAuthService.createUser({
            email: email,
            password: password,
            emailVerified: false, // User is not verified until they click the link
            disabled: false,      // User account is enabled by default
        });

        console.log('Server (auth.js): Successfully created new user:', userRecord.uid);

        // 2. Send email verification link
        // The 'url' here is the page on your client that Firebase will redirect to
        // after the user clicks the verification link in their email.
        // MAKE SURE THIS URL IS CORRECT AND ACCESSIBLE!
        const actionCodeSettings = {
            url: `https://snakel.onrender.com/verification-success.html`, // <-- IMPORTANT: Update this to your actual client URL
            handleCodeInApp: false, // Set to true if you handle the link in a mobile app, false for web
        };

        // This function actually sends the email using Firebase's default email sender.
        await firebaseAuthService.sendEmailVerification(userRecord.uid, actionCodeSettings);

        console.log(`Server (auth.js): Sent email verification link to ${email}`);

        // 3. (Optional) Store additional user data in your Realtime Database
        // This is based on your original server.js code.
        await firebaseDatabase.ref(`users/${userRecord.uid}`).set({
            email: email,
            name: email.split('@')[0], // A simple default name
            createdAt: Date.now(),
            // No need for isVerified here, Firebase Auth userRecord is the source of truth for emailVerified
        });

        callback({ success: true, message: 'Registration successful! Please check your email for a verification link to activate your account.' });

    } catch (error) {
        let errorMessage = 'Registration failed due to an unknown error.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'The email address is already in use by another account.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'The email address is not valid.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'The password is too weak (must be at least 6 characters).';
        }
        console.error('Server (auth.js): Error during registration:', error.code, error.message);
        callback({ success: false, message: errorMessage, error: error.code });
    }
}

/**
 * Checks if a user exists and if their email is verified in Firebase Authentication.
 * This function *does not* verify the password server-side using Firebase Admin SDK.
 * It assumes password verification is handled client-side or through other means.
 *
 * @param {admin.auth.Auth} firebaseAuthService The Firebase Auth service instance.
 * @param {string} email The user's email address.
 * @returns {Promise<{success: boolean, message: string, userId?: string, isVerified?: boolean, error?: string}>}
 */
async function loginUser(firebaseAuthService, email) {
    if (!isValidEmail(email)) {
        return { success: false, message: 'Invalid email format.' };
    }

    try {
        // Retrieve the user record by email
        const userRecord = await firebaseAuthService.getUserByEmail(email);
        console.log('Server (auth.js): Retrieved user record for login:', userRecord.uid);

        // Check if the user's email is verified
        if (!userRecord.emailVerified) {
            return { success: false, message: 'Please verify your email address to log in. Check your inbox for a verification link.' };
        }

        // If email is verified, consider login successful for the server's purpose.
        // Actual password authentication should ideally happen client-side with Firebase SDK.
        return { success: true, message: 'Login successful', userId: userRecord.uid, isVerified: userRecord.emailVerified };

    } catch (error) {
        console.error('Server (auth.js): Error during login check:', error.code, error.message);
        let errorMessage = 'Login failed.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'No user found with that email. Please register first.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email format.';
        }
        // Add more error codes if needed, e.g., if you had a custom password check here.
        return { success: false, message: errorMessage, error: error.code };
    }
}

module.exports = {
    registerUser,
    loginUser,
    isValidEmail
};