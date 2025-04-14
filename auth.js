// auth.js
const admin = require('firebase-admin'); // Ensure Firebase Admin SDK is imported here if needed in other functions

async function registerUser(adminInstance, username, password, callback) {
    try {
        const userRecord = await adminInstance.auth().createUser({
            displayName: username, // Use username as display name
            password: password,
        });

        const firestore = adminInstance.firestore();
        await firestore.collection('users').doc(userRecord.uid).set({
            username: username,
            registrationTime: adminInstance.firestore.FieldValue.serverTimestamp(),
        });

        callback({ success: true, message: 'User registered successfully', uid: userRecord.uid });
    } catch (error) {
        console.error('Error registering user - CATCH BLOCK ENTERED:', error);
        callback({ success: false, message: `Error registering user: ${error.message}` });
    }
}

async function loginUser(adminInstance, username, password, callback) {
    try {
        // First, try to find the user by their display name (username)
        const userRecords = await adminInstance.auth().listUsers({
            pageSize: 1000, // Adjust page size as needed
        });

        const user = userRecords.users.find(userRecord => userRecord.displayName === username);

        if (!user) {
            return callback({ success: false, message: 'Invalid username or password' });
        }

        // Firebase Admin SDK doesn't directly verify passwords.
        // This part assumes you have a way to verify the password
        // (e.g., using Firebase Authentication's client-side SDK
        // and then sending the ID token to the server for verification,
        // or if you've implemented a custom password hashing mechanism).

        // For demonstration, we'll just return success if the user is found.
        // In a real application, you MUST securely verify the password.
        console.warn('Password verification not implemented on the server-side in this example.');
        return callback({ success: true, message: 'Login successful', uid: user.uid });

    } catch (error) {
        console.error('Error during login:', error);
        callback({ success: false, message: `Error during login: ${error.message}` });
    }
}

module.exports = { registerUser, loginUser };