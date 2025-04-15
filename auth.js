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
            password: password
        });

        const verificationLink = await auth.generateEmailVerificationLink(email);
        console.log('Verification link generated:', verificationLink);

        const msg = {
            to: email,
            from: process.env.SENDGRID_EMAIL, // Your SendGrid verified email
            subject: 'Verify your email for Snake Multiplayer',
            html: `<p>Please click the following link to verify your email address:</p><p><a href="${verificationLink}">${verificationLink}</a></p><p>This link will expire in a short time.</p>`,
        };

        sgMail
            .send(msg)
            .then(() => {
                console.log('Verification email sent to', email);
                callback({ success: true, message: 'Registration successful. Please check your email to verify your account.' });
            })
            .catch((error) => {
                console.error('Error sending verification email:', error);
                if (error.response && error.response.body) {
                    console.error('SendGrid Error Body:', error.response.body); // Log the detailed error from SendGrid
                }
                // If email sending fails, you might want to delete the user you just created
                auth.deleteUser(userRecord.uid)
                    .then(() => console.log('User deleted due to email sending failure:', userRecord.uid))
                    .catch((deleteError) => console.error('Error deleting user:', deleteError));
                callback({ success: false, message: 'Error sending verification email.' });
            });

        // Optionally, you can also store user data in your Realtime Database
        const userRef = database.ref(`users/${userRecord.uid}`);
        await userRef.set({
            email: email,
            registrationTime: Date.now(),
            emailVerified: false,
            verificationToken: null // You might store the token here if needed for custom verification
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