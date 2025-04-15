// auth.js

const admin = require('firebase-admin'); // Keep this at the top

function isValidEmail(email) {
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function registerUser(adminInstance, username, password, callback) {
    if (!isValidEmail(username)) {
        return callback({ success: false, message: 'Invalid email format.' });
    }

    try {
        console.log('adminInstance.auth in auth.js:', adminInstance.auth); // Use the passed instance
        const userRecord = await adminInstance.auth().createUser({
            email: username, // Use username as email
            password: password,
            displayName: username // You can set a display name if needed
        });

        // Send verification email using the passed adminInstance
        await adminInstance.auth().sendEmailVerification(userRecord.uid);
        console.log(`Verification email sent to: ${username}`);

        const database = adminInstance.database();
        const userRef = database.ref(`users/${userRecord.uid}`);
        await userRef.set({
            username: username,
            emailVerified: false // Initially set to false, updated when verified
        });

        callback({ success: true, message: 'User registered successfully. Please check your email to verify your account.', uid: userRecord.uid });

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

async function loginUser(adminInstance, username, password, callback) {
    try {
        const user = await adminInstance.auth().getUserByEmail(username);
        if (!user) {
            return callback({ success: false, message: 'Invalid username or password' });
        }

        if (!user.emailVerified) {
            return callback({ success: false, message: 'Your email address is not verified. Please check your inbox.' });
        }

        // Since we don't have the password stored on the server,
        // we rely on the client-side (Firebase SDK) to handle password verification.
        // Here, we just confirm the user exists and is verified for this example.
        // In a real application, you would typically use Firebase Authentication's
        // signInWithEmailAndPassword on the client and then verify the ID token here.

        console.warn('Password verification not fully implemented on the server-side in this example.');
        return callback({ success: true, message: 'Login successful', uid: user.uid });

    } catch (error) {
        console.error('Error during login:', error);
        callback({ success: false, message: `Error during login: ${error.message}` });
    }
}

module.exports = { registerUser, loginUser };