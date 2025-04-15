// auth.js

const admin = require('firebase-admin');

function isValidEmail(email) {
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function registerUser(authService, database, username, password, mailgunInstance, callback) {
    if (!isValidEmail(username)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }

    try {
        const userRecord = await authService.createUser({
            email: username,
            password: password,
            displayName: username
        });

        const verificationLink = await authService.generateEmailVerificationLink(userRecord.email);
        console.log('Email Verification Link (Mailgun):', verificationLink);

        const data = {
            from: 'Your Application <your@yourdomain.com>', // Replace with your sending address
            to: username,
            subject: 'Verify Your Email Address',
            html: `<p>Please click the following link to verify your email address:</p><p><a href="${verificationLink}">${verificationLink}</a></p>`
        };

        mailgunInstance.messages().send(data, (error, body) => {
            if (error) {
                console.error('Error sending verification email via Mailgun:', error);
                callback({ success: false, message: 'Error sending verification email.' });
            } else {
                console.log('Verification email sent via Mailgun:', body);
                const userRef = database.ref(`users/${userRecord.uid}`);
                userRef.set({ username: username, emailVerified: false });
                callback({ success: true, message: 'User registered successfully. Please check your email to verify your account.', uid: userRecord.uid });
            }
        });

    } catch (error) {
        console.error('Error registering user:', error);
        let errorMessage = 'Error registering user.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'This email address is already in use.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password should be at least 6 characters.';
        }
        callback({ success: false, message: errorMessage });
    }
}

module.exports = { registerUser, isValidEmail };