// auth.js (UPDATED PARTS ONLY)

// const admin = require('firebase-admin'); // <--- REMOVE THIS LINE from the top of auth.js

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function registerUser(firebaseAuthService, firebaseDatabase, email, password, callback) {
    if (!isValidEmail(email)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }
    if (password.length < 6) {
        return callback({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    // **********************************************
    // ****** KEEP THESE DEBUG LOGS HERE ************
    // **********************************************
    console.log('auth.js: DEBUG - Inside registerUser function.');
    console.log('auth.js: DEBUG - typeof firebaseAuthService:', typeof firebaseAuthService);
    // You might need to adjust the String(firebaseAuthService).substring(0, 50) if it's not an object.
    // Let's simplify to just check if it's an object.
    console.log('auth.js: DEBUG - firebaseAuthService is object:', typeof firebaseAuthService === 'object' && firebaseAuthService !== null);
    if (firebaseAuthService) {
        console.log('auth.js: DEBUG - Does firebaseAuthService have sendEmailVerification method?', typeof firebaseAuthService.sendEmailVerification === 'function');
        console.log('auth.js: DEBUG - Does firebaseAuthService have createUser method?', typeof firebaseAuthService.createUser === 'function');
    } else {
        console.log('auth.js: DEBUG - firebaseAuthService is null or undefined at this point (inside auth.js).');
    }
    // **********************************************
    // **********************************************

    try {
        // This line should now work correctly if firebaseAuthService is indeed the Auth object
        const userRecord = await firebaseAuthService.createUser({
            email: email,
            password: password,
            emailVerified: false,
            disabled: false,
        });

        console.log('Server (auth.js): Successfully created new user:', userRecord.uid);

        const actionCodeSettings = {
            url: `https://snakel.onrender.com/verification-success.html`, // <-- IMPORTANT: Update this
            handleCodeInApp: false,
        };

        // This is the line we're focusing on
        await firebaseAuthService.sendEmailVerification(userRecord.uid, actionCodeSettings);

        console.log(`Server (auth.js): Sent email verification link to ${email}`);

        await firebaseDatabase.ref(`users/${userRecord.uid}`).set({
            email: email,
            name: email.split('@')[0],
            createdAt: Date.now(),
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

// The loginUser function also needs to receive firebaseAuthService as an argument
async function loginUser(firebaseAuthService, email) {
    if (!isValidEmail(email)) {
        return { success: false, message: 'Invalid email format.' };
    }

    // Add similar debug logs here if loginUser also starts failing
    // console.log('auth.js: DEBUG - Inside loginUser function.');
    // console.log('auth.js: DEBUG - typeof firebaseAuthService:', typeof firebaseAuthService);

    try {
        const userRecord = await firebaseAuthService.getUserByEmail(email);
        console.log('Server (auth.js): Retrieved user record for login:', userRecord.uid);

        if (!userRecord.emailVerified) {
            return { success: false, message: 'Please verify your email address to log in. Check your inbox for a verification link.' };
        }
        return { success: true, message: 'Login successful', userId: userRecord.uid, isVerified: userRecord.emailVerified };

    } catch (error) {
        console.error('Server (auth.js): Error during server-side login check (Firebase Admin):', error.code, error.message);
        let errorMessage = 'Login failed.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'No user found with that email.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email format.';
        }
        return { success: false, message: errorMessage, error: error.code };
    }
}

module.exports = {
    registerUser,
    loginUser,
    isValidEmail
};