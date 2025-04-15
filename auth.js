const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

// Configure Nodemailer (replace with your email service details)
const transporter = nodemailer.createTransport({
    service: 'Gmail', // Or your email service (e.g., 'SMTP', 'Sendgrid')
    auth: {
        user: 'Mzardi07@gmail.com', // Your email address
        pass: 'frsk sfll tors aykf' // Your email password or an app-specific password
    }
});

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function registerUser(authService, database, username, password, callback) {
    if (!isValidEmail(username)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }

    try {
        const userRecord = await authService.createUser({
            email: username,
            password: password,
            displayName: username
        });

        const verificationToken = uuidv4();
        const verificationLink = `https://snakel.onrender.com/verify-email?token=${verificationToken}&uid=${userRecord.uid}`; // Replace with your actual domain and verification link endpoint

        // Store the verification token in the database (you'll need to adjust this based on your database structure)
        const userRef = database.ref(`users/${userRecord.uid}`);
        await userRef.update({ verificationToken: verificationToken, emailVerified: false });

        const mailOptions = {
            from: 'mzardi07@gmail.com', // Your email address
            to: username,
            subject: 'Verify Your Email Address',
            html: `<p>Please click the following link to verify your email address:</p><p><a href="${verificationLink}">${verificationLink}</a></p>`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending verification email:', error);
                callback({ success: false, message: 'Error sending verification email.' });
            } else {
                console.log('Verification email sent:', info.response);
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