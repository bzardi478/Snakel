const nodemailer = require('nodemailer');

// Nodemailer configuration (commented out as we are using SendGrid)
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.NODEMAILER_EMAIL, // Your Gmail address (or other email service)
//         pass: process.env.NODEMAILER_PASSWORD // Your App Password or email password
//     }
// });

function isValidEmail(email) {
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function registerUser(auth, database, email, password, sgMail, callback) {
    if (!isValidEmail(email)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }
    if (!password || password.length < 6) {
        return callback({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    try {
        const userRecord = await auth.createUser({
            email: email,
            password: password,
            emailVerified: true // Directly set emailVerified to true
        });

        console.log('User registered successfully:', userRecord.uid);
        callback({ success: true, message: 'Registration successful.' });

        // Optionally, store user data in your Realtime Database
        const userRef = database.ref(`users/${userRecord.uid}`);
        await userRef.set({
            email: email,
            registrationTime: Date.now(),
            emailVerified: true, // Ensure it's true in the database as well
            verificationToken: null
        });

    } catch (error) {
        console.error('Error during user registration:', error);
        let message = 'Registration failed.';
        if (error.code === 'auth/email-already-in-use') {
            message = 'The email address is already in use by another account.';
        } else if (error.code === 'auth/invalid-email') {
            message = 'The email address is invalid.';
        } else if (error.code === 'auth/weak-password') {
            message = 'The password is too weak.';
        }
        callback({ success: false, message: message });
    }
}

module.exports = {
    registerUser,
    isValidEmail
};